// Everything Talos asks a model goes through SERV Reasoning. Three jobs:
//   compile — read a person's rule and turn it into a decision graph
//   news    — judge whether real bad news explains a drop (src/news.js)
//   walk    — follow that graph for one moment in the market and decide
// The numbers a decision rests on are computed in code and handed over; the
// model reasons over them, and code checks what it concluded before anything
// can happen to money.

const ENDPOINT = "https://inference-api.openserv.ai/v1/chat/completions";

export const COMPILE_MODEL = process.env.TALOS_COMPILE_MODEL || "gpt-6-luna";
export const WALK_MODEL = process.env.TALOS_WALK_MODEL || "gpt-6-luna";

export const CHECK_TYPES = ["market_closed", "drop_from_close", "move_vs_normal_day", "real_news", "price_impact", "already_fired", "size_cap"];

export async function serv({ model, system, user, schema, shadow, guard = false, raw = false, timeoutMs = 45000 }) {
  const key = process.env.SERV_API_KEY;
  if (!key) throw new Error("SERV_API_KEY is not set");
  const body = { model, messages: [{ role: "system", content: system }, { role: "user", content: user }] };
  if (schema) body.response_format = { type: "json_schema", json_schema: { name: schema.name, strict: true, schema: schema.schema } };
  const tools = [];
  if (shadow && !raw) tools.push({ type: "function", function: { name: "serv_shadow_agent", parameters: { type: "object", properties: { hint: { type: "string", default: shadow }, max_iterations: { type: "integer", default: 2 } } } } });
  // Prompt Guard screens text from outside (headlines) for injected instructions before any model sees it.
  if (guard && !raw) tools.push({ type: "function", function: { name: "serv_prompt_guard" } });
  // Talos's instructions are published in its repo, so SERV's system-prompt leak filter only produces false alarms here.
  if (!raw) tools.push({ type: "function", function: { name: "serv_disable_content_filter", parameters: { type: "object", properties: {} } } });
  if (tools.length) body.tools = tools;
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  if (raw) headers["x-openserv-disable-braid"] = "true";
  const t0 = Date.now();
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try { res = await fetch(ENDPOINT, { method: "POST", headers, body: JSON.stringify(body), signal: ctl.signal }); }
  finally { clearTimeout(timer); }
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { throw new Error(`SERV returned ${res.status}: ${text.slice(0, 160)}`); }
  if (j.error) throw new Error(`SERV: ${j.error.message || JSON.stringify(j.error)}`);
  const content = j.choices?.[0]?.message?.content ?? "";
  return { content, usage: j.usage, ms: Date.now() - t0, model };
}

// ── compile ──────────────────────────────────────────────────────────────────

const PLAN_SCHEMA = {
  name: "talos_plan",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["ticker", "summary", "action", "checks", "assumptions", "unclear"],
    properties: {
      ticker: { type: "string", enum: ["NVDA"] },
      summary: { type: "string" },
      action: {
        type: "object", additionalProperties: false, required: ["type", "sell_pct"],
        properties: { type: { type: "string", enum: ["sell"] }, sell_pct: { type: "number" } },
      },
      checks: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["type", "threshold", "label", "why", "added_by"],
          properties: {
            type: { type: "string", enum: CHECK_TYPES },
            threshold: { type: ["number", "null"] },
            label: { type: "string" },
            why: { type: "string" },
            added_by: { type: "string", enum: ["you", "talos"] },
          },
        },
      },
      assumptions: { type: "array", items: { type: "string" } },
      unclear: { type: "array", items: { type: "string" } },
    },
  },
};

// Kept word-for-word stable so SERV can reuse the reasoning prompt it builds.
export const COMPILE_SYSTEM = `You turn one person's plain-English protection rule for their NVDA stock tokens on Robinhood Chain into an ordered list of checks. Every check must pass, in order, before Talos may sell. Talos can only sell, only NVDA, only for USDG.

Check types (use each at most once, in this order when present):
- market_closed: the US market is in a closed stretch (night or weekend). threshold null.
- drop_from_close: price has fallen at least threshold % below the last US close.
- move_vs_normal_day: the drop is at least threshold times this token's normal daily range. Stops a sale on an ordinary wobble.
- real_news: real bad news (about Nvidia or the whole market) published since the close explains the drop. SERV reads the headlines; code checks the ones it cites. threshold null.
- price_impact: selling now would move the price by at most threshold %.
- already_fired: the rule has not already sold during this closed stretch. threshold null.
- size_cap: the sale is at most threshold US dollars.

Rules:
1. Use only numbers the person gave. Never invent a trigger. If they gave no trigger drop, put that in "unclear" and use threshold 5 with an assumption saying so.
2. "Sell half" is sell_pct 50. "Sell everything/all" is 100. A dollar amount to sell is NOT a percentage: keep sell_pct as stated or 100 and add a size_cap check with that dollar amount.
3. Always add market_closed, price_impact (threshold 1) and already_fired, marked added_by "talos", with a one-line why.
4. Add move_vs_normal_day with threshold 1 marked added_by "talos" unless the person said to sell on any drop. Say why: most closed-market dips of this size come back by the open.
5. Add real_news marked added_by "talos" unless the person said to sell on any drop. Say why: a dip with no news behind it usually comes back, a drop with real bad news often doesn't.
6. If the person asks for something Talos cannot do (buy, another stock, a time-based sale, leverage), do not pretend: add it to "unclear".
7. label is 2-6 plain words a non-trader understands. why is one short sentence.
8. summary restates the final rule in one plain sentence.`;

export async function compileRule(text, opts = {}) {
  const r = await serv({
    model: opts.model || COMPILE_MODEL, system: COMPILE_SYSTEM, user: `The person's rule: """${text}"""`,
    schema: PLAN_SCHEMA, raw: opts.raw, timeoutMs: 58000,
    shadow: opts.noShadow ? undefined : "Every number in checks and action must come from the person's words or from the rules above; list any default used under assumptions. A dollar amount must never become a percentage.",
  });
  const plan = JSON.parse(r.content);
  // Give checks stable ids so the graph and the walk can refer to them.
  const order = new Map(CHECK_TYPES.map((t, i) => [t, i]));
  plan.checks.sort((a, b) => order.get(a.type) - order.get(b.type));
  plan.checks = plan.checks.filter((c, i, all) => all.findIndex(x => x.type === c.type) === i).map((c, i) => ({ ...c, id: `C${i + 1}` }));
  return { plan, meta: { model: r.model, ms: r.ms, usage: r.usage } };
}

// ── the graph ────────────────────────────────────────────────────────────────

const esc = s => String(s).replace(/"/g, "'");

export function describe(c) {
  switch (c.type) {
    case "market_closed": return "US market closed?";
    case "drop_from_close": return `Down ${c.threshold}%+ from close?`;
    case "move_vs_normal_day": return `Drop ≥ ${c.threshold}× a normal day?`;
    case "real_news": return "Real bad news behind it?";
    case "price_impact": return `Sale moves price ≤ ${c.threshold}%?`;
    case "already_fired": return "Not already sold this stretch?";
    case "size_cap": return `Sale ≤ $${c.threshold}?`;
    default: return c.label;
  }
}

// A Mermaid flowchart: one diamond per check, a hold exit from each, and the
// sale at the end. This is the picture the person approves.
export function mermaid(plan) {
  const lines = ["flowchart LR", `  S([Price update]) --> ${plan.checks[0]?.id || "SELL"}`];
  plan.checks.forEach((c, i) => {
    const next = plan.checks[i + 1]?.id || "SELL";
    lines.push(`  ${c.id}{"${esc(describe(c))}"}`);
    lines.push(`  ${c.id} -->|yes| ${next}`);
    lines.push(`  ${c.id} -->|no| H${i + 1}([Hold])`);
  });
  lines.push(`  SELL[["Sell ${plan.action.sell_pct}% of NVDA for USDG"]]`);
  return lines.join("\n");
}

// ── walk ─────────────────────────────────────────────────────────────────────

const WALK_SCHEMA = {
  name: "talos_walk",
  schema: {
    type: "object", additionalProperties: false, required: ["path", "decision", "reason"],
    properties: {
      path: { type: "array", items: { type: "object", additionalProperties: false, required: ["check", "passed"], properties: { check: { type: "string" }, passed: { type: "boolean" } } } },
      decision: { type: "string", enum: ["sell", "hold"] },
      reason: { type: "string" },
    },
  },
};

export const WALK_SYSTEM = `You are Talos, a guard for one person's NVDA stock tokens. You receive their approved decision graph and the current facts. Walk the graph from the top, one check at a time, using only the facts given. Record each check you evaluate with its id and whether it passed. Stop at the first check that fails and decide "hold". Decide "sell" only if every check passes. Do no arithmetic beyond comparing a fact to a threshold. The reason is one plain sentence a non-trader understands, built from the facts that decided it, for example "NVDA is down 3.8% since the close, bigger than a normal day, so Talos sells half." Never mention check ids in the reason.`;

const PASSES = {
  market_closed: () => "market_closed is true",
  drop_from_close: t => `drop_from_close_pct >= ${t}`,
  move_vs_normal_day: t => `move_vs_normal_day >= ${t} (fails if it is null)`,
  real_news: () => "real_news is true (fails if false or null)",
  price_impact: t => `price_impact_pct <= ${t}`,
  already_fired: () => "already_fired is false",
  size_cap: t => `sale_usd <= ${t}`,
};

// The same rule as a paragraph, the way most agents are given their policy.
export function prose(plan) {
  const parts = plan.checks.map(c => ({
    market_closed: "only while the US market is closed",
    drop_from_close: `only if the price has fallen at least ${c.threshold}% below the last US close`,
    move_vs_normal_day: `only if that fall is at least ${c.threshold} times a normal day's range for NVDA (if there is no normal-day figure, do not sell)`,
    real_news: "only if real bad news published since the close explains the fall (real_news is true)",
    price_impact: `only if selling would move the price by no more than ${c.threshold}%`,
    already_fired: "only if you have not already sold during this closed stretch",
    size_cap: `and never if the sale would be worth more than $${c.threshold}`,
  }[c.type]));
  return `Sell ${plan.action.sell_pct}% of the person's NVDA ${parts.join(", ")}. Otherwise hold.`;
}

export async function walkProse(plan, facts, opts = {}) {
  const ids = plan.checks.map(c => `${c.id} = ${c.type}`).join(", ");
  const r = await serv({
    model: opts.model || WALK_MODEL, raw: opts.raw, schema: WALK_SCHEMA,
    system: `You are Talos, a guard for one person's NVDA stock tokens. Their policy: ${prose(plan)} Report every condition you checked, in order, as path entries using these ids: ${ids}. Stop at the first condition that fails. Decide "sell" or "hold". The reason is one plain sentence.`,
    user: `Facts now:\n${JSON.stringify(facts, null, 1)}`,
  });
  return { ...JSON.parse(r.content), meta: { model: r.model, ms: r.ms, usage: r.usage } };
}

export async function walk(plan, facts, opts = {}) {
  const graph = mermaid(plan);
  const checks = plan.checks.map(c => `${c.id}: passes if ${PASSES[c.type](c.threshold)}`).join("\n");
  const r = await serv({
    model: opts.model || WALK_MODEL, system: WALK_SYSTEM, raw: opts.raw, schema: WALK_SCHEMA,
    user: `Approved graph:\n${graph}\n\nChecks:\n${checks}\n\nFacts now:\n${JSON.stringify(facts, null, 1)}`,
    shadow: opts.shadow ? "The path must follow the checks in order and stop at the first failure; each passed/failed must match the facts against the thresholds." : undefined,
  });
  return { ...JSON.parse(r.content), meta: { model: r.model, ms: r.ms, usage: r.usage } };
}

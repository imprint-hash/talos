// SERV reviews a rule against its own replay: what went wrong or right on the
// real nights, in plain words, and one better rule to try. Code hands over the
// replay's numbers, and checks that every number SERV writes is one of them.

import { serv, COMPILE_MODEL } from "./serv.js";
import { replay } from "./history.js";

const REVIEW_SCHEMA = {
  name: "talos_review",
  schema: {
    type: "object", additionalProperties: false, required: ["headline", "advice", "suggested_rule"],
    properties: {
      headline: { type: "string" },
      advice: { type: "string" },
      suggested_rule: { type: "string" },
    },
  },
};

export const REVIEW_SYSTEM = `You review one person's stop-loss rule for their NVDA stock tokens, using what the rule would have done on every real night and weekend since the NVDA/USDG pool opened. You get the replay of their rule exactly as written, and of the same rule with the checks Talos added.

Write like a friend who checked the numbers, not like a report:
- headline: one short plain sentence, the single most important thing the replay shows.
- advice: two or three short plain sentences a non-trader understands. Say what happened on those nights and what to change. Write money like $69.97 and counts as words or digits. Use only numbers that appear in the facts. Never predict prices or promise results; it's history and a small sample.
- suggested_rule: one rule under 25 words, in plain English, that Talos can do: sell a share or dollar amount of NVDA while the market is closed, when it drops a stated percent, optionally "only if the drop is bigger than a normal day" or "only if there's real bad news". Always give a number for the drop. No limit orders, no buying. If their rule is already sensible, suggest a small refinement.
Never suggest buying.`;

const summary = r => ({
  closed_stretches: r.stretches, weekends: r.weekends, nights: r.nights,
  times_it_would_have_sold: r.bounced + r.kept_falling + r.flat,
  sold_and_price_came_back: r.bounced, sold_and_kept_falling: r.kept_falling, sold_and_ended_flat: r.flat, never_triggered: r.never,
  result_vs_holding_per_1000_usd: r.net_vs_holding_usd,
  sales: r.results.filter(x => x.outcome !== "never").map(x => ({ night: x.label, drop_when_sold_pct: x.fired_drop_pct, price_by_the_open_pct: x.after_pct, result_usd: x.vs_holding_usd })),
});

// Every number SERV writes must appear in the facts it was given.
function unconfirmed(text, facts) {
  const allowed = new Set();
  JSON.stringify(facts).match(/-?\d+(\.\d+)?/g)?.forEach(n => { const v = Math.abs(Number(n)); allowed.add(String(v)); allowed.add(v.toFixed(2)); allowed.add(String(Math.round(v))); });
  return (text.replace(/,(\d{3})/g, "$1").match(/\d+(\.\d+)?/g) || []).filter(n => !allowed.has(String(Number(n))) && !allowed.has(n));
}

export async function reviewRule(rows, rule, plan, opts = {}) {
  const yours = { ...plan, checks: plan.checks.filter(c => c.added_by !== "talos" || !["move_vs_normal_day", "real_news"].includes(c.type)) };
  const facts = {
    rule, flowchart: plan.checks.map(c => `${c.label}${c.added_by === "talos" ? " (added by Talos)" : ""}`),
    your_rule_alone: summary(replay(rows, yours)), with_talos_checks: summary(replay(rows, plan)),
    note: "The news check can't be replayed, so history is judged on the numbers alone. Position size 1000 USD.",
  };
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await serv({ model: opts.model || COMPILE_MODEL, system: REVIEW_SYSTEM, schema: REVIEW_SCHEMA, user: JSON.stringify(facts, null, 1), timeoutMs: 58000 });
    const j = JSON.parse(r.content);
    const bad = unconfirmed(`${j.headline} ${j.advice}`, facts);
    last = { ...j, verified: !bad.length, unconfirmed: bad, meta: { model: r.model, ms: r.ms } };
    if (!bad.length) break;
  }
  return last;
}

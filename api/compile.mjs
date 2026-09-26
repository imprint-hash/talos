import { body, send, history, readJson } from "./_lib.mjs";
import { compileRule, mermaid } from "../src/serv.js";
import { replay } from "../src/history.js";

// A person's rule, compiled by SERV into checks, drawn as a graph, and replayed
// over every real closed-market stretch — with and without Talos's own checks.
const cache = new Map();
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST a rule" });
  const { rule } = await body(req);
  const text = String(rule || "").trim().slice(0, 400);
  if (text.length < 8) return send(res, 400, { error: "Write your rule in a sentence." });
  try {
    // The example rules on the page were compiled by SERV once and saved
    // (bin/examples.mjs), so they open instantly and cost nothing per visit.
    const saved = readJson("data/examples.json", []).find(e => e.rule === text);
    let hit = saved ? { plan: saved.plan, meta: { ...saved.meta, saved: true } } : cache.get(text);
    if (!hit) { hit = await compileRule(text); cache.set(text, hit); }
    const plan = { ...hit.plan, position_usd: 1000 };
    const rows = history();
    // The same rule without the check Talos adds for reasoning: is this drop big for a normal day?
    const yours = { ...plan, checks: plan.checks.filter(c => !(c.added_by === "talos" && c.type === "move_vs_normal_day")) };
    send(res, 200, { plan, mermaid: mermaid(plan), meta: hit.meta, replay: replay(rows, plan), replay_rule_only: replay(rows, yours) });
  } catch (e) { send(res, 502, { error: e.message }); }
}

// The public watch: one check of the sensible rule against the live market,
// appended to a log the website shows. It never sells: it has no wallet key.
// bin/watch-loop.sh runs it every 15 minutes and publishes the log.
//
//   node bin/watch.mjs [--log watch-log.json]
//
// Needs SERV_API_KEY. While the US market is open it records the market and
// skips SERV, since the rule only acts while the market is shut.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { walk } from "../src/serv.js";
import { decide } from "../src/history.js";
import { snapshot } from "../src/market.js";

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const LOG = arg("--log") || "watch-log.json";
const KEEP = 700;   // about a week of checks

const { rule, plan } = JSON.parse(readFileSync("data/examples.json"))[0];
const snap = await snapshot({ positionUsd: 1000, salePct: plan.action.sell_pct });
const truth = decide(plan, snap.facts);
const entry = {
  at: snap.at, block: snap.block, price: snap.price, last_close: snap.last_close,
  drop_pct: snap.facts.drop_from_close_pct, vs_normal_day: snap.facts.move_vs_normal_day,
  market: snap.facts.market_closed ? snap.facts.stretch : "open",
  code: truth.decision, path: truth.path.map(p => [p.check, p.passed]),
};

if (snap.facts.market_closed) {
  try {
    const model = await walk(plan, snap.facts);
    entry.serv = { model: model.meta.model, decision: model.decision, reason: model.reason, ms: model.meta.ms ?? null };
    entry.agree = model.decision === truth.decision && JSON.stringify(model.path.map(p => [p.check, p.passed])) === JSON.stringify(entry.path);
  } catch (e) { entry.serv = { error: String(e.message).slice(0, 200) }; entry.agree = null; }
} else entry.serv = null;

const log = existsSync(LOG) ? JSON.parse(readFileSync(LOG)) : { rule, plan: plan.summary, checks: [] };
log.rule = rule; log.plan = plan.summary; log.updated = entry.at;
log.checks = [entry, ...log.checks].slice(0, KEEP);
writeFileSync(LOG, JSON.stringify(log));
console.log(`${new Date(entry.at * 1000).toISOString()} · ${entry.market} · NVDA $${entry.price} · ${entry.drop_pct}% from close · code ${entry.code}` +
  (entry.serv ? ` · SERV ${entry.serv.decision ?? "error"} · ${entry.agree ? "agree" : "DISAGREE"}` : " · SERV skipped (market open)"));

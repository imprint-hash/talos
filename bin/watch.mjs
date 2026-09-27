// The public watch: one check of the sensible rule against the live market,
// appended to a log the website shows. It never sells: it has no wallet key.
// A scheduled GitHub Action (.github/workflows/watch.yml) runs it every 15 minutes.
//
//   node bin/watch.mjs [--log watch-log.json]
//
// Needs SERV_API_KEY. While the market is shut, SERV reads the news and walks
// the graph; while it is open, the market is recorded and SERV is skipped.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { walk } from "../src/serv.js";
import { checkNow, agree } from "../src/check.js";

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const LOG = arg("--log") || "watch-log.json";
const KEEP = 700;   // about a week of checks

const { rule, plan } = JSON.parse(readFileSync("data/examples.json"))[0];
const { snap, news, truth } = await checkNow(plan);
const entry = {
  at: snap.at, block: snap.block, price: snap.price, last_close: snap.last_close,
  drop_pct: snap.facts.drop_from_close_pct, vs_normal_day: snap.facts.move_vs_normal_day,
  market: snap.facts.market_closed ? snap.facts.stretch : "open",
  code: truth.decision, path: truth.path.map(p => [p.check, p.passed]),
  news: news && { verdict: news.verdict, verified: news.verified, reason: news.reason, read: news.headlines?.length ?? 0,
    cited: (news.cites || []).map(id => news.headlines.find(h => h.id === id)).filter(Boolean).map(h => ({ title: h.title, source: h.source, link: h.link })) },
};

if (snap.facts.market_closed) {
  try {
    const model = await walk(plan, snap.facts);
    entry.serv = { model: model.meta.model, decision: model.decision, reason: model.reason, ms: model.meta.ms ?? null };
    entry.agree = agree(model, truth);
  } catch (e) { entry.serv = { error: String(e.message).slice(0, 200) }; entry.agree = null; }
} else entry.serv = null;

const log = existsSync(LOG) ? JSON.parse(readFileSync(LOG)) : { rule, plan: plan.summary, checks: [] };
log.rule = rule; log.plan = plan.summary; log.updated = entry.at;
log.checks = [entry, ...log.checks].slice(0, KEEP);
writeFileSync(LOG, JSON.stringify(log));
console.log(`${new Date(entry.at * 1000).toISOString()} · ${entry.market} · NVDA $${entry.price} · ${entry.drop_pct}% from close · code ${entry.code}` +
  (news ? ` · news ${news.verdict} (${news.headlines?.length ?? 0} read)` : "") + (entry.serv ? ` · SERV ${entry.serv.decision ?? "error"} · ${entry.agree ? "agree" : "DISAGREE"}` : " · SERV skipped (market open)"));

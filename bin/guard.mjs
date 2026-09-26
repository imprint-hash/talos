// The guard: one watch cycle. Reads the market, has SERV walk the approved
// graph on a small model, evaluates the same graph in code, and only if both
// say sell does it prepare a capped sale. Nothing is sent without --send.
//
//   node bin/guard.mjs --rule "If Nvidia drops 3% while the market is closed, sell half."
//   node bin/guard.mjs --plan data/approved-plan.json --send
//
// Needs SERV_API_KEY, and KEEPERHUB_API_KEY (or ~/.chainops/kh_key) for the sale.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { compileRule, walk } from "../src/serv.js";
import { decide } from "../src/history.js";
import { snapshot, CHAIN } from "../src/market.js";
import { prepareSale, dryRun, send, CAPS } from "../src/guard.js";
import { lastClose } from "../src/sessions.js";

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const SEND = process.argv.includes("--send");

let plan;
if (arg("--plan")) plan = JSON.parse(readFileSync(arg("--plan")));
else if (arg("--rule")) {
  ({ plan } = await compileRule(arg("--rule")));
  writeFileSync("data/approved-plan.json", JSON.stringify(plan, null, 1));
  console.log(`compiled by SERV → data/approved-plan.json\n  ${plan.summary}`);
} else { console.log("Give --rule \"...\" or --plan file"); process.exit(1); }

const snap = await snapshot({ positionUsd: Number(arg("--position") || 6), salePct: plan.action.sell_pct });
const truth = decide(plan, snap.facts);
const model = await walk(plan, snap.facts);
const agrees = model.decision === truth.decision && JSON.stringify(model.path.map(p => [p.check, p.passed])) === JSON.stringify(truth.path.map(p => [p.check, p.passed]));
console.log(`market ${snap.facts.market_closed ? "shut" : "open"} · NVDA $${snap.price} · ${-snap.facts.drop_from_close_pct}% since close`);
console.log(`SERV (${model.meta.model}): ${model.decision} — ${model.reason}`);
console.log(`code: ${truth.decision} · ${agrees ? "agree" : "DISAGREE"}`);

if (truth.decision !== "sell" || !agrees) { console.log("Nothing to do."); process.exit(0); }

const sale = await prepareSale({ sellPct: plan.action.sell_pct, decisionAgrees: agrees });
console.log(`sale: ${(Number(sale.amountIn) / 1e18).toFixed(6)} NVDA → about $${sale.quoteUsdg.toFixed(4)} USDG (min $${(Number(sale.minOut) / 1e6).toFixed(4)}), cap $${CAPS.maxSaleUsd}`);
console.log("dry run:", JSON.stringify(await dryRun(sale)));
if (!SEND) { console.log("Dry run only. Add --send to sell."); process.exit(0); }

const stretchKey = String(lastClose(snap.at));
const receipts = await send(sale, stretchKey);
console.log(JSON.stringify(receipts, null, 1));
const swap = receipts.find(r => r.step === "swap" && r.hash);
if (swap) {
  const file = "data/receipts.json";
  const all = existsSync(file) ? JSON.parse(readFileSync(file)) : [];
  all.unshift({
    when: new Date(snap.at * 1000).toUTCString(),
    what: `Sold ${(Number(sale.amountIn) / 1e18).toFixed(6)} NVDA for about $${sale.quoteUsdg.toFixed(2)} USDG`,
    why: model.reason, rule: plan.summary, facts: snap.facts,
    hash: swap.hash, link: `${CHAIN.explorer}/tx/${swap.hash}`,
    approve_hash: receipts.find(r => r.step === "approve")?.hash || null,
  });
  writeFileSync(file, JSON.stringify(all, null, 1));
  console.log(`receipt written: ${CHAIN.explorer}/tx/${swap.hash}`);
}

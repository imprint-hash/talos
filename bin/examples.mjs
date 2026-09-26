// Compile the page's example rules through SERV once and save them, so visitors
// see real SERV output instantly without spending credit on every visit.
import { writeFileSync } from "node:fs";
import { compileRule } from "../src/serv.js";
const rules = [
  "If Nvidia drops 3% while the market is closed, sell half.",
  "Sell everything if NVDA falls 5% over a weekend, but never more than $500 in one go.",
  "Sell $20 of Nvidia on any drop at night, even a small one.",
];
const out = [];
for (const rule of rules) {
  const { plan, meta } = await compileRule(rule);
  out.push({ rule, plan, meta: { ...meta, compiled_at: new Date().toISOString() } });
  console.log(`✓ ${rule}\n  ${plan.summary}`);
}
writeFileSync("data/examples.json", JSON.stringify(out, null, 1));

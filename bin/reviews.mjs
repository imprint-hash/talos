// Review the page's example rules through SERV once and save them, and compile
// each suggested rule too, so trying a suggestion on the page opens instantly.
import { readFileSync, writeFileSync } from "node:fs";
import { reviewRule } from "../src/review.js";
import { compileRule } from "../src/serv.js";
const rows = JSON.parse(readFileSync("data/nvda_15m.json"));
const examples = JSON.parse(readFileSync("data/examples.json")).slice(0, 3);
const reviews = {}, extra = [];
for (const e of examples) {
  const r = await reviewRule(rows, e.rule, { ...e.plan, position_usd: 1000 });
  reviews[e.rule] = r;
  console.log(`✓ ${e.rule}\n  ${r.headline}\n  → ${r.suggested_rule} (numbers confirmed: ${r.verified})`);
  if (r.suggested_rule) {
    const { plan, meta } = await compileRule(r.suggested_rule);
    extra.push({ rule: r.suggested_rule, plan, meta: { ...meta, compiled_at: new Date().toISOString() }, suggested: true });
  }
}
writeFileSync("data/reviews.json", JSON.stringify(reviews, null, 1));
writeFileSync("data/examples.json", JSON.stringify([...examples, ...extra], null, 1));

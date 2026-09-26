// The scoreboard: does a small model walking the graph through SERV get the
// same answer as the code, as often as a big model called directly?
//
// Test cases are real closed-market moments from the pool's history, plus the
// awkward ones a live run meets: a drop a hair under the trigger, a sale that
// already fired, the market open, a missing normal day. Each setup walks the
// same graph over the same facts; the code's exact evaluation is the answer key.
//
//   node bin/eval.mjs            → data/scoreboard.json

import { readFileSync, writeFileSync } from "node:fs";
import { closedPeriods } from "../src/sessions.js";
import { stretch, factsAt, decide } from "../src/history.js";
import { walk, walkProse, WALK_MODEL } from "../src/serv.js";
const PROSE = process.argv.includes("--prose");

const rows = JSON.parse(readFileSync("data/nvda_15m.json"));
const plan = {
  ticker: "NVDA", position_usd: 1000, action: { type: "sell", sell_pct: 50 },
  checks: [
    { id: "C1", type: "market_closed", threshold: null }, { id: "C2", type: "drop_from_close", threshold: 3 },
    { id: "C3", type: "move_vs_normal_day", threshold: 1 }, { id: "C4", type: "price_impact", threshold: 1 },
    { id: "C5", type: "already_fired", threshold: null }, { id: "C6", type: "size_cap", threshold: 600 },
  ],
};

// Real moments: the deepest point of each stretch, and one ordinary point.
const cases = [];
for (const p of closedPeriods(rows[0][0], rows[rows.length - 1][0])) {
  const s = stretch(rows, p); if (!s || !s.steps.length) continue;
  const deepest = s.steps.reduce((a, b) => (b.close < a.close ? b : a));
  cases.push({ from: `${p.kind} ${p.label}, deepest`, facts: factsAt(s, deepest, plan, p, false) });
  cases.push({ from: `${p.kind} ${p.label}, midway`, facts: factsAt(s, s.steps[s.steps.length >> 1], plan, p, false) });
}
// The awkward ones, built from real facts with one thing changed.
const base = cases.find(c => c.facts.drop_from_close_pct > 3.3)?.facts || cases[0].facts;
const edge = (from, change) => cases.push({ from, facts: { ...base, ...change } });
edge("a hair under the trigger", { drop_from_close_pct: 2.99, move_vs_normal_day: 1.4 });
edge("exactly on the trigger", { drop_from_close_pct: 3, move_vs_normal_day: 1.4 });
edge("already sold this stretch", { already_fired: true });
edge("market open", { market_closed: false, stretch: "open" });
edge("no normal day on record", { move_vs_normal_day: null, normal_day_pct: null });
edge("big drop, thin book", { drop_from_close_pct: 6.1, move_vs_normal_day: 2.3, price_impact_pct: 1.8 });
edge("sale over the cap", { sale_usd: 750 });
edge("drop just under a normal day", { drop_from_close_pct: 3.4, move_vs_normal_day: 0.99 });

// Keep the set balanced and affordable: every awkward case, and an even spread of the rest.
const awkward = cases.slice(-8), real = cases.slice(0, -8);
const step = Math.max(1, Math.floor(real.length / 32));
const set = [...real.filter((_, i) => i % step === 0).slice(0, 32), ...awkward];

// SERV's published prices per million tokens (input, output).
const PRICE = { "gpt-6-luna": [0.13, 0.65], "gpt-5.5": [6.5, 39], "gpt-6-sol": [2.6, 13] };
const SETUPS = [
  { label: "Small model, called directly", model: WALK_MODEL, raw: true },
  { label: "Small model, through SERV", model: WALK_MODEL, raw: false },
  { label: "Frontier model, called directly", model: "gpt-5.5", raw: true },
];

// Scored on the decision and the yes/no at each step, in order. Check names are
// not compared: SERV redacts identifiers it thinks come from the system prompt.
const same = (a, b) => a.decision === b.decision && JSON.stringify(a.path.map(p => p.passed)) === JSON.stringify(b.path.map(p => p.passed));

async function run(setup) {
  let correct = 0, tokIn = 0, tokOut = 0, ms = 0, errors = 0; const misses = [];
  for (let i = 0; i < set.length; i += 4) {
    const batch = set.slice(i, i + 4);
    const out = await Promise.all(batch.map(async c => {
      const truth = decide(plan, c.facts);
      try {
        const w = await (PROSE ? walkProse : walk)(plan, c.facts, { model: setup.model, raw: setup.raw });
        return { c, truth, w };
      } catch (e) { return { c, truth, err: e.message }; }
    }));
    for (const o of out) {
      if (o.err) { errors++; misses.push({ case: o.c.from, error: o.err.slice(0, 120) }); continue; }
      tokIn += o.w.meta.usage?.prompt_tokens || 0; tokOut += o.w.meta.usage?.completion_tokens || 0; ms += o.w.meta.ms;
      if (same(o.w, o.truth)) correct++; else misses.push({ case: o.c.from, model: o.w.decision, truth: o.truth.decision });
    }
    process.stdout.write(".");
  }
  const n = set.length - errors;
  const [pi, po] = PRICE[setup.model];
  const cost = n ? ((tokIn * pi + tokOut * po) / 1e6) / n * 1000 : 0;
  return { label: setup.label, model: setup.model, through_serv: !setup.raw, correct, total: set.length, errors, ms: n ? Math.round(ms / n) : 0, cost_per_1000: +cost.toFixed(3), misses: misses.slice(0, 12) };
}

const rowsOut = [];
for (const s of SETUPS) { rowsOut.push(await run(s)); console.log(`\n${s.label}: ${rowsOut.at(-1).correct}/${set.length}`); }
const board = {
  generated_at: new Date().toISOString(), cases: set.length, graph: "sell half on a 3% drop, with Talos's checks", given_as: PROSE ? "a paragraph of plain English" : "the approved flowchart",
  note: `${set.length} moments: ${set.length - 8} real closed-market moments from the NVDA/USDG pool plus 8 awkward edge cases. "Exactly right" means the same decision and the same yes/no at every check as the code. Cost uses SERV's published per-token prices; direct calls are billed at the provider's own tier, which may be lower.`,
  rows: rowsOut,
};
writeFileSync(PROSE ? "data/scoreboard-prose.json" : "data/scoreboard.json", JSON.stringify(board, null, 1));
console.log(JSON.stringify(board.rows.map(r => [r.label, `${r.correct}/${r.total}`, r.cost_per_1000, r.ms]), null, 0));

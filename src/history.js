// Replays a rule over every real closed-market stretch in the NVDA/USDG pool's
// history, so a person sees what their rule would have done before it can
// touch their money. All arithmetic lives here, in code; none of it is left
// to a model.

import { closedPeriods, nyTime } from "./sessions.js";

// A move counts as "back" or "further down" at the open only past this band;
// inside it the open is called flat.
const FLAT = 0.3;

const at = (t, ts) => {
  let lo = 0, hi = t.length - 1, i = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (t[m] <= ts) { i = m; lo = m + 1; } else hi = m - 1; }
  return i;
};

// Median high-to-low range of the last ten regular sessions before `ts`, as a
// share of price. That is what an ordinary day looks like for this token.
export function normalDay(rows, ts) {
  const t = rows.map(r => r[0]);
  const ranges = [];
  for (let back = 1; ranges.length < 10 && back < 30; back++) {
    const day = new Date((ts - back * 86400) * 1000);
    const wd = day.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
    const a = at(t, nyTime(y, m, d, 9, 30)), b = at(t, nyTime(y, m, d, 16));
    if (a < 0 || b <= a) continue;
    let hi = -Infinity, lo = Infinity;
    for (let i = a + 1; i <= b; i++) { hi = Math.max(hi, rows[i][2]); lo = Math.min(lo, rows[i][3]); }
    if (isFinite(hi) && lo > 0) ranges.push((hi - lo) / rows[b][4]);
  }
  if (ranges.length < 5) return null;
  ranges.sort((x, y) => x - y);
  return ranges[ranges.length >> 1];
}

// For one closed stretch: the reference close, and every 15-minute step after it.
export function stretch(rows, period) {
  const t = rows.map(r => r[0]);
  const i0 = at(t, period.close), i1 = at(t, period.open);
  if (i0 < 0 || i1 <= i0) return null;
  const ref = rows[i0][4];
  const steps = [];
  for (let i = i0 + 1; i <= i1; i++) steps.push({ ts: rows[i][0], low: rows[i][3], close: rows[i][4], vol: rows[i][5] });
  return { ref, steps, openPrice: rows[i1][4], normal: normalDay(rows, period.close) };
}

// The facts a decision is made on at one moment inside a stretch. Numbers only.
export function factsAt(s, step, plan, period, firedAlready) {
  const drop = (1 - step.close / s.ref) * 100;
  return {
    market_closed: true,
    stretch: period.kind,
    drop_from_close_pct: +drop.toFixed(2),
    normal_day_pct: s.normal ? +(s.normal * 100).toFixed(2) : null,
    move_vs_normal_day: s.normal ? +((drop / 100) / s.normal).toFixed(2) : null,
    real_news: "not_replayed",
    price_impact_pct: 0.02,           // the main pool is deep; live runs quote it
    already_fired: firedAlready,
    position_usd: plan.position_usd ?? 1000,
    sale_usd: +((plan.position_usd ?? 1000) * plan.action.sell_pct / 100).toFixed(2),
  };
}

// The rule, evaluated exactly. This is the ground truth the model's walk is
// checked against, and the only thing allowed to authorise a trade.
export function decide(plan, f) {
  const path = [];
  for (const c of plan.checks) {
    let pass;
    switch (c.type) {
      case "market_closed": pass = f.market_closed; break;
      case "drop_from_close": pass = f.drop_from_close_pct >= c.threshold; break;
      case "move_vs_normal_day": pass = f.move_vs_normal_day != null && f.move_vs_normal_day >= c.threshold; break;
      // Headlines can't be replayed reliably, so history is judged on the numbers alone.
      case "real_news": pass = f.real_news === true || f.real_news === "not_replayed"; break;
      case "price_impact": pass = f.price_impact_pct <= c.threshold; break;
      case "already_fired": pass = !f.already_fired; break;
      case "size_cap": pass = f.sale_usd <= c.threshold; break;
      default: pass = true;
    }
    path.push({ check: c.id, passed: pass });
    if (!pass) return { path, decision: "hold" };
  }
  return { path, decision: plan.action.type };
}

// Replay the plan over every stretch in the data.
export function replay(rows, plan) {
  const periods = closedPeriods(rows[0][0], rows[rows.length - 1][0]);
  const results = [];
  for (const p of periods) {
    const s = stretch(rows, p);
    if (!s) continue;
    let fired = null;
    for (const step of s.steps) {
      const f = factsAt(s, step, plan, p, false);
      if (decide(plan, f).decision !== "hold") { fired = { ts: step.ts, price: step.close, facts: f }; break; }
    }
    const deepest = Math.min(...s.steps.map(x => x.low));
    const row = { label: p.label, kind: p.kind, ref: s.ref, deepest_pct: +((deepest / s.ref - 1) * 100).toFixed(2), open_pct: +((s.openPrice / s.ref - 1) * 100).toFixed(2) };
    if (!fired) { results.push({ ...row, outcome: "never" }); continue; }
    const after = (s.openPrice / fired.price - 1) * 100;
    const outcome = after > FLAT ? "bounced" : after < -FLAT ? "kept_falling" : "flat";
    // What selling did, per $1,000 held, against simply holding to the open.
    const soldUsd = (plan.position_usd ?? 1000) * plan.action.sell_pct / 100;
    const vsHolding = soldUsd * (-after / 100);
    results.push({ ...row, outcome, fired_at: fired.ts, fired_price: fired.price, fired_drop_pct: fired.facts.drop_from_close_pct, after_pct: +after.toFixed(2), vs_holding_usd: +vsHolding.toFixed(2) });
  }
  const count = k => results.filter(r => r.outcome === k).length;
  return {
    stretches: results.length,
    weekends: results.filter(r => r.kind === "weekend").length,
    nights: results.filter(r => r.kind === "night").length,
    never: count("never"), bounced: count("bounced"), kept_falling: count("kept_falling"), flat: count("flat"),
    net_vs_holding_usd: +results.reduce((a, r) => a + (r.vs_holding_usd || 0), 0).toFixed(2),
    results,
  };
}

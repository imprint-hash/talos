// One live check, the same everywhere (website, watch, guard): read the chain,
// have SERV judge the news while the market is shut, and evaluate the plan in
// code. The model's walk of the graph is done by the caller.

import { snapshot } from "./market.js";
import { headlines, judgeNews, newsFact } from "./news.js";
import { decide } from "./history.js";

export async function checkNow(plan, { positionUsd = 1000 } = {}) {
  const snap = await snapshot({ positionUsd, salePct: plan.action.sell_pct });
  let news = null;
  if (snap.facts.market_closed && plan.checks.some(c => c.type === "real_news")) {
    try { news = await judgeNews({ ...snap.facts, last_close_at: snap.last_close_at }, await headlines(snap.last_close_at)); }
    catch (e) { news = { verdict: "error", cites: [], reason: `Talos couldn't read the news (${String(e.message).slice(0, 120)}), so it holds.`, verified: false, headlines: [] }; }
  }
  snap.facts.real_news = newsFact(news);
  return { snap, news, truth: decide(plan, snap.facts) };
}

export const agree = (model, truth) => !!model && model.decision === truth.decision &&
  JSON.stringify(model.path.map(p => [p.check, p.passed])) === JSON.stringify(truth.path.map(p => [p.check, p.passed]));

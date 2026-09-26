import { body, send, cleanPlan } from "./_lib.mjs";
import { snapshot } from "../src/market.js";
import { walk } from "../src/serv.js";
import { decide } from "../src/history.js";

// Right now: the facts from the chain, SERV's walk of the approved graph on a
// small model, and the code's own evaluation. A sale is only ever allowed when
// the two agree; this route never sells.
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST a plan" });
  try {
    const plan = cleanPlan((await body(req)).plan);
    const snap = await snapshot({ positionUsd: 1000, salePct: plan.action.sell_pct });
    const truth = decide(plan, snap.facts);
    let model = null, error = null;
    try { model = await walk(plan, snap.facts); } catch (e) { error = e.message; }
    const agrees = !!model && model.decision === truth.decision && JSON.stringify(model.path.map(p => [p.check, p.passed])) === JSON.stringify(truth.path.map(p => [p.check, p.passed]));
    send(res, 200, { snapshot: snap, model, truth, agrees, error });
  } catch (e) { send(res, 502, { error: e.message }); }
}

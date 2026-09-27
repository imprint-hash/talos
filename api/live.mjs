import { body, send, cleanPlan } from "./_lib.mjs";
import { walk } from "../src/serv.js";
import { checkNow, agree } from "../src/check.js";

// Right now: the facts from the chain, SERV's reading of the news, SERV's walk of the approved graph on a
// small model, and the code's own evaluation. A sale is only ever allowed when
// the two agree; this route never sells.
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST a plan" });
  try {
    const plan = cleanPlan((await body(req)).plan);
    const { snap, news, truth } = await checkNow(plan);
    let model = null, error = null;
    try { model = await walk(plan, snap.facts); } catch (e) { error = e.message; }
    send(res, 200, { snapshot: snap, news, model, truth, agrees: agree(model, truth), error });
  } catch (e) { send(res, 502, { error: e.message }); }
}

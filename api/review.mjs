import { body, send, history, readJson, cleanPlan } from "./_lib.mjs";
import { reviewRule } from "../src/review.js";

// SERV's review of a rule against its own replay, with every number checked by
// code. The page's example rules were reviewed once and saved (bin/reviews.mjs).
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST a rule and plan" });
  try {
    const { rule, plan } = await body(req);
    const text = String(rule || "").trim().slice(0, 400);
    const saved = readJson("data/reviews.json", {})[text];
    if (saved) return send(res, 200, { ...saved, saved: true });
    send(res, 200, await reviewRule(history(), text, cleanPlan(plan)));
  } catch (e) { send(res, 502, { error: e.message }); }
}

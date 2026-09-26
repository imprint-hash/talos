import { send, readJson } from "./_lib.mjs";
import { snapshot } from "../src/market.js";

// The market strip, the latest receipts and the scoreboard, for the page header.
export default async function handler(req, res) {
  let snap = null;
  try { snap = await snapshot({ positionUsd: 1000, salePct: 50 }); } catch {}
  send(res, 200, { snapshot: snap, receipts: readJson("data/receipts.json", []), scoreboard: readJson("data/scoreboard.json", null) });
}

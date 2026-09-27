// Shared helpers for the serverless routes.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
export const readJson = (p, fallback = null) => { try { return JSON.parse(readFileSync(join(root, p), "utf8")); } catch { return fallback; } };
export const history = () => readJson("data/nvda_15m.json", []);

export async function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = []; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch { return {}; }
}
export function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(data));
}
// A plan comes back from the browser; only its shape is trusted, never its numbers beyond range.
export function cleanPlan(p) {
  if (!p || !Array.isArray(p.checks) || !p.action) throw new Error("No plan");
  const TYPES = ["market_closed", "drop_from_close", "move_vs_normal_day", "real_news", "price_impact", "already_fired", "size_cap"];
  const checks = p.checks.filter(c => TYPES.includes(c.type)).slice(0, 6).map((c, i) => ({
    id: `C${i + 1}`, type: c.type, threshold: c.threshold == null ? null : Math.max(0, Math.min(Number(c.threshold) || 0, 100000)),
    label: String(c.label || "").slice(0, 60), why: String(c.why || "").slice(0, 200), added_by: c.added_by === "you" ? "you" : "talos",
  }));
  return { ticker: "NVDA", summary: String(p.summary || "").slice(0, 300), action: { type: "sell", sell_pct: Math.max(1, Math.min(Number(p.action.sell_pct) || 50, 100)) }, checks, assumptions: (p.assumptions || []).slice(0, 5), unclear: (p.unclear || []).slice(0, 5), position_usd: 1000 };
}

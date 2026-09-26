// Refresh data/nvda_15m.json: every 15-minute candle of the NVDA/USDG pool on
// Robinhood Chain since it opened, from GeckoTerminal.
import { writeFileSync } from "node:fs";
import { POOL } from "../src/market.js";
const rows = new Map(); let before = "";
for (let page = 0; page < 20; page++) {
  const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${POOL}/ohlcv/minute?aggregate=15&limit=1000&currency=usd&token=base${before ? `&before_timestamp=${before}` : ""}`, { headers: { accept: "application/json" } });
  const list = (await r.json()).data?.attributes?.ohlcv_list || [];
  if (list.length <= 1) break;
  for (const x of list) rows.set(x[0], x.map(Number));
  before = Math.min(...list.map(x => x[0]));
  await new Promise(r => setTimeout(r, 2500));
}
const out = [...rows.values()].sort((a, b) => a[0] - b[0]);
writeFileSync("data/nvda_15m.json", JSON.stringify(out));
console.log(`${out.length} candles, ${new Date(out[0][0] * 1000).toISOString()} → ${new Date(out.at(-1)[0] * 1000).toISOString()}`);

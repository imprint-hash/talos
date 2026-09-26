// Live reads from Robinhood Chain: the NVDA/USDG pool's price, what a sale of
// a given size would actually fetch, and the recent price history that the
// last close and a normal day are measured from. Read-only; no keys.

import { lastClose, marketOpen, mintWindowOpen } from "./sessions.js";
import { normalDay } from "./history.js";

export const CHAIN = {
  id: 4663,
  rpc: ["https://robinhood-rpc.publicnode.com", "https://robinhood.drpc.org"],
  explorer: "https://robinhoodchain.blockscout.com",
};
export const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";   // 18 decimals
export const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";   // 6 decimals
export const POOL = "0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3";   // Uniswap v3 NVDA/USDG 0.05%
export const FEE = 500;
export const QUOTER = "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7";  // Uniswap QuoterV2
export const ROUTER = "0xcaf681a66d020601342297493863e78c959e5cb2";  // Uniswap SwapRouter02

const pad = (hex, n = 64) => hex.replace(/^0x/, "").padStart(n, "0");
const word = v => pad(BigInt(v).toString(16));
const addr = a => pad(a.toLowerCase());

export async function rpc(method, params) {
  let last;
  for (const url of CHAIN.rpc) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) { last = e; }
  }
  throw last;
}
const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);

// USDG per NVDA at the pool's current price. token0 is USDG, token1 is NVDA.
export async function midPrice() {
  const out = await call(POOL, "0x3850c7bd");
  const sqrt = BigInt("0x" + out.slice(2, 66));
  const p = Number(sqrt * sqrt) / 2 ** 192;     // NVDA wei per USDG unit
  return 1e12 / p;
}

// What selling `nvdaAmount` tokens would actually return, from Uniswap's quoter.
export async function quoteSell(nvdaWei) {
  const data = "0xc6a5026a" + addr(NVDA) + addr(USDG) + word(nvdaWei) + word(FEE) + word(0);
  const out = await call(QUOTER, data);
  return Number(BigInt("0x" + out.slice(2, 66))) / 1e6;
}

export async function balanceOf(token, holder) {
  const out = await call(token, "0x70a08231" + addr(holder));
  return BigInt(out);
}

// The last ~10 days of 15-minute candles for the pool, from GeckoTerminal.
export async function recentCandles() {
  const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${POOL}/ohlcv/minute?aggregate=15&limit=1000&currency=usd&token=base`, { headers: { accept: "application/json" } });
  const j = await r.json();
  return j.data.attributes.ohlcv_list.map(x => x.map(Number)).sort((a, b) => a[0] - b[0]);
}

// Everything the rule is judged on right now, as plain numbers.
export async function snapshot({ saleNvdaWei, positionUsd = 1000, salePct = 50, now = Math.floor(Date.now() / 1000) } = {}) {
  const [mid, candles, block] = await Promise.all([midPrice(), recentCandles(), rpc("eth_blockNumber", [])]);
  const closeTs = lastClose(now);
  const ci = candles.findLastIndex(c => c[0] <= closeTs);
  const ref = ci >= 0 ? candles[ci][4] : null;
  const normal = normalDay(candles, closeTs);
  const size = saleNvdaWei ?? BigInt(Math.round((positionUsd * salePct / 100) / mid * 1e18));
  const got = await quoteSell(size);
  const fair = Number(size) / 1e18 * mid;
  const impact = Math.max(0, (1 - got / fair) * 100);
  const drop = ref ? (1 - mid / ref) * 100 : null;
  return {
    at: now, block: parseInt(block, 16),
    price: +mid.toFixed(4), last_close: ref ? +ref.toFixed(4) : null, last_close_at: closeTs,
    facts: {
      market_closed: !marketOpen(now),
      stretch: !marketOpen(now) ? (new Date(now * 1000).getUTCDay() % 6 === 0 || new Date(now * 1000).getUTCDay() === 5 ? "weekend" : "night") : "open",
      drop_from_close_pct: drop != null ? +drop.toFixed(2) : null,
      normal_day_pct: normal ? +(normal * 100).toFixed(2) : null,
      move_vs_normal_day: normal && drop != null ? +((drop / 100) / normal).toFixed(2) : null,
      price_impact_pct: +impact.toFixed(3),
      already_fired: false,
      position_usd: positionUsd,
      sale_usd: +(positionUsd * salePct / 100).toFixed(2),
    },
    mint_window_open: mintWindowOpen(now),
    quote: { sell_nvda: Number(size) / 1e18, usdg_out: +got.toFixed(4) },
    candles: candles.slice(-96).map(c => [c[0], +c[4].toFixed(3)]),
  };
}

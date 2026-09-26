// Guard: the only part of Talos that can sell, and it is deliberately narrow.
// It sells NVDA for USDG on the Uniswap pool, from one ring-fenced wallet,
// only when the approved plan says sell, only when the model's walk and the
// code's own evaluation agree, and never above the caps below.

import * as kh from "./keeperhub.js";
import { CHAIN, NVDA, USDG, FEE, ROUTER, balanceOf, quoteSell, rpc } from "./market.js";

export const CAPS = {
  maxSaleUsd: Number(process.env.TALOS_MAX_SALE_USD || 10),   // per sale
  maxSalesPerStretch: 1,
  maxPriceImpactPct: 1,
};

const pad = h => h.replace(/^0x/, "").padStart(64, "0");
const word = v => pad(BigInt(v).toString(16));
const addr = a => pad(a.toLowerCase());

const APPROVE_ABI = [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }];
const SWAP_ABI = [{ type: "function", name: "exactInputSingle", stateMutability: "payable", inputs: [{ name: "params", type: "tuple", components: [
  { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }, { name: "fee", type: "uint24" }, { name: "recipient", type: "address" },
  { name: "amountIn", type: "uint256" }, { name: "amountOutMinimum", type: "uint256" }, { name: "sqrtPriceLimitX96", type: "uint160" }] }], outputs: [{ name: "amountOut", type: "uint256" }] }];

async function allowance(owner, spender) {
  const out = await rpc("eth_call", [{ to: NVDA, data: "0xdd62ed3e" + addr(owner) + addr(spender) }, "latest"]);
  return BigInt(out);
}

// Everything a sale needs, worked out and checked, without sending anything.
export async function prepareSale({ sellPct, decisionAgrees, maxImpactPct = CAPS.maxPriceImpactPct }) {
  if (!decisionAgrees) throw new Error("Model and code disagree on this decision. Talos does not trade on a disagreement.");
  const wallet = await kh.wallet();
  const held = await balanceOf(NVDA, wallet);
  const amountIn = held * BigInt(Math.round(sellPct * 100)) / 10000n;
  if (amountIn === 0n) throw new Error("Nothing to sell in the Talos wallet.");
  const out = await quoteSell(amountIn);
  if (out > CAPS.maxSaleUsd) throw new Error(`Sale of about $${out.toFixed(2)} is over the $${CAPS.maxSaleUsd} cap.`);
  const minOut = BigInt(Math.floor(out * (1 - maxImpactPct / 100) * 1e6));
  const approveData = "0x095ea7b3" + addr(ROUTER) + word(amountIn);
  const swapData = "0x04e45aaf" + addr(NVDA) + addr(USDG) + word(FEE) + addr(wallet) + word(amountIn) + word(minOut) + word(0);
  return { wallet, held, amountIn, quoteUsdg: out, minOut, approveData, swapData, needsApproval: (await allowance(wallet, ROUTER)) < amountIn };
}

export async function dryRun(sale) {
  const steps = [];
  if (sale.needsApproval) steps.push({ step: "approve", ...(await kh.dryRun({ to: NVDA, chainId: CHAIN.id, data: sale.approveData, abi: APPROVE_ABI, value: "0" })) });
  // A swap cannot be simulated before its approval lands, so it is only dry-run once allowance is in place.
  if (!sale.needsApproval) steps.push({ step: "swap", ...(await kh.dryRun({ to: ROUTER, chainId: CHAIN.id, data: sale.swapData, abi: SWAP_ABI, value: "0" })) });
  return steps;
}

export async function send(sale, stretchKey) {
  const receipts = [];
  if (sale.needsApproval) {
    const a = await kh.send({ to: NVDA, chainId: CHAIN.id, data: sale.approveData, abi: APPROVE_ABI, value: "0", idempotencyKey: `talos-approve-${stretchKey}` });
    const s = a.executionId ? await kh.settle(a.executionId) : null;
    receipts.push({ step: "approve", ...a, settled: s?.status, hash: s?.transactionHash || a.hash });
    if (!a.accepted) return receipts;
  }
  const sim = await kh.dryRun({ to: ROUTER, chainId: CHAIN.id, data: sale.swapData, abi: SWAP_ABI, value: "0" });
  if (!sim.ok || sim.wouldRevert) { receipts.push({ step: "swap", refused: true, reason: sim.reason }); return receipts; }
  const w = await kh.send({ to: ROUTER, chainId: CHAIN.id, data: sale.swapData, abi: SWAP_ABI, value: "0", idempotencyKey: `talos-sell-${stretchKey}` });
  const s = w.executionId ? await kh.settle(w.executionId) : null;
  receipts.push({ step: "swap", ...w, settled: s?.status, hash: s?.transactionHash || w.hash });
  return receipts;
}

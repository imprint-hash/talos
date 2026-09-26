# Talos

**Tokenized Nvidia still trades when Wall Street is dark. Approve a reasoning flowchart, not a black-box bot, and Talos sells for you on Robinhood Chain only when your rule and the market both say so.**

Built for the [OpenServ SERV Hackathon](https://www.openserv.ai/hackathon), Edition 01 · Track: **Robinhood · Mainnet & MCP**

---

## The problem

The US stock market is open 32.5 hours of a 168-hour week. For the other 80%, nights and weekends, it is shut, and your broker can't sell anything until it opens again.

Stock tokens on Robinhood Chain don't stop. NVDA trades on Uniswap at 3am on a Sunday. So if something goes wrong while the market sleeps, the only thing that can act for you is something that's awake.

And the obvious fix, a plain stop-loss, turns out to be a bad one. We replayed *"sell half if NVDA drops 3% while the market is closed"* over every real night and weekend since the NVDA/USDG pool opened on 21 July:

| | Fired | Bounced back by the open | Kept falling | Against simply holding, per $1,000 |
|---|---|---|---|---|
| The plain rule | 4 times | 3 | 1 | **−$69.97** |
| The same rule, with Talos's checks | 1 time | 0 | 1 | **+$2.20** |

Most closed-market dips come back by the morning. A dumb stop-loss sells you at the bottom. (48 stretches, 9 of them weekends: a small sample, shown as history, not a forecast.)

## What Talos does

1. **You write your rule in plain English.** *"If Nvidia drops 3% while the market is closed, sell half."*
2. **SERV Reasoning compiles it into a flowchart.** Each "if" becomes a diamond. SERV keeps your numbers exactly as you gave them, flags anything unclear, and adds the checks you didn't think of, each marked **Talos** with a one-line reason:
   - *Is this drop big compared with a normal day for NVDA?* Most closed-market dips of this size come back by the open.
   - *Would selling move the price more than 1%?*
   - *Have I already sold during this closed stretch?*
3. **Talos replays your flowchart on every real night and weekend** before you approve it, and shows what it would have done: never fired, fired and it bounced back, fired and it kept falling, and what that did to your money against simply holding.
4. **You approve the flowchart, not each trade.** From then on, on every check, a small, cheap model walks your approved graph through SERV, and Talos's code evaluates the same graph exactly. **A sale needs both to agree.** The path that decided it lights up.
5. **Talos sells on Robinhood Chain** (NVDA → USDG on Uniswap) from one small wallet, with a per-sale cap, after a dry run.

## Why SERV is the core, not a logo

SERV's research, [BRAID](https://arxiv.org/abs/2512.15959), argues that models go wrong when they reason in paragraphs, and that turning rules into a bounded flowchart lets a small, cheap model perform like a big one. Talos is built on that idea end to end:

| Step | What SERV does |
|---|---|
| Compile | Turns the person's sentence into a typed plan (strict JSON schema) that becomes the flowchart. The **Shadow Agent** validates that every number came from the person's words: *"$20 of Nvidia"* becomes a $20 cap, never 20%. |
| Walk | On every check, `gpt-6-luna` through SERV walks the approved graph and explains the decision in one plain sentence. |
| Guard | Arithmetic, prices and dates never go through a model, following SERV's own guidance. Code measures, SERV reasons, and code checks the conclusion before money moves. |

We turned SERV's content filter off for these calls (`serv_disable_content_filter`): Talos's instructions are published in this repo, so it only produced false alarms.

## Does it work? The scoreboard

We walked the same graph over 40 moments: 32 real closed-market moments from the pool and 8 awkward edge cases (a drop 0.01% under the trigger, a sale that already fired, the market open, no normal day on record, a thin book, a sale over the cap). We scored each setup against Talos's code.

| Setup | Rule given as the flowchart | Cost per 1,000 checks |
|---|---|---|
| Small model (`gpt-6-luna`), called directly | 40/40 | $0.18 |
| Small model, through SERV | 40/40 | $0.21 |
| Frontier model (`gpt-5.5`), called directly | 40/40 | $9.05 |

**Once the rule is a flowchart, the small model decides as well as the frontier model at about 2% of the cost.** That's SERV's core claim, reproduced on a real money task, and it's why Talos compiles every rule into a graph.

**The night that fooled every model.** On Tuesday 4 August NVDA *rose* 7.2% after the close. Given the rule as a paragraph instead of a flowchart, every setup, including the frontier model, read "7.19" as a 7% drop and said **sell**. Talos's code said **hold**, and Talos only trades when the model and the code agree, so it would not have sold into a rally.

**What we are not claiming.** In this test SERV did not make the small model *more* accurate than calling it directly; once the graph exists, both are already right. With the rule as a paragraph, SERV redacted the check names in its answers and reported its steps differently, so it scores lower on exact steps; its sell/hold decisions were right in 39 of 40. Raw results are in [`data/scoreboard.json`](data/scoreboard.json) and [`data/scoreboard-prose.json`](data/scoreboard-prose.json), and `npm run eval` reruns it.

## Safety

- **The website cannot sell.** It compiles, replays and checks. The guard runs separately, from the owner's machine (`bin/guard.mjs`), and only sends with `--send`.
- One ring-fenced wallet (a KeeperHub organisation wallet), a **per-sale cap** (default $10), **one sale per closed stretch**, and a maximum **price impact of 1%** (the swap's minimum output is set from a live Uniswap quote).
- Every sale is **dry-run first**, sent with an idempotency key so a retry can't sell twice, and confirmed on-chain before a receipt is written.
- **Model and code must agree.** A disagreement is logged and nothing happens.

## Receipts

Real sales appear on the page and in [`data/receipts.json`](data/receipts.json), each with its Robinhood Chain transaction.

## Revenue

People already pay for stop-losses. Stock tokens trading while the market is shut have none. Talos sells the missing stop:
- **Watch fee:** a flat monthly fee per ticker watched, or a few basis points of the value protected.
- **Execution fee:** on sales Talos actually makes, never on holds.
- Every compile and every check is a SERV Reasoning call, and it runs on the cheapest model because the rule is a graph.

## How it works

| Path | What it is |
|---|---|
| `src/serv.js` | SERV calls: compile a rule into a plan, draw the flowchart, walk it (flowchart or paragraph) |
| `src/history.js` | Closed-market stretches, what a normal day is, the exact evaluation of a plan, and the replay |
| `src/market.js` | Live reads from Robinhood Chain: pool price, Uniswap quote for the sale size, last close |
| `src/sessions.js` | New York session times, and the stock token mint/burn window |
| `src/guard.js`, `src/keeperhub.js` | The capped sale: dry run, send, settle |
| `api/` | `compile`, `live`, `status` for the website |
| `bin/guard.mjs` | One watch cycle from the owner's machine |
| `bin/eval.mjs` | The scoreboard |
| `data/nvda_15m.json` | Every 15-minute price of the NVDA/USDG pool since it opened (GeckoTerminal) |

Pool: Uniswap v3 NVDA/USDG 0.05% on Robinhood Chain, [`0xd4eb…14a3`](https://robinhoodchain.blockscout.com/address/0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3), about $5.7M of liquidity.

```bash
cp .env.example .env      # add SERV_API_KEY
npm run dev               # http://localhost:3100
npm run guard -- --rule "If Nvidia drops 3% while the market is closed, sell half."
```

Node 20+, no dependencies.

## Limits, said plainly

- **Not advice.** Talos follows the rule you approve. It doesn't predict prices.
- **Small history.** The pool opened on 21 July 2026, so the replay covers 48 closed stretches, 9 of them weekends.
- **One stock, one direction.** NVDA only, sell only, for now.
- **US holidays** aren't modelled; they show up as longer stretches.
- The market is treated as shut outside 09:30–16:00 New York time on weekdays.

## Licence

[MIT](LICENSE)

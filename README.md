# ✦ Veritas

**Know who's behind every token.**

Veritas turns [Nansen](https://nansen.ai) on-chain intelligence into a **trust score for any token**. It maps the token's holders into a live 3D galaxy, uncovers wallets secretly controlled by the same people, and explains every point of the score with on-chain evidence.

Built for the **Nansen Meridian Buildathon** (Sept 14–27, 2026).


## Why

Every token says it's decentralized. Usually nobody can check.

A token with 800 holders can really be 6 insiders who split their bags across hundreds of wallets. Traders only find out when those wallets dump. Honest projects have no way to prove their community is real.

Veritas makes the hidden structure visible:

- **For traders:** before you buy, see whether supply sits with a few hidden wallet clusters, whether linked wallets are selling, and whether Smart Money is getting in or out.
- **For projects:** get a public report and an embeddable trust badge that proves a real holder base. Spot airdrop farmers and insiders in your own token.

## What it does

1. **Search any token** by name, symbol or contract address, on 12 chains.
2. **Watch the galaxy form live.** Every top holder becomes a star, sized by holdings and colored by its Nansen label: Smart Money, exchange, protocol, whale, fresh wallet. While Veritas investigates each wallet, linked wallets pull together into glowing clusters around their shared funder.
3. **Read the trust score (0–100).** Every point is explained: concentration, hidden clusters, insiders selling, Smart Money conviction and fresh-wallet demand.
4. **Fly into a cluster.** Click it to see how many wallets it has, how much supply it controls, what links them (First Funder, Multisig Signer…), and whether it's selling.
5. **Rewind holdings** 30 days, 7 days or 24 hours to watch who accumulated and who distributed.
6. **Share it.** Post the result on X, or open the project report with its embeddable badge.



## Spot the Insider (game)

Every round is a real token Veritas has scanned. The map shows the top holders with their clusters hidden. Pick up to five wallets you think are secretly run by one owner, then reveal the real clusters and links:

- **+100** per pick that belongs to a hidden cluster
- **+50** bonus per pick in the largest cluster
- **−25** per wallet with no hidden links

Three rounds per game. Your best score is kept in your browser. Any token where Veritas finds clusters becomes playable automatically.

## How the score works

Veritas starts at 100 and subtracts transparent, bounded penalties. Each one appears in the UI as a finding.

| Signal | What Veritas measures | Max impact |
|---|---|---|
| Concentration | Share held by the top 10 **real owners**, after linked wallets are merged | −30 |
| Hidden clusters | Share held by the largest cluster, and by all clusters together | −30 |
| Insider selling | Supply moved out by clustered wallets in the last 7 days | −15 |
| Smart Money | Smart Money absent (−5), exiting (up to −12) or accumulating (+5) | −12 / +5 |
| Fresh-wallet demand | Brand-new wallets out-buying proven traders (a farming signal) | −5 |

Grades: **Strong** 80+, **Fair** 60–79, **Caution** 40–59, **High risk** below 40.

**How clusters are found:** for each of the top ~120 non-venue holders, Veritas asks Nansen for the wallet's related wallets. Top holders are merged into one owner when they:
- are directly related to each other (for example, one sent funds to the other), or
- share a non-exchange, non-contract counterparty, such as the same **First Funder** or the same multisig.

Exchanges and protocol contracts are left out of clustering, so "both funded from Binance" never counts as a link.

## Nansen API usage

| Endpoint | Used for | Calls per scan |
|---|---|---|
| `tgm/holders` | Top 200 holders, plus the `smart_money` and `exchange` label groups | 4 |
| `tgm/flow-intelligence` | 7-day flows by Smart Money, whales, exchanges and fresh wallets | 1 |
| `profiler/address/related-wallets` | Links between wallets (First Funder, multisig, transfers) | up to 120 |
| `search/general` | Token search by name or symbol | as you type |
| `token-screener` | Markets page: price, market cap, volume, net flow, liquidity and age per chain | 1 per list view (cached 10 min) |
| `smart-money/netflow` | "Smart Money is buying this week" list on the landing page | 1 per 6 hours |

One full scan makes about **125 calls** (about 140 credits). Every live call is appended to `data/calls.jsonl` and totalled at `/api/stats`, so API usage is auditable. Responses are cached on disk for 6 hours, so re-opening a report costs nothing.

## Run it

You need **Node.js 18 or newer**. There are no dependencies to install.

```bash
git clone <this repo>
cd veritas
cp .env.example .env        # then paste your key from https://app.nansen.ai/api
npm start                   # → http://localhost:3000 (site) and /app (dashboard)
```

Scan a watchlist of tokens in one go. This fills the "Recently verified" leaderboard:

```bash
npm run batch                                    # 9 well-known Ethereum tokens
node scripts/batch-scan.js --chain base 0xabc…   # your own list
```

Run the tests:

```bash
npm test
```

## Deploy

Veritas is a small Node server (it keeps your API key server-side), so it needs a Node host, not static hosting. The repo includes a `render.yaml` for [Render](https://render.com):

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, then pick the repo.
3. Set `NANSEN_API_KEY` in the Render dashboard. Never commit it.

**Protect your credits on a public site:**
- `MAX_SCANS_PER_HOUR` (default 20) caps fresh live scans across all visitors.
- `READ_ONLY=true` turns off new live scans entirely. Visitors can still browse saved reports.

**Pre-fill the site:** run `npm run batch` locally, then commit `data/reports/` and `data/calls.jsonl` before you deploy. Free hosts wipe the disk on restart, but committed reports ship with the app.

## Pages

| Path | What it is |
|---|---|
| `/` | Product site: what Veritas does, live totals, recent verifications |
| `/app` | Dashboard: totals, grade distribution, recent and highest-risk tokens, Smart Money inflows |
| `/app?chain=…&token=…` | Token view: holder map, holders and clusters tables, score breakdown, supply composition |
| `/app?view=markets` | Markets: live token lists per chain from Nansen's token screener (1h / 24h / 7d, all traders or Smart Money only), sortable, with a Scan button on every row |
| `/app?view=game` | Spot the Insider |
| `/app?view=leaderboard` | Every scanned token by trust score |
| `/report?chain=…&token=…` | Shareable project report with embeddable badge |

## Project layout

```
server.js            HTTP server + Server-Sent Events scan stream (zero dependencies)
lib/nansen.js        Nansen client: rate limiting, retries, disk cache, call log
lib/scan.js          Orchestrates one scan and streams progress to the browser
lib/analyze.js       Pure analysis: clustering (union-find) and the trust score
lib/reports.js       Saved reports for the leaderboard, report pages and badges
public/              Front end: scanner, holder map (3d-force-graph, vendored), tables, report page
scripts/batch-scan.js Scan many tokens at once
test/                node:test unit + end-to-end tests (test/support has a fake Nansen client for offline tests)
```

## Embeddable badge

Any scanned token has a live badge:

```html
<a href="https://your-veritas-host/report?chain=ethereum&token=0x…">
  <img src="https://your-veritas-host/api/badge.svg?chain=ethereum&token=0x…" alt="Veritas trust score" height="24">
</a>
```


## Limits and honesty

- The analysis covers the **top holders** Nansen returns (up to 200) and the ~120 largest real owners among them. The long tail isn't investigated.
- Clusters are **evidence of common control, not proof**. Two wallets sharing a first funder is a strong signal, not a verdict. The UI shows the linking relation so you can judge for yourself.
- The score is a heuristic for research. **It is not financial advice.**

## License

MIT. Built by BenSoftie (Softalpha) on the Nansen API.

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



## For memecoin traders

- **Meme Radar**: new launches (≤7 days) per chain, sortable by volume, net flow or liquidity. Flip to **Smart Money** to see which fresh tokens proven traders are buying.
- **Bundle check**: Veritas clusters are what meme traders call bundles: top holders funded by the same wallet. The score and the Clusters tab show how much supply they hold and whether they're selling.
- **Buyers & sellers (24h)**: the biggest buyers and sellers on any token, with Nansen labels, so you can tell Smart Money from fresh wallets.
- **Net flows**: Smart traders, top PnL wallets, whales, fresh wallets and exchanges, as one diverging chart.

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
| `tgm/who-bought-sold` | Token page "Buyers & sellers" tab: top wallets buying and selling in the last 24h, with labels | 2 per token view (cached 10 min) |
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

## Deploy (Vercel)

The repo is ready for [Vercel](https://vercel.com): static pages are served from `public/`, and every `/api/*` route runs in one serverless function (`api/index.js`, configured in `vercel.json` with a 300-second limit, which is enough for a full scan).

1. Push this repo to GitHub.
2. In Vercel: **Add New → Project**, then import the repo. Leave the framework preset as **Other** and keep the default settings.
3. Under **Environment Variables**, add `NANSEN_API_KEY`. Never commit it.
4. Deploy.

**Protect your credits:**
- `MAX_SCANS_PER_HOUR` (default 20) caps fresh live scans to protect your Nansen credits. Set it to `0` for unlimited. It is counted per server instance, so on Vercel treat it as a soft limit.
- `READ_ONLY=true` turns off new live scans entirely. Visitors can still browse saved reports.

**Pre-fill the site:** Vercel's disk is temporary. New scans are cached in `/tmp` and disappear when an instance restarts. Run `npm run batch` locally, then commit `data/reports/` and `data/calls.jsonl` before deploying, so the leaderboard, dashboard and game ship with the app.

A `render.yaml` is also included if you prefer an always-on server on Render.

## Pages

| Path | What it is |
|---|---|
| `/` | Product site: what Veritas does, live totals, recent verifications |
| `/app` | Dashboard: totals, grade distribution, recent and highest-risk tokens, Smart Money inflows |
| `/app?chain=…&token=…` | Token view: holder map, holders and clusters tables, score breakdown, supply composition |
| `/app?view=markets` | Markets: live token lists per chain from Nansen's token screener (1h / 24h / 7d, all traders or Smart Money only), sortable, with a Scan button on every row |
| `/app?view=markets&mode=fresh` | Meme Radar: tokens launched in the last 7 days per chain, with a Smart Money filter to see what proven traders are aping |
| `/app?view=game` | Spot the Insider |
| `/app?view=leaderboard` | Every scanned token by trust score |
| `/report?chain=…&token=…` | Shareable project report with embeddable badge |

## Project layout

```
server.js            HTTP server + Server-Sent Events scan stream (zero dependencies)
api/index.js         Vercel serverless entry (routes every /api/* request to server.js)
lib/paths.js         File locations (repo locally, /tmp on Vercel)
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

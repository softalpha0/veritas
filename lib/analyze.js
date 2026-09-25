// Pure analysis: turns Nansen holder + related-wallet data into a holder graph,
// wallet clusters, and a 0-100 trust score with human-readable findings.
// No I/O here, so it is unit tested directly (see test/analyze.test.js).

const EXCHANGE_RE = /\b(binance|coinbase|okx|okex|kraken|bybit|bitfinex|kucoin|gate\.?io|htx|huobi|bitget|mexc|crypto\.com|upbit|bithumb|gemini|bitstamp|robinhood|exchange|hot wallet|deposit)\b/i;
const CONTRACT_RE = /\b(uniswap|sushiswap|curve|balancer|pancakeswap|aerodrome|raydium|orca|meteora|pool|lp|router|vault|bridge|contract|staking|staked|treasury|multisig|safe|proxy|burn|null|dead|timelock|vesting|aave|compound|lido|morpho|pendle|wrapped)\b/i;
const SMART_RE = /\b(smart trader|smart money|fund)\b/i;
const FIGURE_RE = /\bpublic figure\b/i;
const WHALE_RE = /\b(whale|millionaire|high balance)\b/i;
const FRESH_RE = /\bfresh\b/i;
const FUNDER_RE = /fund(er|ed)/i;

// Score factors, with the most points each can take away.
export const FACTORS = [
  { key: "concentration", label: "Owner concentration", max: 30 },
  { key: "clusters", label: "Hidden clusters", max: 30 },
  { key: "selling", label: "Insider selling", max: 15 },
  { key: "smart", label: "Smart Money", max: 12 },
  { key: "fresh", label: "Fresh-wallet demand", max: 5 },
];

export const CATEGORIES = {
  smart_money: "Smart Money",
  exchange: "Exchange",
  contract: "Protocol / Contract",
  public_figure: "Public Figure",
  whale: "Whale",
  fresh: "Fresh Wallet",
  holder: "Holder",
  hub: "Shared Link",
};

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const lc = (s) => String(s || "").toLowerCase();

// Normalise raw tgm/holders rows. ownership_percentage arrives as a fraction
// (0.0019 = 0.19%); guard against a percent-scaled variant anyway.
export function normalizeHolders(rows) {
  const holders = rows
    .filter((r) => r && r.address)
    .map((r) => ({
      address: lc(r.address),
      label: r.address_label || "",
      amount: num(r.token_amount),
      share: num(r.ownership_percentage),
      valueUsd: num(r.value_usd),
      change24h: num(r.balance_change_24h),
      change7d: num(r.balance_change_7d),
      change30d: num(r.balance_change_30d),
    }));
  const maxShare = Math.max(0, ...holders.map((h) => h.share));
  if (maxShare > 1) for (const h of holders) h.share /= 100;
  // de-duplicate (pages can overlap) keeping the first occurrence
  const seen = new Set();
  return holders.filter((h) => (seen.has(h.address) ? false : seen.add(h.address)));
}

export function classify(h, smartSet, exchangeSet) {
  if (exchangeSet.has(h.address) || EXCHANGE_RE.test(h.label)) return "exchange";
  if (CONTRACT_RE.test(h.label)) return "contract";
  if (smartSet.has(h.address) || SMART_RE.test(h.label)) return "smart_money";
  if (FIGURE_RE.test(h.label)) return "public_figure";
  if (WHALE_RE.test(h.label)) return "whale";
  if (FRESH_RE.test(h.label)) return "fresh";
  return "holder";
}

// Holders worth spending a related-wallets call on: real owners, not venues.
export function isInvestigable(category) {
  return category !== "exchange" && category !== "contract";
}

class UnionFind {
  constructor() { this.p = new Map(); }
  find(x) {
    if (!this.p.has(x)) this.p.set(x, x);
    let r = x;
    while (this.p.get(r) !== r) r = this.p.get(r);
    while (this.p.get(x) !== r) { const n = this.p.get(x); this.p.set(x, r); x = n; }
    return r;
  }
  union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(ra, rb); }
}

// Estimate total supply from any holder with both amount and share.
function estimateSupply(holders) {
  const est = holders.filter((h) => h.amount > 0 && h.share > 0).map((h) => h.amount / h.share).sort((a, b) => a - b);
  return est.length ? est[Math.floor(est.length / 2)] : 0;
}

/**
 * Build the holder graph.
 * @param holders   normalizeHolders() output
 * @param related   Map(address -> related-wallet rows) for investigated holders
 * @param smartSet  Set of addresses Nansen tags as Smart Money for this token
 * @param exchangeSet Set of exchange-held addresses
 */
export function buildGraph(holders, related, smartSet = new Set(), exchangeSet = new Set()) {
  const byAddr = new Map(holders.map((h) => [h.address, h]));
  const uf = new UnionFind();
  const nodes = holders.map((h) => ({
    id: h.address,
    kind: "holder",
    category: classify(h, smartSet, exchangeSet),
    label: h.label,
    share: h.share,
    amount: h.amount,
    valueUsd: h.valueUsd,
    history: {
      d30: Math.max(0, h.amount - h.change30d),
      d7: Math.max(0, h.amount - h.change7d),
      d1: Math.max(0, h.amount - h.change24h),
      now: h.amount,
    },
  }));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) uf.find(n.id);

  const links = [];
  const linkKeys = new Set();
  const addLink = (source, target, relation) => {
    const key = source < target ? `${source}|${target}` : `${target}|${source}`;
    if (linkKeys.has(key)) return;
    linkKeys.add(key);
    links.push({ source, target, relation });
  };

  // relatedAddr -> { label, relations:Set, holders:Set }
  const shared = new Map();
  for (const [holderAddr, rows] of related) {
    const hNode = nodeById.get(holderAddr);
    if (!hNode || !isInvestigable(hNode.category)) continue;
    for (const r of rows || []) {
      const other = lc(r.address);
      if (!other || other === holderAddr) continue;
      const otherNode = nodeById.get(other);
      if (otherNode) {
        // two top holders directly related to each other
        if (isInvestigable(otherNode.category)) {
          addLink(holderAddr, other, r.relation || "related");
          uf.union(holderAddr, other);
        }
        continue;
      }
      if (EXCHANGE_RE.test(r.address_label || "") || CONTRACT_RE.test(r.address_label || "")) continue;
      if (!shared.has(other)) shared.set(other, { label: r.address_label || "", relations: new Set(), holders: new Set() });
      const s = shared.get(other);
      s.relations.add(r.relation || "related");
      s.holders.add(holderAddr);
    }
  }

  // A non-venue address linked to 2+ top holders becomes a visible hub.
  // Venues and contracts were filtered by label above; a big unlabelled funder
  // is kept on purpose, since that is exactly what an airdrop farm looks like.
  for (const [addr, s] of shared) {
    if (s.holders.size < 2) continue;
    const relations = [...s.relations];
    nodes.push({
      id: addr,
      kind: "hub",
      category: "hub",
      label: s.label,
      relation: relations.join(", "),
      isFunder: relations.some((r) => FUNDER_RE.test(r)),
      share: 0,
      amount: 0,
      valueUsd: 0,
    });
    const members = [...s.holders];
    for (const m of members) addLink(m, addr, relations[0]);
    for (let i = 1; i < members.length; i++) uf.union(members[0], members[i]);
  }

  // Assemble clusters (2+ holders that resolve to the same owner group).
  const groups = new Map();
  for (const n of nodes) {
    if (n.kind !== "holder") continue;
    const root = uf.find(n.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(n);
  }
  const hubsByMember = new Map();
  for (const l of links) {
    const hub = nodeById.get(l.target) ? null : l.target;
    if (hub) {
      if (!hubsByMember.has(l.source)) hubsByMember.set(l.source, new Set());
      hubsByMember.get(l.source).add(hub);
    }
  }
  const supply = estimateSupply(holders);
  const clusters = [...groups.values()]
    .filter((g) => g.length >= 2)
    .map((members) => {
      const share = members.reduce((a, m) => a + m.share, 0);
      const via = new Set();
      for (const m of members) for (const h of hubsByMember.get(m.id) || []) via.add(h);
      const change7d = members.reduce((a, m) => a + (byAddr.get(m.id)?.change7d || 0), 0);
      const change30d = members.reduce((a, m) => a + (byAddr.get(m.id)?.change30d || 0), 0);
      return {
        members: members.map((m) => m.id).sort(),
        size: members.length,
        share,
        valueUsd: members.reduce((a, m) => a + m.valueUsd, 0),
        smartMoney: members.filter((m) => m.category === "smart_money").length,
        via: [...via],
        change7dShare: supply ? change7d / supply : 0,
        change30dShare: supply ? change30d / supply : 0,
      };
    })
    .sort((a, b) => b.share - a.share)
    .map((c, i) => ({ id: i + 1, ...c }));

  const clusterOf = new Map();
  for (const c of clusters) for (const m of c.members) clusterOf.set(m, c.id);
  for (const n of nodes) if (n.kind === "holder") n.cluster = clusterOf.get(n.id) || 0;

  return { nodes, links, clusters, supply };
}

/**
 * Score the token. Starts at 100 and subtracts transparent, bounded penalties.
 * Every penalty produces a finding so the number is always explained.
 */
export function scoreToken({ nodes, clusters, supply }, flow = null) {
  const holders = nodes.filter((n) => n.kind === "holder");
  const owners = holders.filter((n) => isInvestigable(n.category));
  const findings = [];

  // Collapse clustered wallets into single entities.
  const entityShare = new Map();
  for (const n of owners) {
    const key = n.cluster ? `c${n.cluster}` : n.id;
    entityShare.set(key, (entityShare.get(key) || 0) + n.share);
  }
  const entities = [...entityShare.values()].sort((a, b) => b - a);
  const top10Entities = entities.slice(0, 10).reduce((a, b) => a + b, 0);
  const top10Wallets = owners.map((n) => n.share).sort((a, b) => b - a).slice(0, 10).reduce((a, b) => a + b, 0);
  const ownerTotal = entities.reduce((a, b) => a + b, 0) || 1;
  const hhi = entities.reduce((a, s) => a + (s / ownerTotal) ** 2, 0);
  const effectiveOwners = hhi ? 1 / hhi : 0;

  const exchangeShare = holders.filter((n) => n.category === "exchange").reduce((a, n) => a + n.share, 0);
  const contractShare = holders.filter((n) => n.category === "contract").reduce((a, n) => a + n.share, 0);
  const smart = holders.filter((n) => n.category === "smart_money");
  const smartShare = smart.reduce((a, n) => a + n.share, 0);
  const smartChange30d = supply ? smart.reduce((a, n) => a + (n.amount - n.history.d30), 0) / supply : 0;

  const clusteredWallets = clusters.reduce((a, c) => a + c.size, 0);
  const clusteredShare = clusters.reduce((a, c) => a + c.share, 0);
  const largest = clusters[0];
  const clusterSold7d = clusters.reduce((a, c) => a + Math.max(0, -c.change7dShare), 0);

  let score = 100;
  const penalize = (points, f) => {
    const p = Math.round(points);
    score -= p;
    findings.push({ ...f, impact: -p });
  };
  const pct = (x) => `${(x * 100).toFixed(x < 0.01 ? 2 : 1)}%`;

  // 1. Concentration, measured on real owners (clusters merged).
  const pConc = clamp01((top10Entities - 0.25) / 0.5) * 30;
  if (pConc >= 1) {
    penalize(pConc, {
      factor: "concentration",
      severity: pConc > 15 ? "bad" : "warn",
      title: "Supply is concentrated",
      detail: `The top 10 owners control ${pct(top10Entities)} of supply once linked wallets are merged${
        top10Entities - top10Wallets > 0.005 ? ` (it looks like ${pct(top10Wallets)} if you count wallets naively)` : ""
      }.`,
    });
  } else {
    findings.push({ factor: "concentration", severity: "good", impact: 0, title: "Healthy distribution", detail: `The top 10 owners hold ${pct(top10Entities)} of supply.` });
  }

  // 2. Hidden clusters.
  if (largest) {
    const pLargest = clamp01((largest.share - 0.02) / 0.2) * 20;
    const pClustered = clamp01((clusteredShare - 0.05) / 0.4) * 10;
    penalize(pLargest + pClustered, {
      factor: "clusters",
      severity: pLargest + pClustered > 12 ? "bad" : pLargest + pClustered > 3 ? "warn" : "info",
      title: `${clusters.length} hidden wallet cluster${clusters.length === 1 ? "" : "s"}`,
      detail: `${clusteredWallets} top-holder wallets resolve to ${clusters.length} linked group${clusters.length === 1 ? "" : "s"} holding ${pct(
        clusteredShare,
      )} of supply. The largest (${largest.size} wallets) holds ${pct(largest.share)}.`,
      cluster: largest.id,
    });
  } else {
    findings.push({ factor: "clusters", severity: "good", impact: 0, title: "No hidden clusters", detail: "No top holders share a funder or are linked to each other." });
  }

  // 3. Linked wallets selling this week.
  if (clusterSold7d > 0.0005) {
    const seller = clusters.reduce((a, c) => (c.change7dShare < (a?.change7dShare ?? 0) ? c : a), null);
    penalize(clamp01(clusterSold7d / 0.02) * 15, {
      factor: "selling",
      severity: clusterSold7d > 0.005 ? "bad" : "warn",
      title: "Linked wallets are selling",
      detail: `Clustered wallets moved out ${pct(clusterSold7d)} of supply in the last 7 days.`,
      cluster: seller?.id,
    });
  }

  // 4. Smart Money conviction.
  if (!smart.length) {
    penalize(5, { factor: "smart", severity: "info", title: "No Smart Money among top holders", detail: "Nansen-labelled smart traders and funds are not in the top holder set." });
  } else if (smartChange30d < -0.002) {
    penalize(clamp01(-smartChange30d / 0.02) * 10 + 2, {
      factor: "smart",
      severity: "warn",
      title: "Smart Money is exiting",
      detail: `${smart.length} Smart Money holders reduced their position by ${pct(-smartChange30d)} of supply over 30 days.`,
    });
  } else {
    const bonus = smartChange30d > 0.0005 ? 5 : 0;
    score += bonus;
    findings.push({
      factor: "smart",
      severity: "good",
      impact: bonus,
      title: smartChange30d > 0.0005 ? "Smart Money is accumulating" : "Smart Money is holding",
      detail: `${smart.length} Smart Money wallet${smart.length === 1 ? "" : "s"} hold ${pct(smartShare)} of supply${
        smartChange30d > 0.0005 ? `, up ${pct(smartChange30d)} in 30 days` : ""
      }.`,
    });
  }

  // 5. Flow intelligence: fresh wallets driving demand is a farming signal.
  if (flow) {
    const fresh = num(flow.fresh_wallets_net_flow_usd);
    const smartFlow = num(flow.smart_trader_net_flow_usd) + num(flow.top_pnl_net_flow_usd);
    if (fresh > 100_000 && fresh > Math.abs(smartFlow) * 3) {
      penalize(5, {
        factor: "fresh",
        severity: "warn",
        title: "Fresh wallets are driving demand",
        detail: `Brand-new wallets net bought $${Math.round(fresh).toLocaleString("en-US")} ${flow.timeframe === "1d" ? "in the last 24 hours" : "this week"}, far outpacing proven traders.`,
      });
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const grade = score >= 80 ? "Strong" : score >= 60 ? "Fair" : score >= 40 ? "Caution" : "High risk";
  const order = { bad: 0, warn: 1, info: 2, good: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  const factors = FACTORS.map((f) => ({
    ...f,
    impact: findings.filter((x) => x.factor === f.key).reduce((a, x) => a + (x.impact || 0), 0),
  }));

  return {
    score,
    grade,
    factors,
    findings,
    metrics: {
      wallets: holders.length,
      owners: owners.length,
      realOwners: entities.length,
      effectiveOwners: Math.round(effectiveOwners * 10) / 10,
      top10Entities,
      top10Wallets,
      clusters: clusters.length,
      clusteredWallets,
      clusteredShare,
      exchangeShare,
      contractShare,
      smartMoney: smart.length,
      smartShare,
      smartChange30d,
      clusterSold7d,
    },
  };
}

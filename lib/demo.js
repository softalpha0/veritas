// Demo mode: a fake Nansen client that serves SYNTHETIC data in the exact
// response shapes of the real API, so the full pipeline runs without a key.
// Everything here is made up and the UI labels it "Sample data".

export const DEMO_TOKEN = "demo";
export const DEMO_META = { name: "Sample Token", symbol: "DEMO", chain: "ethereum", address: DEMO_TOKEN, demo: true };

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function build() {
  const rand = rng(42);
  const hex = () => "0x" + Array.from({ length: 40 }, () => "0123456789abcdef"[Math.floor(rand() * 16)]).join("");
  const SUPPLY = 1_000_000_000;
  const PRICE = 0.42;
  const holders = [];
  const related = new Map();
  const smart = [];
  const exchange = [];

  const add = (label, share, { d24 = 0, d7 = 0, d30 = 0 } = {}) => {
    const address = hex();
    const amount = share * SUPPLY;
    holders.push({
      address,
      address_label: label,
      token_amount: amount,
      ownership_percentage: share,
      value_usd: amount * PRICE,
      balance_change_24h: d24 * amount,
      balance_change_7d: d7 * amount,
      balance_change_30d: d30 * amount,
    });
    related.set(address, []);
    return address;
  };

  // Venues
  for (const [name, share] of [["Binance 14", 0.061], ["Coinbase 10", 0.038], ["OKX 3", 0.022], ["Bybit Hot Wallet", 0.015], ["Kraken 7", 0.009]]) {
    exchange.push(add(name, share));
  }
  add("Uniswap V3: DEMO-WETH Pool", 0.048);
  add("Staking Contract", 0.031);

  // Insider cluster: 16 wallets, one funder, quietly distributing.
  const funderA = hex();
  for (let i = 0; i < 16; i++) {
    const a = add("", 0.009 + rand() * 0.008, { d7: -(0.08 + rand() * 0.1), d30: -(0.15 + rand() * 0.1) });
    related.get(a).push({ address: funderA, address_label: "", relation: "First Funder", order: 1 });
  }
  // Airdrop-farm cluster: 9 fresh wallets, chained funding.
  const farm = [];
  const funderB = hex();
  for (let i = 0; i < 9; i++) {
    const a = add("Fresh Wallet", 0.003 + rand() * 0.002, { d7: 0.4, d30: 1 });
    related.get(a).push({ address: funderB, address_label: "", relation: "First Funder", order: 1 });
    farm.push(a);
  }
  for (let i = 1; i < farm.length; i += 3) related.get(farm[i]).push({ address: farm[i - 1], address_label: "Fresh Wallet", relation: "Sent to", order: 2 });

  // Small team cluster: 4 wallets linked by a shared multisig.
  const multisig = hex();
  for (let i = 0; i < 4; i++) {
    const a = add(i === 0 ? "Deployer" : "", 0.012 + rand() * 0.004, { d30: -0.02 });
    related.get(a).push({ address: multisig, address_label: "", relation: "Multisig Signer of", order: 3 });
  }

  // Smart Money, accumulating.
  for (let i = 0; i < 9; i++) {
    const label = ["90D Smart Trader", "Smart Trader", "Fund", "180D Smart Trader", "30D Smart Trader"][i % 5];
    smart.push(add(label, 0.002 + rand() * 0.006, { d7: 0.1, d30: 0.35 }));
  }
  add("Public Figure", 0.0035);

  // Organic long tail.
  const tailLabels = ["", "", "", "Whale", "Token Millionaire", "High Balance", "", ""];
  while (holders.length < 200) {
    const share = 0.0004 + rand() ** 3 * 0.009;
    add(tailLabels[Math.floor(rand() * tailLabels.length)], share, { d7: (rand() - 0.5) * 0.1, d30: (rand() - 0.45) * 0.3 });
  }
  holders.sort((a, b) => b.ownership_percentage - a.ownership_percentage);
  return { holders, related, smart: new Set(smart), exchange: new Set(exchange) };
}

let cached;
const data = () => (cached ||= build());

export class DemoClient {
  constructor({ delayMs = 60 } = {}) { this.delayMs = delayMs; }
  async post(endpoint, body) {
    await new Promise((r) => setTimeout(r, this.delayMs));
    const d = data();
    const page = (rows) => {
      const { page = 1, per_page = 100 } = body.pagination || {};
      const slice = rows.slice((page - 1) * per_page, page * per_page);
      return { data: slice, pagination: { page, per_page, is_last_page: page * per_page >= rows.length } };
    };
    let res;
    switch (endpoint) {
      case "search/general":
        res = { tokens: [{ name: DEMO_META.name, symbol: DEMO_META.symbol, chain: "ethereum", address: DEMO_TOKEN, market_cap: 420_000_000 }] };
        break;
      case "tgm/holders":
        if (body.label_type === "smart_money") res = page(d.holders.filter((h) => d.smart.has(h.address)));
        else if (body.label_type === "exchange") res = page(d.holders.filter((h) => d.exchange.has(h.address)));
        else res = page(d.holders);
        break;
      case "smart-money/netflow":
        res = { data: [{ token_address: DEMO_TOKEN, token_symbol: "DEMO", net_flow_7d_usd: 412_000, chain: "ethereum" }], pagination: { page: 1, per_page: 10, is_last_page: true } };
        break;
      case "tgm/flow-intelligence":
        res = { data: [{ smart_trader_net_flow_usd: 412_000, top_pnl_net_flow_usd: 150_000, whale_net_flow_usd: -2_100_000, fresh_wallets_net_flow_usd: 2_900_000, exchange_net_flow_usd: 1_700_000 }] };
        break;
      case "profiler/address/related-wallets":
        res = { data: d.related.get(String(body.address).toLowerCase()) || [], pagination: { page: 1, per_page: 25, is_last_page: true } };
        break;
      default:
        throw new Error(`demo: unsupported endpoint ${endpoint}`);
    }
    return { data: res, cached: false, credits: 0 };
  }
}

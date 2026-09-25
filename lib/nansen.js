// Minimal Nansen API client: rate limited, disk cached, and every live call
// appended to data/calls.jsonl so API usage is auditable.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const BASE_URL = process.env.NANSEN_BASE_URL || "https://api.nansen.ai/api/v1";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(ROOT, ".cache");
const DATA_DIR = path.join(ROOT, "data");
const CALL_LOG = path.join(DATA_DIR, "calls.jsonl");

// Fallback credit costs (the live cost comes from the x-nansen-credits-cost header).
const CREDITS = {
  "search/general": 0,
  "tgm/holders": 5,
  "tgm/flow-intelligence": 1,
  "smart-money/netflow": 5,
  "token-screener": 1,
  "tgm/who-bought-sold": 1,
  "profiler/address/related-wallets": 1,
};

export class NansenError extends Error {
  constructor(endpoint, status, text) {
    super(`Nansen ${endpoint} -> HTTP ${status}: ${String(text).slice(0, 200)}`);
    this.endpoint = endpoint;
    this.status = status;
  }
}

// At most `rps` requests in any rolling second (Nansen allows 300/min).
class RateLimiter {
  constructor(rps) { this.rps = rps; this.stamps = []; }
  async take() {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < 1000);
      if (this.stamps.length < this.rps) { this.stamps.push(now); return; }
      await sleep(1000 - (now - this.stamps[0]) + 5);
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class NansenClient {
  constructor(apiKey, { rps = 4, cacheTtlMs = 6 * 3600_000 } = {}) {
    if (!apiKey) throw new Error("NANSEN_API_KEY is not set");
    this.apiKey = apiKey;
    this.limiter = new RateLimiter(rps);
    this.cacheTtlMs = cacheTtlMs;
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  cachePath(endpoint, body) {
    const h = crypto.createHash("sha256").update(endpoint + JSON.stringify(body)).digest("hex").slice(0, 32);
    return path.join(CACHE_DIR, `${h}.json`);
  }

  // POST an endpoint. Returns { data, cached, credits }.
  async post(endpoint, body, { useCache = true, ttlMs = this.cacheTtlMs } = {}) {
    const file = this.cachePath(endpoint, body);
    if (useCache && fs.existsSync(file)) {
      const hit = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Date.now() - hit.storedAt < ttlMs) return { data: hit.data, cached: true, credits: 0 };
    }

    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.limiter.take();
      const started = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      try {
        const res = await fetch(`${BASE_URL}/${endpoint}`, {
          method: "POST",
          headers: { apikey: this.apiKey, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        const text = (await res.text()).split(this.apiKey).join("[redacted]");
        const header = res.headers.get("x-nansen-credits-cost");
        const credits = header != null && header !== "" && Number.isFinite(+header) ? +header : CREDITS[endpoint] ?? 1;
        this.log({ endpoint, status: res.status, ms: Date.now() - started, credits: res.ok ? credits : 0 });
        if (res.status === 429 || res.status >= 500) {
          lastErr = new NansenError(endpoint, res.status, text);
          await sleep(800 * (attempt + 1));
          continue;
        }
        if (!res.ok) throw new NansenError(endpoint, res.status, text);
        const data = JSON.parse(text);
        fs.writeFileSync(file, JSON.stringify({ storedAt: Date.now(), endpoint, body, data }));
        return { data, cached: false, credits };
      } catch (e) {
        lastErr = e;
        if (e instanceof NansenError) throw e;
        if (e.name !== "AbortError") throw e;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  }

  log(entry) {
    fs.appendFileSync(CALL_LOG, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  }
}

// Totals from the call log, for the /api/stats endpoint and the UI footer.
export function callStats() {
  if (!fs.existsSync(CALL_LOG)) return { calls: 0, successful: 0, credits: 0, byEndpoint: {} };
  const lines = fs.readFileSync(CALL_LOG, "utf8").split("\n").filter(Boolean);
  const stats = { calls: 0, successful: 0, credits: 0, byEndpoint: {} };
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    stats.calls++;
    if (e.status >= 200 && e.status < 300) stats.successful++;
    stats.credits += e.credits || 0;
    stats.byEndpoint[e.endpoint] = (stats.byEndpoint[e.endpoint] || 0) + 1;
  }
  return stats;
}

// ---- Typed wrappers for the endpoints Veritas uses ----

export const api = {
  searchTokens: (c, query) =>
    c.post("search/general", { search_query: query, result_type: "token", limit: 20 }),

  // Body mirrors Nansen's official guided-workflow script. labelType
  // "all_holders" = everyone; "smart_money" / "exchange" narrow to label groups.
  // aggregate_by_entity stays off: Veritas does its own clustering.
  holders: (c, chain, token, { page = 1, perPage = 100, labelType = "all_holders" } = {}) =>
    c.post("tgm/holders", {
      chain,
      token_address: token,
      aggregate_by_entity: false,
      label_type: labelType,
      premium_labels: false,
      pagination: { page, per_page: perPage },
      order_by: [{ field: "token_amount", direction: "DESC" }],
    }),

  flowIntelligence: (c, chain, token, timeframe = "7d") =>
    c.post("tgm/flow-intelligence", { chain, token_address: token, timeframe }),

  // Market list for one chain. Timeframes: 5m, 10m, 1h, 6h, 24h, 7d, 30d.
  // trader_type "sm" restricts volumes and flows to Smart Money.
  tokenScreener: (c, chain, { timeframe = "24h", orderBy = "volume", smartMoney = false, maxAgeDays = null, page = 1, perPage = 50 } = {}) =>
    c.post(
      "token-screener",
      {
        chains: [chain],
        timeframe,
        filters: {
          include_stablecoins: false,
          include_native_tokens: false,
          ...(smartMoney ? { trader_type: "sm" } : {}),
          ...(maxAgeDays ? { token_age_days: { min: 0, max: maxAgeDays } } : {}),
        },
        order_by: [{ field: orderBy, direction: "DESC" }],
        pagination: { page, per_page: perPage },
      },
      { ttlMs: 10 * 60_000 },
    ),

  // Top buyers or sellers of a token over a window (ISO timestamps).
  whoBoughtSold: (c, chain, token, side, from, to) =>
    c.post(
      "tgm/who-bought-sold",
      {
        chain,
        token_address: token,
        buy_or_sell: side,
        date: { from, to },
        pagination: { page: 1, per_page: 25 },
        order_by: [{ field: side === "BUY" ? "bought_volume_usd" : "sold_volume_usd", direction: "DESC" }],
      },
      { ttlMs: 10 * 60_000 },
    ),

  // What Smart Money is net buying this week (official workflow step 1).
  smartMoneyNetflow: (c, chain = "ethereum") =>
    c.post("smart-money/netflow", {
      chains: [chain],
      filters: { include_native_tokens: false, include_stablecoins: false },
      order_by: [{ field: "net_flow_7d_usd", direction: "DESC" }],
      pagination: { page: 1, per_page: 10 },
    }),

  relatedWallets: (c, chain, address) =>
    c.post("profiler/address/related-wallets", { chain, address, pagination: { page: 1, per_page: 25 } }),
};

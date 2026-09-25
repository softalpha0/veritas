// Orchestrates one token scan against Nansen, emitting progress events so the
// UI can grow the galaxy live while wallets are being investigated.
import { api } from "./nansen.js";
import { normalizeHolders, buildGraph, scoreToken, classify, isInvestigable } from "./analyze.js";

export const DEFAULTS = { holderPages: 2, investigate: 120, concurrency: 4 };

/**
 * @param client  NansenClient
 * @param chain   e.g. "ethereum"
 * @param token   token contract address
 * @param emit    (event, payload) => void
 */
export async function scanToken(client, chain, token, emit = () => {}, opts = {}) {
  const { holderPages, investigate, concurrency } = { ...DEFAULTS, ...opts };
  const started = Date.now();
  let calls = 0;
  let credits = 0;
  const track = (r) => { if (!r.cached) calls++; credits += r.credits || 0; emit("calls", { calls, credits }); return r; };

  emit("status", { stage: "holders", message: "Pulling the top holders from Nansen…" });

  // 1. Top holders (all), plus Nansen's Smart Money and Exchange label groups.
  const rows = [];
  for (let page = 1; page <= holderPages; page++) {
    const r = track(await api.holders(client, chain, token, { page, perPage: 100 }));
    const data = r.data?.data || [];
    rows.push(...data);
    if (r.data?.pagination?.is_last_page || data.length < 100) break;
  }
  if (!rows.length) throw new Error("Nansen returned no holders for this token on this chain.");

  const labelSet = async (labelType) => {
    try {
      const r = track(await api.holders(client, chain, token, { perPage: 100, labelType }));
      const data = r.data?.data || [];
      return { set: new Set(data.map((d) => String(d.address).toLowerCase())), rows: data };
    } catch (e) {
      emit("warning", { message: `${labelType} holders unavailable: ${e.message}` });
      return { set: new Set(), rows: [] };
    }
  };
  const smart = await labelSet("smart_money");
  const exchange = await labelSet("exchange");

  // Smart Money holders outside the top pages still belong in the picture.
  const holders = normalizeHolders([...rows, ...smart.rows]);
  const initial = buildGraph(holders, new Map(), smart.set, exchange.set);
  emit("holders", { nodes: initial.nodes, supply: initial.supply });

  // 7-day flows; "1d" is the timeframe confirmed in recorded responses, so fall back to it.
  let flow = null;
  for (const timeframe of ["7d", "1d"]) {
    try {
      const r = track(await api.flowIntelligence(client, chain, token, timeframe));
      flow = r.data?.data?.[0] ? { ...r.data.data[0], timeframe } : null;
      break;
    } catch (e) {
      emit("warning", { message: `Flow intelligence (${timeframe}) unavailable: ${e.message}` });
    }
  }

  // 2. Investigate the largest real owners (skip exchanges / contracts).
  const targets = holders
    .filter((h) => isInvestigable(classify(h, smart.set, exchange.set)))
    .sort((a, b) => b.share - a.share)
    .slice(0, investigate);
  emit("status", { stage: "investigate", message: `Investigating ${targets.length} wallets for hidden links…`, total: targets.length });

  const related = new Map();
  let done = 0;
  let lastEmit = 0;
  const queue = [...targets];
  const worker = async () => {
    while (queue.length) {
      const h = queue.shift();
      try {
        const r = track(await api.relatedWallets(client, chain, h.address));
        related.set(h.address, r.data?.data || []);
      } catch (e) {
        related.set(h.address, []);
        if (e.status && e.status !== 404 && e.status !== 422) emit("warning", { message: `related-wallets ${h.address.slice(0, 10)}…: ${e.message}` });
      }
      done++;
      // Re-cluster periodically so links appear while the scan runs.
      if (done - lastEmit >= 10 || done === targets.length) {
        lastEmit = done;
        const g = buildGraph(holders, related, smart.set, exchange.set);
        emit("graph", { nodes: g.nodes, links: g.links, clusters: g.clusters, done, total: targets.length });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length || 1) }, worker));

  // 3. Final graph + score.
  const graph = buildGraph(holders, related, smart.set, exchange.set);
  const result = scoreToken(graph, flow);
  return {
    chain,
    token,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    calls,
    credits,
    flow,
    ...graph,
    ...result,
  };
}

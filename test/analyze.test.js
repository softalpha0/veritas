import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeHolders, buildGraph, scoreToken, classify } from "../lib/analyze.js";
import { scanToken } from "../lib/scan.js";
import { FakeNansenClient, FAKE_TOKEN } from "./support/fake-nansen.js";

const row = (address, share, extra = {}) => ({
  address, address_label: "", token_amount: share * 1e9, ownership_percentage: share, value_usd: share * 1e8,
  balance_change_24h: 0, balance_change_7d: 0, balance_change_30d: 0, ...extra,
});

test("normalizeHolders lowercases, de-duplicates and fixes percent-scaled shares", () => {
  const h = normalizeHolders([row("0xAA", 12), row("0xaa", 12), row("0xbb", 3)]);
  assert.equal(h.length, 2);
  assert.equal(h[0].address, "0xaa");
  assert.ok(Math.abs(h[0].share - 0.12) < 1e-9);
});

test("classify recognises exchanges, contracts and smart money", () => {
  const n = (label) => ({ address: "0x1", label });
  assert.equal(classify(n("Binance 14"), new Set(), new Set()), "exchange");
  assert.equal(classify(n("Uniswap V3: Pool"), new Set(), new Set()), "contract");
  assert.equal(classify(n("90D Smart Trader"), new Set(), new Set()), "smart_money");
  assert.equal(classify(n(""), new Set(["0x1"]), new Set()), "smart_money");
  assert.equal(classify(n(""), new Set(), new Set()), "holder");
});

test("wallets sharing a first funder collapse into one cluster", () => {
  const holders = normalizeHolders([row("0x1", 0.05), row("0x2", 0.04), row("0x3", 0.03), row("0x4", 0.02)]);
  const related = new Map([
    ["0x1", [{ address: "0xf", relation: "First Funder" }]],
    ["0x2", [{ address: "0xf", relation: "First Funder" }]],
    ["0x3", [{ address: "0xf", relation: "First Funder" }]],
    ["0x4", []],
  ]);
  const g = buildGraph(holders, related);
  assert.equal(g.clusters.length, 1);
  assert.deepEqual(g.clusters[0].members, ["0x1", "0x2", "0x3"]);
  assert.ok(Math.abs(g.clusters[0].share - 0.12) < 1e-9);
  assert.ok(g.nodes.some((n) => n.kind === "hub" && n.id === "0xf" && n.isFunder));
});

test("an exchange funder does not create a cluster", () => {
  const holders = normalizeHolders([row("0x1", 0.05), row("0x2", 0.04)]);
  const related = new Map([
    ["0x1", [{ address: "0xe", address_label: "Binance 14", relation: "First Funder" }]],
    ["0x2", [{ address: "0xe", address_label: "Binance 14", relation: "First Funder" }]],
  ]);
  assert.equal(buildGraph(holders, related).clusters.length, 0);
});

test("directly related top holders are linked", () => {
  const holders = normalizeHolders([row("0x1", 0.05), row("0x2", 0.04)]);
  const g = buildGraph(holders, new Map([["0x1", [{ address: "0x2", relation: "Sent to" }]], ["0x2", []]]));
  assert.equal(g.clusters.length, 1);
  assert.equal(g.links.length, 1);
});

test("clustered supply lowers the score and is explained", () => {
  const base = [];
  for (let i = 0; i < 40; i++) base.push(row(`0x${(i + 16).toString(16)}`, 0.005));
  const clean = buildGraph(normalizeHolders(base), new Map());
  const cleanScore = scoreToken(clean).score;

  const insiders = [...base];
  const related = new Map();
  for (let i = 0; i < 10; i++) {
    const a = `0xc${i}`;
    insiders.push(row(a, 0.03, { balance_change_7d: -0.003 * 1e9 }));
    related.set(a, [{ address: "0xfunder", relation: "First Funder" }]);
  }
  const risky = scoreToken(buildGraph(normalizeHolders(insiders), related));
  assert.ok(risky.score < cleanScore - 20, `${risky.score} vs ${cleanScore}`);
  assert.ok(risky.findings.some((f) => /cluster/i.test(f.title)));
  assert.ok(risky.findings.some((f) => /selling/i.test(f.title)));
  assert.equal(risky.metrics.realOwners, 41);
});

test("a full scan runs end to end through the real pipeline", async () => {
  const events = [];
  const r = await scanToken(new FakeNansenClient({ delayMs: 0 }), "ethereum", FAKE_TOKEN, (e) => events.push(e));
  assert.ok(r.nodes.length >= 200);
  assert.ok(r.clusters.length >= 3);
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.ok(events.includes("holders") && events.includes("graph"));
  assert.ok(r.calls > 100, `expected >100 calls, got ${r.calls}`);
});

test("request bodies match Nansen's official guided-workflow shapes", async () => {
  const sent = [];
  const fake = new FakeNansenClient({ delayMs: 0 });
  const recorder = { post: (endpoint, body) => { sent.push({ endpoint, body }); return fake.post(endpoint, body); } };
  await scanToken(recorder, "ethereum", FAKE_TOKEN, () => {}, { investigate: 3 });
  const holders = sent.filter((c) => c.endpoint === "tgm/holders");
  assert.ok(holders.length >= 3);
  for (const { body } of holders) {
    assert.equal(body.chain, "ethereum");
    assert.equal(body.aggregate_by_entity, false);
    assert.equal(body.premium_labels, false);
    assert.ok(["all_holders", "smart_money", "exchange"].includes(body.label_type));
    assert.deepEqual(body.order_by, [{ field: "token_amount", direction: "DESC" }]);
  }
  assert.equal(holders[0].body.label_type, "all_holders");
  const flow = sent.find((c) => c.endpoint === "tgm/flow-intelligence");
  assert.equal(flow.body.timeframe, "7d");
  assert.equal(sent.filter((c) => c.endpoint === "profiler/address/related-wallets").length, 3);
});

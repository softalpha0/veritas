// Veritas server: zero dependencies, Node 18+.
//   node server.js            -> http://localhost:3000
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NansenClient, api, callStats } from "./lib/nansen.js";
import { scanToken } from "./lib/scan.js";
import { DemoClient, DEMO_TOKEN, DEMO_META } from "./lib/demo.js";
import { readReport, saveReport, listReports } from "./lib/reports.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(ROOT, ".env"));

const PORT = Number(process.env.PORT || 3000);
const REPORT_TTL_MS = 6 * 3600_000;

export const CHAINS = ["ethereum", "base", "arbitrum", "bnb", "polygon", "optimism", "avalanche", "linea", "scroll", "mantle", "sonic", "solana"];
const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const live = Boolean(process.env.NANSEN_API_KEY);
const client = live ? new NansenClient(process.env.NANSEN_API_KEY, { rps: Number(process.env.NANSEN_RPS || 4) }) : null;
const demoClient = new DemoClient();
const running = new Set();

// Credit protection for public deployments:
//   READ_ONLY=1              -> no new live scans; saved reports and the demo still work
//   MAX_SCANS_PER_HOUR=20    -> cap on fresh live scans across all visitors
const READ_ONLY = /^(1|true|yes)$/i.test(process.env.READ_ONLY || "");
const MAX_SCANS_PER_HOUR = Number(process.env.MAX_SCANS_PER_HOUR || 20);
const scanTimes = [];
function scanBudgetLeft() {
  const cutoff = Date.now() - 3600_000;
  while (scanTimes.length && scanTimes[0] < cutoff) scanTimes.shift();
  return MAX_SCANS_PER_HOUR - scanTimes.length;
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}



function validTarget(chain, token) {
  if (token === DEMO_TOKEN) return true;
  if (!CHAINS.includes(chain)) return false;
  return chain === "solana" ? SOL_ADDR.test(token) : EVM_ADDR.test(token);
}


// Server-Sent Events scan stream.
async function handleScan(req, res, q) {
  const chain = q.get("chain") || "ethereum";
  const token = (q.get("token") || "").trim();
  const isDemo = token === DEMO_TOKEN;
  if (!validTarget(chain, token)) return send(res, 400, { error: "Invalid chain or token address." });
  if (!isDemo && !live) return send(res, 400, { error: "No NANSEN_API_KEY configured. Add it to .env, or try the demo." });

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const meta = isDemo ? DEMO_META : { name: q.get("name") || "", symbol: q.get("symbol") || "", chain, address: token };
  emit("meta", meta);

  const cached = readReport(isDemo ? "ethereum" : chain, token);
  if (cached && !isDemo && !q.get("refresh") && Date.now() - Date.parse(cached.scannedAt) < REPORT_TTL_MS) {
    emit("result", { ...cached, fromCache: true });
    return res.end();
  }

  if (!isDemo && READ_ONLY) {
    emit("failure", { message: "This public Veritas is read-only: open a token from the leaderboard, or run your own copy for live scans." });
    return res.end();
  }
  if (!isDemo && scanBudgetLeft() <= 0) {
    emit("failure", { message: "Scan limit reached for this hour. Try a token from the leaderboard, or come back soon." });
    return res.end();
  }

  const key = `${chain}:${token.toLowerCase()}`;
  if (running.has(key)) {
    emit("failure", { message: "This token is already being scanned. Try again in a minute." });
    return res.end();
  }
  running.add(key);
  if (!isDemo) scanTimes.push(Date.now());
  let closed = false;
  req.on("close", () => { closed = true; });
  try {
    const result = await scanToken(isDemo ? demoClient : client, isDemo ? "ethereum" : chain, token, (e, d) => { if (!closed) emit(e, d); });
    const report = { ...result, meta };
    saveReport(report);
    if (!closed) emit("result", report);
  } catch (e) {
    if (!closed) emit("failure", { message: e.message });
  } finally {
    running.delete(key);
    res.end();
  }
}

async function handleSearch(res, q) {
  const query = (q.get("q") || "").trim();
  if (!query) return send(res, 400, { error: "Missing q" });
  const demo = /^demo$/i.test(query) ? [DEMO_META] : [];
  if (!live) return send(res, 200, { tokens: demo, live });
  try {
    const r = await api.searchTokens(client, query);
    const tokens = (r.data?.tokens || []).filter((t) => CHAINS.includes(t.chain) && validTarget(t.chain, t.address));
    send(res, 200, { tokens: [...demo, ...tokens], live });
  } catch (e) {
    send(res, 502, { error: e.message });
  }
}

// "Smart Money is buying" feed for the landing page (cached 6h by the client).
async function handleTrending(res) {
  if (!live) return send(res, 200, { tokens: [] });
  try {
    const r = await api.smartMoneyNetflow(client, "ethereum");
    const tokens = (r.data?.data || [])
      .filter((t) => t.token_address && CHAINS.includes(t.chain) && validTarget(t.chain, t.token_address))
      .map((t) => ({ symbol: t.token_symbol, address: t.token_address, chain: t.chain, netflow7d: t.net_flow_7d_usd }));
    send(res, 200, { tokens });
  } catch (e) {
    send(res, 200, { tokens: [], error: e.message });
  }
}

function badge(report) {
  const score = report ? String(report.score) : "–";
  const grade = report ? report.grade : "not scanned";
  const color = !report ? "#5d6570" : report.score >= 80 ? "#3fb67a" : report.score >= 60 ? "#8a93a0" : report.score >= 40 ? "#e0a236" : "#e5534b";
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);
  const right = `${score} · ${grade}`;
  const lw = 104, rw = Math.round(18 + right.length * 6.6);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + rw}" height="22" role="img" aria-label="Veritas trust score: ${esc(right)}">
<rect width="${lw + rw}" height="22" rx="4" fill="#111418" stroke="#2e3540"/><rect x="${lw}" y="0.5" width="${rw - 0.5}" height="21" rx="3.5" fill="#161a20"/>
<rect x="8" y="5" width="12" height="12" rx="3" fill="#5b8def"/><path d="M11 8l3 6 3-6" fill="none" stroke="#0b0d10" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
<g font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="11" font-weight="600"><text x="26" y="15" fill="#e6e8eb">Veritas score</text>
<circle cx="${lw + 10}" cy="11" r="3.5" fill="${color}"/><text x="${lw + 18}" y="15" fill="#e6e8eb">${esc(right)}</text></g></svg>`;
}

function serveStatic(res, pathname) {
  const rel = pathname === "/" ? "index.html" : pathname === "/report" ? "report.html" : pathname.slice(1);
  const file = path.normalize(path.join(ROOT, "public", rel));
  if (!file.startsWith(path.join(ROOT, "public")) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, "Not found", "text/plain");
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const q = url.searchParams;
  try {
    switch (url.pathname) {
      case "/api/config":
        return send(res, 200, { live, readOnly: READ_ONLY, chains: CHAINS });
      case "/api/trending":
        return handleTrending(res);
      case "/api/search":
        return handleSearch(res, q);
      case "/api/scan":
        return handleScan(req, res, q);
      case "/api/report": {
        const r = readReport(q.get("chain") || "ethereum", q.get("token") || "");
        return r ? send(res, 200, r) : send(res, 404, { error: "No report yet. Scan this token first." });
      }
      case "/api/reports":
        return send(res, 200, listReports());
      case "/api/badge.svg":
        return send(res, 200, badge(readReport(q.get("chain") || "ethereum", q.get("token") || "")), "image/svg+xml");
      case "/api/stats":
        return send(res, 200, callStats());
      default:
        return serveStatic(res, url.pathname);
    }
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  ✦ Veritas running at http://localhost:${PORT}`);
  console.log(live ? "  Live mode: using your Nansen API key." : "  Demo mode: no NANSEN_API_KEY found. Add it to .env for live data.");
  if (live) console.log(READ_ONLY ? "  Read-only: new live scans are disabled." : `  Live scans capped at ${MAX_SCANS_PER_HOUR} per hour (MAX_SCANS_PER_HOUR).`);
  console.log("");
});

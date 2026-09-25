// Scan a list of tokens in one go: fills the "Recently verified" leaderboard
// and is the quickest way to put real, useful traffic through the Nansen API.
//
//   node scripts/batch-scan.js                     # default Ethereum watchlist
//   node scripts/batch-scan.js --chain base 0xabc… 0xdef…
//   node scripts/batch-scan.js --investigate 60    # fewer wallets per token, fewer credits
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NansenClient, callStats } from "../lib/nansen.js";
import { scanToken } from "../lib/scan.js";
import { saveReport } from "../lib/reports.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

// Well-known Ethereum tokens with very different holder structures.
const WATCHLIST = [
  { symbol: "UNI", name: "Uniswap", address: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984" },
  { symbol: "PEPE", name: "Pepe", address: "0x6982508145454ce325ddbe47a25d4ec3d2311933" },
  { symbol: "LINK", name: "Chainlink", address: "0x514910771af9ca656af840dff83e8264ecf986ca" },
  { symbol: "AAVE", name: "Aave", address: "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9" },
  { symbol: "SHIB", name: "Shiba Inu", address: "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce" },
  { symbol: "LDO", name: "Lido DAO", address: "0x5a98fcbea516cf06857215779fd812ca3bef1b32" },
  { symbol: "ENA", name: "Ethena", address: "0x57e114b691db790c35207b2e685d4a43181e6061" },
  { symbol: "ONDO", name: "Ondo", address: "0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3" },
  { symbol: "MKR", name: "Maker", address: "0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2" },
];

const args = process.argv.slice(2);
let chain = "ethereum";
let investigate;
const addresses = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--chain") chain = args[++i];
  else if (args[i] === "--investigate") investigate = Number(args[++i]);
  else addresses.push(args[i]);
}
const targets = addresses.length ? addresses.map((a) => ({ address: a, symbol: "", name: "" })) : WATCHLIST;

if (!process.env.NANSEN_API_KEY) {
  console.error("NANSEN_API_KEY is not set. Put it in .env first (see .env.example).");
  process.exit(1);
}
const client = new NansenClient(process.env.NANSEN_API_KEY, { rps: Number(process.env.NANSEN_RPS || 4) });

console.log(`Scanning ${targets.length} tokens on ${chain}…\n`);
for (const t of targets) {
  const label = t.symbol || t.address;
  process.stdout.write(`  ${label.padEnd(8)} `);
  try {
    const r = await scanToken(client, chain, t.address, () => {}, investigate ? { investigate } : {});
    saveReport({ ...r, meta: { name: t.name, symbol: t.symbol, chain, address: t.address } });
    console.log(`score ${String(r.score).padStart(3)} ${r.grade.padEnd(9)} clusters ${String(r.metrics.clusters).padStart(2)}  ${r.calls} calls, ${r.credits} credits`);
  } catch (e) {
    console.log(`failed: ${e.message}`);
  }
}
const s = callStats();
console.log(`\nTotal logged Nansen calls: ${s.calls} (${s.successful} successful, ${s.credits} credits).`);
console.log("Call log: data/calls.jsonl");

// Saved scan reports (data/reports/<chain>_<token>.json). On Vercel, reports
// committed to the repo are read alongside new ones written to /tmp.
import fs from "node:fs";
import path from "node:path";
import { REPORT_DIR, BUNDLED_REPORT_DIR } from "./paths.js";

const DIRS = [...new Set([REPORT_DIR, BUNDLED_REPORT_DIR])];
const fileName = (chain, token) => `${chain}_${token.toLowerCase()}.json`;

export function readReport(chain, token) {
  for (const dir of DIRS) {
    const f = path.join(dir, fileName(chain, token));
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  }
  return null;
}

export function saveReport(report) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, fileName(report.chain, report.token)), JSON.stringify(report));
}

export function listReports() {
  const byName = new Map();
  for (const dir of DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json") || byName.has(f)) continue;
      try {
        const r = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        byName.set(f, { chain: r.chain, token: r.token, name: r.meta?.name, symbol: r.meta?.symbol, score: r.score, grade: r.grade, clusters: r.metrics?.clusters, owners: r.metrics?.owners, realOwners: r.metrics?.realOwners, clusteredShare: r.metrics?.clusteredShare, calls: r.calls, scannedAt: r.scannedAt });
      } catch {
        /* skip unreadable file */
      }
    }
  }
  return [...byName.values()].sort((a, b) => b.score - a.score);
}

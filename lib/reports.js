// Saved scan reports on disk (data/reports/<chain>_<token>.json).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPORT_DIR = path.join(ROOT, "data", "reports");
fs.mkdirSync(REPORT_DIR, { recursive: true });

export const reportFile = (chain, token) => path.join(REPORT_DIR, `${chain}_${token.toLowerCase()}.json`);

export function readReport(chain, token) {
  const f = reportFile(chain, token);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
}

export function saveReport(report) {
  fs.writeFileSync(reportFile(report.chain, report.token), JSON.stringify(report));
}

export function listReports() {
  return fs
    .readdirSync(REPORT_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, f), "utf8"));
        return { chain: r.chain, token: r.token, name: r.meta?.name, symbol: r.meta?.symbol, score: r.score, grade: r.grade, clusters: r.metrics?.clusters, owners: r.metrics?.owners, realOwners: r.metrics?.realOwners, clusteredShare: r.metrics?.clusteredShare, calls: r.calls, scannedAt: r.scannedAt };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

// Where Veritas reads and writes files. Locally everything lives in the repo.
// On Vercel the deployment is read-only, so new files go to /tmp while the
// reports and call log committed to the repo are still read.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SERVERLESS = Boolean(process.env.VERCEL);
const WRITE_ROOT = SERVERLESS ? "/tmp/veritas" : ROOT;

export const PUBLIC_DIR = path.join(ROOT, "public");
export const CACHE_DIR = path.join(WRITE_ROOT, ".cache");
export const BUNDLED_REPORT_DIR = path.join(ROOT, "data", "reports");
export const REPORT_DIR = path.join(WRITE_ROOT, "data", "reports");
export const BUNDLED_CALL_LOG = path.join(ROOT, "data", "calls.jsonl");
export const CALL_LOG = path.join(WRITE_ROOT, "data", "calls.jsonl");

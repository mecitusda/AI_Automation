/**
 * Load `.env` / `.env.local` from the repository root, regardless of process.cwd().
 * Import this file first in integration scripts: `import "./load-root-env.js";`
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { applyPublicDnsFromEnv } from "../apps/api/src/utils/dnsBootstrap.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(repoRoot, ".env.local"), override: true });

applyPublicDnsFromEnv();

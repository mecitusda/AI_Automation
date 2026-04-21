/**
 * Apply Node DNS resolvers before mongodb+srv (SRV) lookups.
 * Default OS resolver (some Windows/corporate networks) may fail querySrv with ECONNREFUSED.
 *
 * Set in .env (comma- or space-separated):
 *   MONGO_DNS_SERVERS=8.8.8.8,1.1.1.1
 * Alias: DNS_SERVERS
 *
 * Call after dotenv has loaded (see index.js, load-root-env.js).
 */
import dns from "node:dns";

export function applyPublicDnsFromEnv() {
  const raw = process.env.MONGO_DNS_SERVERS || process.env.DNS_SERVERS;
  if (!raw?.trim()) return;

  const servers = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!servers.length) return;

  try {
    dns.setServers(servers);
    if (process.env.NODE_ENV !== "production") {
      console.info("[dns] setServers:", dns.getServers());
    }
  } catch (e) {
    console.warn("[dns] setServers failed:", e?.message || e);
  }
}

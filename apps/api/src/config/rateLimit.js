/**
 * Per-plugin rate limits (max requests per second).
 * Env: PLUGIN_RATE_LIMIT_<NAME>=<number>
 * e.g. PLUGIN_RATE_LIMIT_OPENAI=5, PLUGIN_RATE_LIMIT_HTTP=20
 */
function loadRateLimitConfig() {
  const limits = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("PLUGIN_RATE_LIMIT_")) {
      const name = key.slice("PLUGIN_RATE_LIMIT_".length).toLowerCase();
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) limits[name] = n;
    }
  }
  if (limits.openai != null && limits.ai == null) limits.ai = limits.openai;
  return limits;
}

export const pluginRateLimits = loadRateLimitConfig();

export function getLimit(pluginName) {
  return pluginRateLimits[pluginName] ?? null;
}

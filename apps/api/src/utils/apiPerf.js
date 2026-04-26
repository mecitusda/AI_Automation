import { logWarn } from "./logger.js";
import { incrMetric } from "./metricsCounter.js";

const MAX_ENTRIES_PER_ROUTE = Number(process.env.API_PERF_MAX_ENTRIES || 300);
const SLOW_MS = Number(process.env.API_SLOW_REQUEST_MS || 800);
const routeStats = new Map();

function routeKey(req) {
  const base = req.baseUrl || "";
  const path = req.route?.path || req.path || "";
  return `${req.method} ${base}${path}`;
}

function ensureRoute(key) {
  if (!routeStats.has(key)) {
    routeStats.set(key, {
      count: 0,
      errorCount: 0,
      totalMs: 0,
      maxMs: 0,
      durations: [],
      lastStatus: null,
      lastTs: null
    });
  }
  return routeStats.get(key);
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

export function apiPerfMiddleware(req, res, next) {
  const started = process.hrtime.bigint();
  res.on("finish", async () => {
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    const key = routeKey(req);
    const s = ensureRoute(key);
    s.count += 1;
    s.lastStatus = res.statusCode;
    s.lastTs = Date.now();
    s.totalMs += elapsedMs;
    s.maxMs = Math.max(s.maxMs, elapsedMs);
    if (res.statusCode >= 400) s.errorCount += 1;
    s.durations.push(elapsedMs);
    if (s.durations.length > MAX_ENTRIES_PER_ROUTE) s.durations.shift();

    await incrMetric("api.request.total", 1);
    if (res.statusCode >= 400) await incrMetric("api.request.error", 1);
    if (elapsedMs >= SLOW_MS) {
      await incrMetric("api.request.slow", 1);
      logWarn("api.request.slow", {
        route: key,
        status: res.statusCode,
        durationMs: Number(elapsedMs.toFixed(2))
      });
    }
  });
  next();
}

export function getApiPerfSnapshot() {
  const routes = [];
  for (const [key, s] of routeStats.entries()) {
    routes.push({
      route: key,
      count: s.count,
      errorCount: s.errorCount,
      avgMs: s.count > 0 ? Number((s.totalMs / s.count).toFixed(2)) : 0,
      p95Ms: s.durations.length ? Number(percentile(s.durations, 95).toFixed(2)) : null,
      maxMs: Number(s.maxMs.toFixed(2)),
      lastStatus: s.lastStatus,
      lastTs: s.lastTs
    });
  }
  routes.sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0));
  return {
    slowThresholdMs: SLOW_MS,
    routeCount: routes.length,
    routes
  };
}

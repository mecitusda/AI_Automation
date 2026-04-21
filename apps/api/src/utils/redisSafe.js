import { logWarn } from "./logger.js";

let redisDegraded = false;

export function isRedisDegraded() {
  return redisDegraded;
}

export async function withRedisFallback(operationName, fn, fallbackValue) {
  try {
    const result = await fn();
    if (redisDegraded) {
      redisDegraded = false;
      logWarn("redis.recovered", { message: `Redis recovered at ${operationName}` });
    }
    return result;
  } catch (err) {
    if (!redisDegraded) {
      redisDegraded = true;
      logWarn("redis.degraded", {
        message: `Redis degraded mode enabled at ${operationName}: ${err?.message || String(err)}`
      });
    }
    return fallbackValue;
  }
}

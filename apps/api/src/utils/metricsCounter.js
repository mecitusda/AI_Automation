import { redis } from "../config/redis.js";
import { withRedisFallback } from "./redisSafe.js";

function key(metric) {
  return `metrics:counter:${metric}`;
}

export async function incrMetric(metric, by = 1) {
  await withRedisFallback("metrics_counter.incr", async () => {
    await redis.incrby(key(metric), by);
    return true;
  }, false);
}

export async function getMetricsCounters() {
  return withRedisFallback("metrics_counter.get", async () => {
    const keys = [
      "step.success",
      "step.failed",
      "step.retry",
      "step.timeout",
      "run.completed",
      "run.failed",
      "run.cancelled",
      "telegram.send.success",
      "telegram.send.failed",
      "telegram.trigger.received",
      "telegram.trigger.dedupe",
      "telegram.trigger.filtered",
      "telegram.trigger.error",
      "telegram.trigger.secret_mismatch"
    ];
    const values = await Promise.all(keys.map((k) => redis.get(key(k))));
    return Object.fromEntries(
      keys.map((k, i) => [k, Number(values[i] || 0)])
    );
  }, {});
}

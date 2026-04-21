import { redis } from "../config/redis.js";
import { withRedisFallback } from "./redisSafe.js";

const BREAKER_FAIL_THRESHOLD = Number(process.env.BREAKER_FAIL_THRESHOLD || 10);
const BREAKER_WINDOW_SEC = Number(process.env.BREAKER_WINDOW_SEC || 60);
const BREAKER_OPEN_SEC = Number(process.env.BREAKER_OPEN_SEC || 30);
const RUN_RETRY_BUDGET = Number(process.env.RUN_RETRY_BUDGET || 50);

function failureKey(stepType) {
  const slot = Math.floor(Date.now() / 1000);
  return `breaker:fail:${stepType}:${slot}`;
}

function openKey(stepType) {
  return `breaker:open:${stepType}`;
}

export function getRunRetryBudget() {
  return RUN_RETRY_BUDGET;
}

export async function isBreakerOpen(stepType) {
  return withRedisFallback(
    "retry_guard.is_breaker_open",
    async () => (await redis.exists(openKey(stepType))) === 1,
    false
  );
}

export async function recordStepFailure(stepType) {
  await withRedisFallback("retry_guard.record_failure", async () => {
    const k = failureKey(stepType || "unknown");
    const count = await redis.incr(k);
    if (count === 1) {
      await redis.pexpire(k, (BREAKER_WINDOW_SEC + 1) * 1000);
    }
    if (count >= BREAKER_FAIL_THRESHOLD) {
      await redis.set(openKey(stepType || "unknown"), "1", "EX", BREAKER_OPEN_SEC);
    }
    return true;
  }, false);
}

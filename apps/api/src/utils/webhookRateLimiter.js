import { redis } from "../config/redis.js";
import { withRedisFallback } from "./redisSafe.js";

const DEFAULT_LIMIT_PER_SEC = 10;
const SLOT_SEC = 1;

function webhookKey(workflowId, unixSecondSlot) {
  return `ratelimit:webhook:${workflowId}:${unixSecondSlot}`;
}

/**
 * Per-workflow webhook rate limit (requests per second).
 * Uses Redis atomic INCR + PEXPIRE.
 *
 * @param {string} workflowId
 * @param {number} limitPerSec
 * @returns {Promise<boolean>} true if allowed, false if exceeded
 */
export async function checkWebhookRateLimit(workflowId, limitPerSec = DEFAULT_LIMIT_PER_SEC) {
  return withRedisFallback("webhook_rate_limit.check", async () => {
    const unixSecondSlot = Math.floor(Date.now() / 1000);
    const k = webhookKey(workflowId, unixSecondSlot);

    const count = await redis.incr(k);
    if (count === 1) {
      await redis.pexpire(k, (SLOT_SEC + 1) * 1000);
    }
    return count <= limitPerSec;
  }, true);
}


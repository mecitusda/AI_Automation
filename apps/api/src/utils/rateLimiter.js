import { redis } from "../config/redis.js";
import { getLimit } from "../config/rateLimit.js";
import { withRedisFallback } from "./redisSafe.js";

const SLOT_SEC = 1;
const SLEEP_MS = 200;
const MAX_WAIT_MS = 30_000;

function key(pluginName) {
  const slot = Math.floor(Date.now() / 1000);
  return `ratelimit:plugin:${pluginName}:${slot}`;
}

/**
 * Wait until under limit, then increment. Resolves when the caller may proceed.
 * If no limit is configured for pluginName, resolves immediately without incrementing.
 * @param {string} pluginName
 * @throws {Error} if max wait exceeded
 */
export async function check(pluginName) {
  const limit = getLimit(pluginName);
  if (limit == null) return;

  const allowed = await withRedisFallback("plugin_rate_limit.check", async () => {
    const started = Date.now();
    let currentSlot = Math.floor(started / 1000);
    let k = key(pluginName);

    while (true) {
      const count = await redis.incr(k);
      if (count === 1) await redis.pexpire(k, (SLOT_SEC + 1) * 1000);
      if (count <= limit) return true;

      await redis.decr(k);
      if (Date.now() - started >= MAX_WAIT_MS) {
        throw new Error(`Rate limit exceeded for plugin ${pluginName} (max wait ${MAX_WAIT_MS}ms)`);
      }
      await new Promise((r) => setTimeout(r, SLEEP_MS));
      const nextSlot = Math.floor(Date.now() / 1000);
      if (nextSlot !== currentSlot) {
        currentSlot = nextSlot;
        k = key(pluginName);
      }
    }
  }, true);
  if (!allowed) {
    throw new Error(`Rate limit exceeded for plugin ${pluginName}`);
  }
}

/**
 * Increment usage for the current second. Use when you count after execute.
 * No-op if no limit configured.
 */
export async function increment(pluginName) {
  const limit = getLimit(pluginName);
  if (limit == null) return;
  await withRedisFallback("plugin_rate_limit.increment", async () => {
    const k = key(pluginName);
    await redis.incr(k);
    const ttl = await redis.pttl(k);
    if (ttl === -1) await redis.pexpire(k, (SLOT_SEC + 1) * 1000);
    return true;
  }, true);
}

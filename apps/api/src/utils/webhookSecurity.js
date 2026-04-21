import crypto from "crypto";
import { redis } from "../config/redis.js";
import { withRedisFallback } from "./redisSafe.js";

function ipSlotKey(workflowId, ip, unixSecondSlot) {
  return `ratelimit:webhook:ip:${workflowId}:${ip}:${unixSecondSlot}`;
}

export async function checkWebhookIpThrottle({
  workflowId,
  ip,
  limitPerSec = Number(process.env.WEBHOOK_IP_LIMIT_PER_SEC || 5)
}) {
  if (!ip) return true;
  return withRedisFallback("webhook_security.ip_throttle", async () => {
    const unixSecondSlot = Math.floor(Date.now() / 1000);
    const key = ipSlotKey(workflowId, ip, unixSecondSlot);
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.pexpire(key, 2000);
    }
    return count <= limitPerSec;
  }, true);
}

export function verifyWebhookSignature({
  secret,
  rawBody,
  signatureHeader
}) {
  if (!secret) return true;
  if (!signatureHeader) return false;
  const payload = typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody ?? {});
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const normalized = signatureHeader.replace(/^sha256=/i, "").trim();
  if (!normalized) return false;

  const a = Buffer.from(normalized, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

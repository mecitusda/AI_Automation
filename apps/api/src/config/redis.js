import Redis from "ioredis";
import { logWarn, logInfo } from "../utils/logger.js";
export const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true
});

redis.on("connect", () => logInfo("redis.connect", { message: "Redis connected" }));
redis.on("error", (err) => logWarn("redis.error", { message: err?.message || String(err) }));
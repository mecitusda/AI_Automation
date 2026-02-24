import Redis from "ioredis";
console.log("REDIS_URL:", process.env.REDIS_URL);

export const redis = new Redis(process.env.REDIS_URL);

redis.on("connect", () => {
  console.log("Redis connected");
});
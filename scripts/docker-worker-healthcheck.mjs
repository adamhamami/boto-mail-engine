/**
 * Healthcheck worker (Phase 7) — vérifie le heartbeat Redis multi-instance.
 * Exit 0 si au moins un beat frais, sinon 1.
 */
import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://redis:6379";
const staleMs = Number(process.env.ALERT_WORKER_STALE_MS || 60_000);
const indexKey = "ops:worker:heartbeat:index";
const prefix = "ops:worker:heartbeat:inst:";
const legacyKey = "ops:worker:heartbeat";

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 1,
  connectTimeout: 2000,
  lazyConnect: true,
});

try {
  await redis.connect();
  const members = await redis.smembers(indexKey);
  const now = Date.now();
  let fresh = 0;

  for (const id of members) {
    const raw = await redis.get(`${prefix}${id}`);
    if (!raw) continue;
    try {
      const payload = JSON.parse(raw);
      const age = now - new Date(payload.at).getTime();
      if (Number.isFinite(age) && age <= staleMs) fresh += 1;
    } catch {
      /* ignore */
    }
  }

  if (fresh === 0) {
    const legacy = await redis.get(legacyKey);
    if (legacy) {
      const payload = JSON.parse(legacy);
      const age = now - new Date(payload.at).getTime();
      if (Number.isFinite(age) && age <= staleMs) fresh = 1;
    }
  }

  await redis.quit();
  process.exit(fresh > 0 ? 0 : 1);
} catch {
  try {
    redis.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
}

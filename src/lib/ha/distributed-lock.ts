import crypto from "node:crypto";
import { getRedisConnection } from "@/lib/queue";

const RELEASE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export interface DistributedLock {
  key: string;
  token: string;
  release: () => Promise<boolean>;
}

/**
 * Verrou Redis SET NX PX — multi-instance safe.
 * Utilisé pour l'idempotence distribuée (ex. envoi SMTP).
 */
export async function acquireDistributedLock(
  key: string,
  ttlMs: number,
): Promise<DistributedLock | null> {
  const redis = getRedisConnection();
  const token = crypto.randomUUID();
  const fullKey = key.startsWith("ha:lock:") ? key : `ha:lock:${key}`;
  const result = await redis.set(fullKey, token, "PX", ttlMs, "NX");
  if (result !== "OK") {
    return null;
  }

  return {
    key: fullKey,
    token,
    release: async () => {
      const n = await redis.eval(RELEASE_LUA, 1, fullKey, token);
      return Number(n) === 1;
    },
  };
}

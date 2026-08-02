import { getRedisConnection } from "@/lib/queue";
import { logger } from "@/lib/logger";

/**
 * Cache Redis générique (Phase 11) — TTL court, fail-open.
 * Ne jamais y mettre de données RBAC sans clé user/permission.
 */
export async function cacheGetJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await getRedisConnection().get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    logger.warn(
      {
        key,
        err:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : { message: "cache get failed" },
      },
      "Redis cache get failed",
    );
    return null;
  }
}

export async function cacheSetJson(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  if (ttlSeconds <= 0) return;
  try {
    await getRedisConnection().set(
      key,
      JSON.stringify(value),
      "EX",
      ttlSeconds,
    );
  } catch (error) {
    logger.warn(
      {
        key,
        err:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : { message: "cache set failed" },
      },
      "Redis cache set failed",
    );
  }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await getRedisConnection().del(...keys);
  } catch {
    /* ignore */
  }
}

/** Helper get-or-set. */
export async function cacheRemember<T>(
  key: string,
  ttlSeconds: number,
  factory: () => Promise<T>,
): Promise<T> {
  const hit = await cacheGetJson<T>(key);
  if (hit !== null) return hit;
  const value = await factory();
  await cacheSetJson(key, value, ttlSeconds);
  return value;
}

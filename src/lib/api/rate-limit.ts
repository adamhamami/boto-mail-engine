import {
  RateLimiterMemory,
  RateLimiterRedis,
  type RateLimiterAbstract,
} from "rate-limiter-flexible";
import { getEnv } from "@/lib/config/env";
import { getRedisConnection } from "@/lib/queue";
import { logger } from "@/lib/logger";

const limiters = new Map<string, RateLimiterAbstract>();

type LimiterProfile = {
  points: number;
  durationSeconds: number;
};

function profileForKey(key: string): LimiterProfile {
  const env = getEnv();
  if (key === "login" || key === "login-ip") {
    return {
      points: env.LOGIN_RATE_LIMIT_MAX,
      durationSeconds: Math.ceil(env.LOGIN_RATE_LIMIT_WINDOW_MS / 1000),
    };
  }
  // Test SMTP forcé : ouvre des sockets sortants, quota volontairement bas.
  if (key === "smtp-health-test") {
    return { points: 5, durationSeconds: 60 };
  }
  // Test DNS forcé : plusieurs lookups sortants.
  if (key === "dns-health-test") {
    return { points: 10, durationSeconds: 60 };
  }
  // Désinscription publique — anti-bruteforce token / spam.
  if (key === "unsubscribe") {
    return { points: 20, durationSeconds: 60 };
  }
  // api / api-ip / défaut : RATE_LIMIT_*
  return {
    points: env.RATE_LIMIT_MAX_REQUESTS,
    durationSeconds: Math.ceil(env.RATE_LIMIT_WINDOW_MS / 1000),
  };
}

function shouldUseRedisStore(): boolean {
  const env = getEnv();
  if (env.RATE_LIMIT_STORE === "memory") return false;
  if (env.RATE_LIMIT_STORE === "redis") return true;
  // auto : Redis en production (multi-API), mémoire ailleurs (tests/dev).
  return env.NODE_ENV === "production";
}

function getLimiter(key: string): RateLimiterAbstract {
  if (!limiters.has(key)) {
    const profile = profileForKey(key);
    const memory = new RateLimiterMemory({
      points: profile.points,
      duration: profile.durationSeconds,
      keyPrefix: `rlm:${key}`,
    });

    if (shouldUseRedisStore()) {
      try {
        const redisLimiter = new RateLimiterRedis({
          storeClient: getRedisConnection(),
          keyPrefix: `rl:${key}`,
          points: profile.points,
          duration: profile.durationSeconds,
          insuranceLimiter: memory,
        });
        limiters.set(key, redisLimiter);
      } catch (error) {
        logger.warn(
          {
            key,
            err:
              error instanceof Error
                ? { name: error.name, message: error.message }
                : { message: "rate limiter redis init failed" },
          },
          "Rate limiter falling back to memory",
        );
        limiters.set(key, memory);
      }
    } else {
      limiters.set(key, memory);
    }
  }
  return limiters.get(key)!;
}

/** Tests uniquement — invalide les limiters après changement d’env. */
export function resetRateLimiters(): void {
  limiters.clear();
}

export async function consumeRateLimit(
  key: string,
  identifier: string,
): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  try {
    await getLimiter(key).consume(identifier);
    return { allowed: true };
  } catch (rej) {
    const res = rej as { msBeforeNext?: number };
    return {
      allowed: false,
      retryAfterMs: res.msBeforeNext ?? 60_000,
    };
  }
}

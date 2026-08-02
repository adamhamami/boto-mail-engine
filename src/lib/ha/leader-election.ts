import crypto from "node:crypto";
import os from "node:os";
import { getRedisConnection } from "@/lib/queue";
import { logger } from "@/lib/logger";

const RENEW_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`;

const RESIGN_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export type LeaderRole =
  | "campaign-scan"
  | "maintenance"
  | "log-compress-cluster"
  | "compliance-retention";

/**
 * Leader election Redis (SET NX + renew).
 * Un seul process du cluster exécute les tâches singleton.
 */
export class LeaderElector {
  readonly role: LeaderRole;
  readonly lockKey: string;
  readonly ttlMs: number;
  readonly token: string;
  private renewTimer: NodeJS.Timeout | null = null;
  private leading = false;

  constructor(role: LeaderRole, ttlMs = 15_000) {
    this.role = role;
    this.lockKey = `ha:leader:${role}`;
    this.ttlMs = ttlMs;
    this.token = `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
  }

  isLeader(): boolean {
    return this.leading;
  }

  /** Tente d'acquérir le leadership (ou confirme si déjà leader). */
  async tryAcquire(): Promise<boolean> {
    const redis = getRedisConnection();
    const result = await redis.set(
      this.lockKey,
      this.token,
      "PX",
      this.ttlMs,
      "NX",
    );
    if (result === "OK") {
      this.leading = true;
      return true;
    }

    const current = await redis.get(this.lockKey);
    this.leading = current === this.token;
    return this.leading;
  }

  /** Renouvelle le TTL si on est toujours propriétaire. */
  async renew(): Promise<boolean> {
    if (!this.leading) return false;
    const redis = getRedisConnection();
    const n = await redis.eval(
      RENEW_LUA,
      1,
      this.lockKey,
      this.token,
      String(this.ttlMs),
    );
    const ok = Number(n) === 1;
    if (!ok) {
      this.leading = false;
      logger.warn({ role: this.role }, "Leader lock lost");
    }
    return ok;
  }

  async resign(): Promise<void> {
    this.stop();
    if (!this.leading) return;
    try {
      await getRedisConnection().eval(
        RESIGN_LUA,
        1,
        this.lockKey,
        this.token,
      );
    } catch {
      /* best-effort */
    }
    this.leading = false;
  }

  /**
   * Boucle : tente d'acquérir + renew.
   * `onBecomeLeader` est appelé une fois à chaque acquisition.
   */
  start(opts?: {
    onBecomeLeader?: () => void | Promise<void>;
    onLostLeadership?: () => void;
  }): void {
    if (this.renewTimer) return;

    let wasLeader = false;
    const tick = async () => {
      try {
        const ok = this.leading ? await this.renew() : await this.tryAcquire();
        if (ok && !wasLeader) {
          wasLeader = true;
          logger.info(
            { role: this.role, token: this.token },
            "Became cluster leader",
          );
          await opts?.onBecomeLeader?.();
        } else if (!ok && wasLeader) {
          wasLeader = false;
          opts?.onLostLeadership?.();
        }
      } catch (error) {
        logger.warn(
          {
            role: this.role,
            err:
              error instanceof Error
                ? { name: error.name, message: error.message }
                : { message: "leader tick failed" },
          },
          "Leader election tick failed",
        );
      }
    };

    void tick();
    this.renewTimer = setInterval(() => {
      void tick();
    }, Math.max(1_000, Math.floor(this.ttlMs / 3)));
    this.renewTimer.unref?.();
  }

  stop(): void {
    if (this.renewTimer) {
      clearInterval(this.renewTimer);
      this.renewTimer = null;
    }
  }
}

/** Lit le token leader actuel (ops / diagnostics). */
export async function readLeaderToken(
  role: LeaderRole,
): Promise<string | null> {
  try {
    return await getRedisConnection().get(`ha:leader:${role}`);
  } catch {
    return null;
  }
}

import type { Clock } from "./clock";
import { getClock } from "./clock";
import { DEFAULT_CAMPAIGN_TIMEZONE, getZonedParts } from "./timezone";

export interface QuotaLimits {
  perHour: number;
  perDay: number;
  perConnector: number;
  perSenderDomain: number;
  perCampaign: number;
}

export interface QuotaConsumeParams {
  campaignId: string;
  connector: string;
  senderDomain: string;
  limits: QuotaLimits;
}

export interface QuotaConsumeResult {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
}

export interface QuotaStore {
  incr(key: string, ttlSeconds: number): Promise<number>;
  get(key: string): Promise<number>;
}

/** Store mémoire — tests / process unique (ne pas utiliser multi-worker prod). */
export class MemoryQuotaStore implements QuotaStore {
  private readonly counters = new Map<string, { value: number; expiresAt: number }>();

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const now = Date.now();
    const existing = this.counters.get(key);
    if (!existing || existing.expiresAt <= now) {
      this.counters.set(key, { value: 1, expiresAt: now + ttlSeconds * 1000 });
      return 1;
    }
    existing.value += 1;
    return existing.value;
  }

  async get(key: string): Promise<number> {
    const now = Date.now();
    const existing = this.counters.get(key);
    if (!existing || existing.expiresAt <= now) return 0;
    return existing.value;
  }

  clear(): void {
    this.counters.clear();
  }
}

export class RedisQuotaStore implements QuotaStore {
  constructor(
    private readonly redis: {
      incr(key: string): Promise<number>;
      expire(key: string, seconds: number): Promise<number>;
      get(key: string): Promise<string | null>;
    },
  ) {}

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const value = await this.redis.incr(key);
    if (value === 1) {
      await this.redis.expire(key, ttlSeconds);
    }
    return value;
  }

  async get(key: string): Promise<number> {
    const raw = await this.redis.get(key);
    return raw ? Number(raw) || 0 : 0;
  }
}

let activeStore: QuotaStore | null = null;

export function setQuotaStore(store: QuotaStore | null): void {
  activeStore = store;
}

export function getQuotaStore(): QuotaStore {
  if (activeStore) return activeStore;
  // Lazy Redis — évite import circulaire au bootstrap tests
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getRedisConnection } = require("@/lib/queue") as typeof import("@/lib/queue");
  activeStore = new RedisQuotaStore(getRedisConnection());
  return activeStore;
}

function hourBucket(now: Date, timeZone: string): string {
  const z = getZonedParts(now, timeZone);
  return `${z.year}${String(z.month).padStart(2, "0")}${String(z.day).padStart(2, "0")}${String(z.hour).padStart(2, "0")}`;
}

function dayBucket(now: Date, timeZone: string): string {
  const z = getZonedParts(now, timeZone);
  return `${z.year}${String(z.month).padStart(2, "0")}${String(z.day).padStart(2, "0")}`;
}

/**
 * Consomme 1 unité sur tous les compteurs (atomique par clé Redis).
 * Multi-worker safe via Redis INCR.
 */
export async function consumeSendQuotas(
  params: QuotaConsumeParams,
  opts: { store?: QuotaStore; clock?: Clock; timeZone?: string } = {},
): Promise<QuotaConsumeResult> {
  const store = opts.store ?? getQuotaStore();
  const clock = opts.clock ?? getClock();
  const timeZone = opts.timeZone ?? DEFAULT_CAMPAIGN_TIMEZONE;
  const now = clock.now();
  const hour = hourBucket(now, timeZone);
  const day = dayBucket(now, timeZone);
  const { limits } = params;

  const checks: Array<{ key: string; limit: number; ttl: number; label: string }> = [
    {
      key: `quota:hour:global:${hour}`,
      limit: limits.perHour,
      ttl: 3600 + 60,
      label: "hourly_global",
    },
    {
      key: `quota:day:global:${day}`,
      limit: limits.perDay,
      ttl: 86400 + 60,
      label: "daily_global",
    },
    {
      key: `quota:hour:connector:${params.connector}:${hour}`,
      limit: limits.perConnector,
      ttl: 3600 + 60,
      label: "hourly_connector",
    },
    {
      key: `quota:day:domain:${params.senderDomain}:${day}`,
      limit: limits.perSenderDomain,
      ttl: 86400 + 60,
      label: "daily_sender_domain",
    },
    {
      key: `quota:hour:campaign:${params.campaignId}:${hour}`,
      limit: limits.perCampaign,
      ttl: 3600 + 60,
      label: "hourly_campaign",
    },
  ];

  for (const check of checks) {
    if (check.limit <= 0) continue;
    const value = await store.incr(check.key, check.ttl);
    if (value > check.limit) {
      return {
        allowed: false,
        reason: check.label,
        retryAfterMs: check.ttl > 3600 ? 60_000 : 5_000,
      };
    }
  }

  return { allowed: true };
}

export const DEFAULT_QUOTA_LIMITS: QuotaLimits = {
  perHour: 200,
  perDay: 2000,
  perConnector: 200,
  perSenderDomain: 2000,
  perCampaign: 100,
};

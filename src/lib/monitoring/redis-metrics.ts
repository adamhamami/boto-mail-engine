import { getRedisConnection } from "@/lib/queue";
import { withHealthTimeout } from "@/lib/observability/health-timeout";
import type { RedisDashboard } from "./types";

const REDIS_PROBE_MS = 2500;

function parseInfo(section: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) continue;
    out[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return out;
}

function num(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function collectRedisDashboard(): Promise<RedisDashboard> {
  const empty: RedisDashboard = {
    connected: false,
    version: null,
    uptimeSeconds: null,
    usedMemoryBytes: null,
    usedMemoryHuman: null,
    maxMemoryBytes: null,
    connectedClients: null,
    opsPerSecond: null,
    hitRatePercent: null,
    role: null,
  };

  try {
    return await withHealthTimeout(
      "redis-dash",
      async () => {
        const redis = getRedisConnection();
        const pong = await redis.ping();
        if (pong !== "PONG") return empty;

        const raw = await redis.info();
        const info = parseInfo(raw);

        const hits = num(info.keyspace_hits) ?? 0;
        const misses = num(info.keyspace_misses) ?? 0;
        const total = hits + misses;
        const hitRatePercent =
          total > 0 ? Math.round((hits / total) * 1000) / 10 : null;

        return {
          connected: true,
          version: info.redis_version ?? null,
          uptimeSeconds: num(info.uptime_in_seconds),
          usedMemoryBytes: num(info.used_memory),
          usedMemoryHuman: info.used_memory_human ?? null,
          maxMemoryBytes: num(info.maxmemory),
          connectedClients: num(info.connected_clients),
          opsPerSecond: num(info.instantaneous_ops_per_sec),
          hitRatePercent,
          role: info.role ?? null,
        };
      },
      REDIS_PROBE_MS,
    );
  } catch {
    return empty;
  }
}

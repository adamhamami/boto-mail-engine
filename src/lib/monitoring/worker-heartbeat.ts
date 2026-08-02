import os from "node:os";
import { getRedisConnection } from "@/lib/queue";
import { withHealthTimeout } from "@/lib/observability/health-timeout";
import { getEnv } from "@/lib/config/env";
import type { WorkerDashboard, WorkerInstanceHeartbeat } from "./types";

/** Clé legacy (dernier writer) — conservée pour rétrocompat ops. */
export const WORKER_HEARTBEAT_KEY = "ops:worker:heartbeat";
export const WORKER_HEARTBEAT_INDEX = "ops:worker:heartbeat:index";
export const WORKER_HEARTBEAT_PREFIX = "ops:worker:heartbeat:inst:";

const HEARTBEAT_TTL_SECONDS = 120;
const READ_TIMEOUT_MS = 1500;

export interface WorkerHeartbeatPayload {
  at: string;
  pid: number;
  hostname: string;
  workers: string[];
  instanceId: string;
}

function instanceId(): string {
  return `${os.hostname()}:${process.pid}`;
}

/** Écrit le heartbeat Redis par instance — multi-worker safe. */
export async function writeWorkerHeartbeat(
  workers: string[],
): Promise<void> {
  const id = instanceId();
  const payload: WorkerHeartbeatPayload = {
    at: new Date().toISOString(),
    pid: process.pid,
    hostname: os.hostname(),
    workers,
    instanceId: id,
  };

  const redis = getRedisConnection();
  const instKey = `${WORKER_HEARTBEAT_PREFIX}${id}`;
  const pipeline = redis.pipeline();
  pipeline.set(instKey, JSON.stringify(payload), "EX", HEARTBEAT_TTL_SECONDS);
  pipeline.sadd(WORKER_HEARTBEAT_INDEX, id);
  pipeline.expire(WORKER_HEARTBEAT_INDEX, HEARTBEAT_TTL_SECONDS * 2);
  // Vue agrégée « dernier beat » pour alertes simples
  pipeline.set(
    WORKER_HEARTBEAT_KEY,
    JSON.stringify(payload),
    "EX",
    HEARTBEAT_TTL_SECONDS,
  );
  await pipeline.exec();
}

export async function readWorkerHeartbeat(): Promise<WorkerHeartbeatPayload | null> {
  try {
    const raw = await withHealthTimeout(
      "worker-heartbeat",
      () => getRedisConnection().get(WORKER_HEARTBEAT_KEY),
      READ_TIMEOUT_MS,
    );
    if (!raw) return null;
    return JSON.parse(raw) as WorkerHeartbeatPayload;
  } catch {
    return null;
  }
}

async function listInstanceHeartbeats(): Promise<WorkerHeartbeatPayload[]> {
  const redis = getRedisConnection();
  let members: string[] = [];
  try {
    members = await withHealthTimeout(
      "worker-heartbeat-index",
      () => redis.smembers(WORKER_HEARTBEAT_INDEX),
      READ_TIMEOUT_MS,
    );
  } catch {
    return [];
  }

  const out: WorkerHeartbeatPayload[] = [];
  for (const id of members) {
    try {
      const raw = await redis.get(`${WORKER_HEARTBEAT_PREFIX}${id}`);
      if (!raw) {
        await redis.srem(WORKER_HEARTBEAT_INDEX, id);
        continue;
      }
      out.push(JSON.parse(raw) as WorkerHeartbeatPayload);
    } catch {
      /* ignore bad entry */
    }
  }
  return out;
}

export async function collectWorkerDashboard(): Promise<WorkerDashboard> {
  const env = getEnv();
  const staleMs = env.ALERT_WORKER_STALE_MS;
  const instancesRaw = await listInstanceHeartbeats();
  const legacy = instancesRaw.length === 0 ? await readWorkerHeartbeat() : null;

  const all: WorkerHeartbeatPayload[] =
    instancesRaw.length > 0
      ? instancesRaw
      : legacy
        ? [legacy]
        : [];

  const now = Date.now();
  const fresh = all.filter((h) => {
    const age = now - new Date(h.at).getTime();
    return Number.isFinite(age) && age <= staleMs;
  });

  const instances: WorkerInstanceHeartbeat[] = fresh.map((h) => ({
    instanceId: h.instanceId ?? `${h.hostname}:${h.pid}`,
    hostname: h.hostname,
    pid: h.pid,
    heartbeatAt: h.at,
    workers: h.workers,
  }));

  const primary = fresh.sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  )[0];

  if (!primary) {
    return {
      enabled: env.WORKER_ENABLED,
      heartbeatAt: null,
      stale: env.WORKER_ENABLED,
      pid: null,
      hostname: null,
      workers: [],
      instanceCount: 0,
      instances: [],
      note: env.WORKER_ENABLED
        ? "Aucun heartbeat reçu — aucun process worker vivant"
        : "WORKER_ENABLED=false",
    };
  }

  const queueNames = [...new Set(fresh.flatMap((h) => h.workers))];

  return {
    enabled: env.WORKER_ENABLED,
    heartbeatAt: primary.at,
    stale: false,
    pid: primary.pid,
    hostname: primary.hostname,
    workers: queueNames,
    instanceCount: fresh.length,
    instances,
    note:
      fresh.length > 1
        ? `${fresh.length} workers actifs (multi-instance)`
        : "Process worker vivant",
  };
}

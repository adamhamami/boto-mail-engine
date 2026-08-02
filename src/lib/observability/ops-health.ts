import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/config/env";
import { getQueue, getRedisConnection, QUEUE_NAMES } from "@/lib/queue";
import { getMailProvider } from "@/lib/mail";
import { EventType, SendAttemptStatus } from "@/generated/prisma/client";
import {
  DEFAULT_QUOTA_LIMITS,
  getQuotaStore,
} from "@/lib/campaign-engine/quotas";
import { DEFAULT_CAMPAIGN_TIMEZONE, getZonedParts } from "@/lib/campaign-engine/timezone";
import {
  checkWithTimeout,
  withHealthTimeout,
} from "@/lib/observability/health-timeout";

/** Probes ops bornées (Redis BullMQ = maxRetriesPerRequest null). */
const OPS_PROBE_TIMEOUT_MS = 3000;

export interface OpsHealthReport {
  status: "healthy" | "degraded" | "unhealthy";
  correlationId?: string;
  timezone: string;
  checks: {
    database: boolean;
    redis: boolean;
    worker: { enabled: boolean; note: string };
    provider: { name: string; healthy: boolean | null; dryRun: boolean };
  };
  queues: {
    emailSend: { waiting: number; delayed: number; failed: number };
    emailDlq: { waiting: number; delayed: number; failed: number };
    webhookProcess: { waiting: number; delayed: number; failed: number };
    importProcess: { waiting: number; delayed: number; failed: number };
    campaignScheduler: { waiting: number; delayed: number; failed: number };
  };
  metrics: {
    lastSuccessfulSendAt: string | null;
    lastInboundEventAt: string | null;
    recentErrors: Array<{
      id: string;
      at: string;
      type: string;
      campaignId: string | null;
    }>;
    retryingAttempts: number;
    quotas: {
      perHour: number;
      perDay: number;
      usedHourApprox: number | null;
      usedDayApprox: number | null;
    };
  };
  /** Champs explicitement absents pour audit sécurité */
  secretsExposed: false;
}

async function queueCounts(name: (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES]) {
  try {
    return await withHealthTimeout(
      `queue:${name}`,
      async () => {
        const q = getQueue(name);
        const [waiting, delayed, failed] = await Promise.all([
          q.getWaitingCount(),
          q.getDelayedCount(),
          q.getFailedCount(),
        ]);
        return { waiting, delayed, failed };
      },
      OPS_PROBE_TIMEOUT_MS,
    );
  } catch {
    return { waiting: -1, delayed: -1, failed: -1 };
  }
}

export async function getOpsHealthReport(
  correlationId?: string,
): Promise<OpsHealthReport> {
  const env = getEnv();
  let database = false;
  let redis = false;

  database = await checkWithTimeout(
    "ops:database",
    async () => {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    },
    OPS_PROBE_TIMEOUT_MS,
  );

  redis = await checkWithTimeout(
    "ops:redis",
    async () => (await getRedisConnection().ping()) === "PONG",
    OPS_PROBE_TIMEOUT_MS,
  );

  let providerHealthy: boolean | null = null;
  if (!env.DRY_RUN) {
    try {
      providerHealthy = await getMailProvider().verifyConnection();
    } catch {
      providerHealthy = false;
    }
  }

  const [
    emailSend,
    emailDlq,
    webhookProcess,
    importProcess,
    campaignScheduler,
    lastSent,
    lastInbound,
    recentErrors,
    retryingAttempts,
  ] = await Promise.all([
    queueCounts(QUEUE_NAMES.EMAIL_SEND),
    queueCounts(QUEUE_NAMES.EMAIL_DLQ),
    queueCounts(QUEUE_NAMES.WEBHOOK_PROCESS),
    queueCounts(QUEUE_NAMES.IMPORT_PROCESS),
    queueCounts(QUEUE_NAMES.CAMPAIGN_SCHEDULER),
    prisma.sendAttempt.findFirst({
      where: { status: SendAttemptStatus.SENT },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    }),
    prisma.webhookEvent.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.event.findMany({
      where: {
        type: {
          in: [EventType.EMAIL_BOUNCED, EventType.EMAIL_PROVIDER_ERROR],
        },
      },
      orderBy: { occurredAt: "desc" },
      take: 10,
      select: {
        id: true,
        type: true,
        occurredAt: true,
        campaignId: true,
      },
    }),
    prisma.sendAttempt.count({
      where: {
        status: {
          in: [SendAttemptStatus.QUEUED, SendAttemptStatus.FAILED],
        },
        attemptNumber: { gt: 1 },
      },
    }),
  ]);

  let usedHourApprox: number | null = null;
  let usedDayApprox: number | null = null;
  try {
    const store = getQuotaStore();
    const now = new Date();
    const z = getZonedParts(now, DEFAULT_CAMPAIGN_TIMEZONE);
    const hour = `${z.year}${String(z.month).padStart(2, "0")}${String(z.day).padStart(2, "0")}${String(z.hour).padStart(2, "0")}`;
    const day = `${z.year}${String(z.month).padStart(2, "0")}${String(z.day).padStart(2, "0")}`;
    usedHourApprox = await store.get(`quota:hour:global:${hour}`);
    usedDayApprox = await store.get(`quota:day:global:${day}`);
  } catch {
    /* ignore */
  }

  const healthyCore = database && redis;
  const degraded =
    healthyCore &&
    (providerHealthy === false ||
      emailDlq.waiting > 0 ||
      emailDlq.failed > 0);

  return {
    status: !healthyCore ? "unhealthy" : degraded ? "degraded" : "healthy",
    correlationId,
    timezone: DEFAULT_CAMPAIGN_TIMEZONE,
    checks: {
      database,
      redis,
      worker: {
        enabled: env.WORKER_ENABLED,
        note: "Processus worker externe (npm run worker) — pas embarqué dans Next.js",
      },
      provider: {
        name: env.MAIL_PROVIDER,
        healthy: env.DRY_RUN ? null : providerHealthy,
        dryRun: env.DRY_RUN,
      },
    },
    queues: {
      emailSend,
      emailDlq,
      webhookProcess,
      importProcess,
      campaignScheduler,
    },
    metrics: {
      lastSuccessfulSendAt: lastSent?.sentAt?.toISOString() ?? null,
      lastInboundEventAt: lastInbound?.createdAt?.toISOString() ?? null,
      recentErrors: recentErrors.map((e) => ({
        id: e.id,
        at: e.occurredAt.toISOString(),
        type: e.type,
        campaignId: e.campaignId,
      })),
      retryingAttempts,
      quotas: {
        perHour: env.SEND_QUOTA_PER_HOUR ?? DEFAULT_QUOTA_LIMITS.perHour,
        perDay: env.SEND_QUOTA_PER_DAY ?? DEFAULT_QUOTA_LIMITS.perDay,
        usedHourApprox,
        usedDayApprox,
      },
    },
    secretsExposed: false,
  };
}

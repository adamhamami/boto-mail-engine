import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/config/env";
import { getRedisConnection } from "@/lib/queue";
import { checkWithTimeout } from "@/lib/observability/health-timeout";
import { withTracedSpan } from "@/lib/observability/traced-span";
import { getLastSmtpHealth } from "@/lib/mail/smtp-health";
import { maskSmtpHost } from "@/lib/mail/providers";
import { evaluateMonitoringAlerts, severityRank } from "./alerts";
import { maybeNotifyAlertWebhook } from "./alert-webhook";
import { collectSystemMetrics } from "./system-metrics";
import { collectQueueDashboard } from "./queue-metrics";
import { collectRedisDashboard } from "./redis-metrics";
import { collectEmailMetrics } from "./email-metrics";
import { collectWorkerDashboard } from "./worker-heartbeat";
import type { MonitoringReport, SmtpDashboard } from "./types";

async function collectSmtpDashboard(): Promise<SmtpDashboard> {
  const env = getEnv();
  try {
    const last = await getLastSmtpHealth();
    if (last) {
      return {
        provider: last.connector.id,
        dryRun: last.gates.dryRun,
        healthy:
          last.status === "healthy"
            ? true
            : last.status === "unhealthy"
              ? false
              : null,
        lastTestAt: last.lastTestAt,
        status: last.status,
        hostMasked: last.connector.hostMasked,
      };
    }
  } catch {
    /* ignore */
  }

  return {
    provider: env.MAIL_PROVIDER,
    dryRun: env.DRY_RUN,
    healthy: env.DRY_RUN ? null : null,
    lastTestAt: null,
    status: null,
    hostMasked: maskSmtpHost(env.SMTP_HOST),
  };
}

export async function getMonitoringReport(
  correlationId?: string,
): Promise<MonitoringReport> {
  return withTracedSpan("monitoring.report", async () => {
  const system = collectSystemMetrics();

  const [database, redisOk, queues, redis, email, worker, smtp] =
    await Promise.all([
      checkWithTimeout(
        "mon:database",
        async () => {
          await prisma.$queryRaw`SELECT 1`;
          return true;
        },
        2000,
      ),
      checkWithTimeout(
        "mon:redis",
        async () => (await getRedisConnection().ping()) === "PONG",
        2000,
      ),
      collectQueueDashboard(),
      collectRedisDashboard(),
      collectEmailMetrics(),
      collectWorkerDashboard(),
      collectSmtpDashboard(),
    ]);

  const alerts = evaluateMonitoringAlerts({
    system,
    queues,
    redis,
    smtp,
    worker,
    email,
    databaseOk: database,
    redisOk,
  }).sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  // Webhook externe (best-effort) — ne bloque pas le rapport
  void maybeNotifyAlertWebhook(alerts);

  const hasCritical = alerts.some((a) => a.severity === "critical");
  const hasWarning = alerts.some((a) => a.severity === "warning");
  const ready = database && redisOk;

  return {
    generatedAt: new Date().toISOString(),
    correlationId,
    status: !ready || hasCritical
      ? "unhealthy"
      : hasWarning
        ? "degraded"
        : "healthy",
    health: {
      liveness: "up",
      readiness: ready ? "ready" : "not_ready",
      database,
      redis: redisOk,
    },
    system,
    queues,
    redis,
    smtp,
    worker,
    email,
    alerts,
    secretsExposed: false,
  };
  });
}

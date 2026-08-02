import { prisma } from "@/lib/db/prisma";
import { EventType, SendAttemptStatus } from "@/generated/prisma/client";
import { getEnv } from "@/lib/config/env";
import { QUEUE_NAMES, getQueue } from "@/lib/queue";
import { withHealthTimeout } from "@/lib/observability/health-timeout";
import type { EmailMetrics } from "./types";

const PROBE_MS = 3000;

function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 10000;
}

export async function collectEmailMetrics(): Promise<EmailMetrics> {
  const env = getEnv();
  const windowMinutes = env.MONITORING_METRICS_WINDOW_MINUTES;
  const since = new Date(Date.now() - windowMinutes * 60_000);

  const [
    sentWindow,
    sentTotal,
    opened,
    replied,
    bounced,
    failed,
    delivered,
    retries,
    avgRow,
    dlqDepth,
    queueWaiting,
  ] = await Promise.all([
    prisma.event.count({
      where: { type: EventType.EMAIL_SENT, occurredAt: { gte: since } },
    }),
    prisma.event.count({ where: { type: EventType.EMAIL_SENT } }),
    prisma.event.count({
      where: { type: EventType.EMAIL_OPENED, occurredAt: { gte: since } },
    }),
    prisma.event.count({
      where: { type: EventType.EMAIL_REPLIED, occurredAt: { gte: since } },
    }),
    prisma.event.count({
      where: { type: EventType.EMAIL_BOUNCED, occurredAt: { gte: since } },
    }),
    prisma.sendAttempt.count({
      where: {
        status: SendAttemptStatus.FAILED,
        queuedAt: { gte: since },
      },
    }),
    prisma.event.count({
      where: { type: EventType.EMAIL_DELIVERED, occurredAt: { gte: since } },
    }),
    prisma.sendAttempt.count({
      where: {
        attemptNumber: { gt: 1 },
        queuedAt: { gte: since },
      },
    }),
    prisma.$queryRaw<Array<{ avg_ms: number | null }>>`
      SELECT AVG(EXTRACT(EPOCH FROM (sent_at - queued_at)) * 1000)::float AS avg_ms
      FROM send_attempts
      WHERE status = 'SENT'::"SendAttemptStatus"
        AND sent_at IS NOT NULL
        AND sent_at >= ${since}
    `.catch(() => [{ avg_ms: null }]),
    withHealthTimeout(
      "email-metrics:dlq",
      () => getQueue(QUEUE_NAMES.EMAIL_DLQ).getWaitingCount(),
      PROBE_MS,
    ).catch(() => -1),
    withHealthTimeout(
      "email-metrics:waiting",
      () => getQueue(QUEUE_NAMES.EMAIL_SEND).getWaitingCount(),
      PROBE_MS,
    ).catch(() => -1),
  ]);

  const avgSendDurationMs =
    avgRow[0]?.avg_ms !== null && avgRow[0]?.avg_ms !== undefined
      ? Math.round(Number(avgRow[0].avg_ms))
      : null;

  const windowHours = Math.max(windowMinutes / 60, 1 / 60);
  const emailsPerHour =
    Math.round((sentWindow / windowHours) * 100) / 100;
  const emailsPerMinute =
    Math.round((sentWindow / Math.max(windowMinutes, 1)) * 100) / 100;

  const baseline = Math.max(sentWindow, 1);

  return {
    windowMinutes,
    emailsSent: sentWindow,
    emailsSentTotal: sentTotal,
    emailsPerMinute,
    emailsPerHour,
    avgSendDurationMs,
    bounceRate: rate(bounced, baseline),
    openRate: rate(opened, baseline),
    replyRate: rate(replied, baseline),
    failureRate: rate(failed, baseline),
    retries,
    dlqDepth: typeof dlqDepth === "number" ? dlqDepth : -1,
    queueWaiting: typeof queueWaiting === "number" ? queueWaiting : -1,
    counts: {
      sent: sentWindow,
      opened,
      replied,
      bounced,
      failed,
      delivered,
    },
  };
}

import { prisma } from "@/lib/db/prisma";
import {
  CampaignStatus,
  ContactStatus,
  EventType,
  SalesTaskStatus,
  SalesTaskType,
  SendAttemptStatus,
} from "@/generated/prisma/client";
import {
  getOpsHealthReport,
  type OpsHealthReport,
} from "@/lib/observability/ops-health";
import { getEnv } from "@/lib/config/env";
import { DEFAULT_QUOTA_LIMITS } from "@/lib/campaign-engine/quotas";
import { DEFAULT_CAMPAIGN_TIMEZONE } from "@/lib/campaign-engine/timezone";
import { cacheRemember } from "@/lib/cache/redis-cache";

export interface DashboardChartPoint {
  date: string;
  sent: number;
  opens: number;
  replies: number;
}

export interface DashboardStats {
  contactsImported: number;
  contactsEligible: number;
  emailsSent: number;
  emailsDelivered: number;
  replies: number;
  positiveReplies: number;
  demoRequests: number;
  openRate: number;
  bounces: number;
  unsubscribes: number;
  salesTasksOpen: number;
  activeCampaigns: number;
  totalContacts: number;
  qualifiedContacts: number;
  quotaHourly: { limit: number; used: number | null };
  quotaDaily: { limit: number; used: number | null };
  queueWaiting: number;
  dlqDepth: number;
  lastEventAt: string | null;
  lastEventType: string | null;
  recentErrors: Array<{
    id: string;
    at: string;
    type: string;
    campaignId: string | null;
  }>;
  connector: {
    name: string;
    dryRun: boolean;
    healthy: boolean | null;
  };
  recentCampaigns: Array<{
    id: string;
    name: string;
    status: CampaignStatus;
    sentCount: number;
    openCount: number;
    replyCount: number;
    createdAt: Date;
  }>;
  chartData: DashboardChartPoint[];
  correlationId?: string;
  timezone: string;
}

function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildLast30Days(): string[] {
  const days: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(formatDateKey(d));
  }

  return days;
}

async function countPositiveReplies(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
    SELECT COUNT(*)::bigint AS count
    FROM events
    WHERE type = 'EMAIL_REPLIED'::"EventType"
      AND (
        metadata->>'sentiment' = 'positive'
        OR metadata->>'classification' = 'positive'
        OR metadata->>'intent' = 'interested'
      )
  `;
  return Number(rows[0]?.count ?? 0);
}

function emptyOpsFallback(correlationId?: string): OpsHealthReport {
  const env = getEnv();
  const emptyQueue = { waiting: 0, delayed: 0, failed: 0 };
  return {
    status: "degraded",
    correlationId,
    timezone: DEFAULT_CAMPAIGN_TIMEZONE,
    checks: {
      database: true,
      redis: false,
      worker: {
        enabled: env.WORKER_ENABLED,
        note: "Rapport ops indisponible — KPIs métier affichés sans files",
      },
      provider: {
        name: env.MAIL_PROVIDER,
        healthy: null,
        dryRun: env.DRY_RUN,
      },
    },
    queues: {
      emailSend: emptyQueue,
      emailDlq: emptyQueue,
      webhookProcess: emptyQueue,
      importProcess: emptyQueue,
      campaignScheduler: emptyQueue,
    },
    metrics: {
      lastSuccessfulSendAt: null,
      lastInboundEventAt: null,
      recentErrors: [],
      retryingAttempts: 0,
      quotas: {
        perHour: env.SEND_QUOTA_PER_HOUR ?? DEFAULT_QUOTA_LIMITS.perHour,
        perDay: env.SEND_QUOTA_PER_DAY ?? DEFAULT_QUOTA_LIMITS.perDay,
        usedHourApprox: null,
        usedDayApprox: null,
      },
    },
    secretsExposed: false,
  };
}

export class DashboardService {
  async getStats(correlationId?: string): Promise<DashboardStats> {
    const env = getEnv();
    const ttl = env.DASHBOARD_CACHE_TTL_SECONDS;
    // Cache agrégats métier (pas de données user-scoped) — TTL court.
    if (ttl > 0) {
      return cacheRemember(
        `cache:dashboard:stats:v1:${env.CAMPAIGN_DEFAULT_TIMEZONE}`,
        ttl,
        () => this.computeStats(correlationId),
      );
    }
    return this.computeStats(correlationId);
  }

  private async computeStats(
    correlationId?: string,
  ): Promise<DashboardStats> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const env = getEnv();

    const [
      campaignAgg,
      sendAttemptCount,
      deliveredCount,
      activeCampaigns,
      contactsEligible,
      contactsImported,
      totalContacts,
      recentCampaigns,
      chartRows,
      positiveReplies,
      demoRequests,
      salesTasksOpen,
      lastEvent,
      ops,
    ] = await Promise.all([
      prisma.campaign.aggregate({
        where: { deletedAt: null },
        _sum: {
          sentCount: true,
          openCount: true,
          replyCount: true,
          bounceCount: true,
          unsubscribeCount: true,
        },
      }),
      prisma.sendAttempt.count({
        where: { status: SendAttemptStatus.SENT },
      }),
      prisma.event.count({
        where: { type: EventType.EMAIL_DELIVERED },
      }),
      prisma.campaign.count({
        where: {
          deletedAt: null,
          status: { in: [CampaignStatus.RUNNING, CampaignStatus.SCHEDULED] },
        },
      }),
      prisma.contact.count({
        where: { deletedAt: null, status: ContactStatus.ELIGIBLE },
      }),
      prisma.contact.count({
        where: {
          deletedAt: null,
          status: { in: [ContactStatus.IMPORTED, ContactStatus.TO_REVIEW] },
        },
      }),
      prisma.contact.count({
        where: { deletedAt: null },
      }),
      prisma.campaign.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          name: true,
          status: true,
          sentCount: true,
          openCount: true,
          replyCount: true,
          createdAt: true,
        },
      }),
      // Agrégation SQL (évite charger tous les events en JS)
      prisma.$queryRaw<
        Array<{ day: Date; type: string; count: bigint | number }>
      >`
        SELECT date_trunc('day', occurred_at) AS day,
               type::text AS type,
               COUNT(*)::bigint AS count
        FROM events
        WHERE occurred_at >= ${thirtyDaysAgo}
          AND type IN (
            'EMAIL_SENT'::"EventType",
            'EMAIL_OPENED'::"EventType",
            'EMAIL_REPLIED'::"EventType"
          )
        GROUP BY 1, 2
        ORDER BY 1
      `,
      countPositiveReplies(),
      prisma.salesTask.count({
        where: {
          type: SalesTaskType.DEMO_REQUEST,
          status: { in: [SalesTaskStatus.OPEN, SalesTaskStatus.IN_PROGRESS] },
        },
      }),
      prisma.salesTask.count({
        where: {
          status: { in: [SalesTaskStatus.OPEN, SalesTaskStatus.IN_PROGRESS] },
        },
      }),
      prisma.event.findFirst({
        orderBy: { occurredAt: "desc" },
        select: { occurredAt: true, type: true },
      }),
      getOpsHealthReport(correlationId).catch(() =>
        emptyOpsFallback(correlationId),
      ),
    ]);

    const sentFromCampaigns = campaignAgg._sum.sentCount ?? 0;
    const openCount = campaignAgg._sum.openCount ?? 0;
    const emailsSent =
      sentFromCampaigns > 0 ? sentFromCampaigns : sendAttemptCount;
    const replies = campaignAgg._sum.replyCount ?? 0;
    const bounces = campaignAgg._sum.bounceCount ?? 0;
    const unsubscribes = campaignAgg._sum.unsubscribeCount ?? 0;
    const openRate =
      emailsSent > 0 ? Math.round((openCount / emailsSent) * 1000) / 10 : 0;

    const dayMap = new Map<string, DashboardChartPoint>();
    for (const day of buildLast30Days()) {
      dayMap.set(day, { date: day, sent: 0, opens: 0, replies: 0 });
    }

    for (const row of chartRows) {
      const key = formatDateKey(new Date(row.day));
      const point = dayMap.get(key);
      if (!point) continue;
      const n = Number(row.count);
      switch (row.type) {
        case "EMAIL_SENT":
          point.sent += n;
          break;
        case "EMAIL_OPENED":
          point.opens += n;
          break;
        case "EMAIL_REPLIED":
          point.replies += n;
          break;
        default:
          break;
      }
    }

    const queueWaiting =
      Math.max(ops.queues.emailSend.waiting, 0) +
      Math.max(ops.queues.emailSend.delayed, 0);
    const dlqDepth =
      Math.max(ops.queues.emailDlq.waiting, 0) +
      Math.max(ops.queues.emailDlq.failed, 0) +
      Math.max(ops.queues.emailDlq.delayed, 0);

    return {
      contactsImported,
      contactsEligible,
      emailsSent,
      emailsDelivered: deliveredCount,
      replies,
      positiveReplies,
      demoRequests,
      openRate,
      bounces,
      unsubscribes,
      salesTasksOpen,
      activeCampaigns,
      totalContacts,
      qualifiedContacts: contactsEligible,
      quotaHourly: {
        limit: ops.metrics.quotas.perHour,
        used: ops.metrics.quotas.usedHourApprox,
      },
      quotaDaily: {
        limit: ops.metrics.quotas.perDay,
        used: ops.metrics.quotas.usedDayApprox,
      },
      queueWaiting,
      dlqDepth,
      lastEventAt: lastEvent?.occurredAt.toISOString() ?? null,
      lastEventType: lastEvent?.type ?? null,
      recentErrors: ops.metrics.recentErrors,
      connector: {
        name: env.MAIL_PROVIDER,
        dryRun: env.DRY_RUN,
        healthy: ops.checks.provider.healthy,
      },
      recentCampaigns,
      chartData: Array.from(dayMap.values()),
      correlationId,
      timezone: ops.timezone,
    };
  }
}

export const dashboardService = new DashboardService();

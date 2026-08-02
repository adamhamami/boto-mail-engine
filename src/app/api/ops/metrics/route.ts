import { type NextRequest, NextResponse } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { getEnv } from "@/lib/config/env";
import { getMonitoringReport } from "@/lib/monitoring/report";
import { formatPrometheus } from "@/lib/monitoring/prometheus";
import { authorizeOpsMetrics } from "@/lib/monitoring/metrics-auth";
import {
  resolveCorrelationId,
  withRequestContext,
} from "@/lib/observability/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Métriques — JSON (défaut) ou Prometheus (`?format=prometheus`).
 * Auth : ops:read OU Bearer METRICS_SCRAPE_TOKEN — jamais public anonyme.
 */
export async function GET(req: NextRequest) {
  const correlationId = resolveCorrelationId(req);
  try {
    return await withRequestContext(req, async () => {
      await authorizeOpsMetrics(req);
      const report = await getMonitoringReport(correlationId);
      const format = req.nextUrl.searchParams.get("format")?.toLowerCase();

      if (format === "prometheus" || format === "openmetrics") {
        return new NextResponse(formatPrometheus(report), {
          status: 200,
          headers: {
            "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
            "Cache-Control": "no-store",
            "x-correlation-id": correlationId,
          },
        });
      }

      const grafanaUrl = getEnv().OBSERVABILITY_GRAFANA_URL?.trim() || null;

      return apiSuccess({
        generatedAt: report.generatedAt,
        correlationId: report.correlationId,
        status: report.status,
        cpu: report.system.cpu,
        memory: report.system.memory,
        queues: report.queues,
        retries: report.email.retries,
        dlq: report.email.dlqDepth,
        avgSendDurationMs: report.email.avgSendDurationMs,
        emailsSent: report.email.emailsSent,
        emailsSentTotal: report.email.emailsSentTotal,
        emailsPerMinute: report.email.emailsPerMinute,
        emailsPerHour: report.email.emailsPerHour,
        bounceRate: report.email.bounceRate,
        openRate: report.email.openRate,
        replyRate: report.email.replyRate,
        failureRate: report.email.failureRate,
        emailEvents: report.email.counts,
        alerts: report.alerts,
        worker: report.worker,
        redis: report.redis,
        smtp: report.smtp,
        grafanaUrl,
      });
    });
  } catch (error) {
    return apiError(error);
  }
}

import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getEnv } from "@/lib/config/env";
import { getMonitoringReport } from "@/lib/monitoring/report";
import {
  resolveCorrelationId,
  withRequestContext,
} from "@/lib/observability/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rapport Monitoring complet — RBAC ops:read.
 * Dashboards BullMQ / Redis / SMTP / Worker + métriques + alertes.
 */
export async function GET(req: NextRequest) {
  const correlationId = resolveCorrelationId(req);
  try {
    return await withRequestContext(req, async () => {
      await requirePermission(PERMISSIONS.OPS_READ);
      const report = await getMonitoringReport(correlationId);
      const grafanaUrl = getEnv().OBSERVABILITY_GRAFANA_URL?.trim() || null;
      return apiSuccess({ ...report, grafanaUrl });
    });
  } catch (error) {
    return apiError(error);
  }
}

import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getOpsHealthReport } from "@/lib/observability/ops-health";
import {
  resolveCorrelationId,
  withRequestContext,
} from "@/lib/observability/http";

/**
 * Santé technique détaillée — RBAC ops:read.
 * N'expose jamais SMTP_PASSWORD, AUTH_SECRET, tokens complets.
 */
export async function GET(req: NextRequest) {
  const correlationId = resolveCorrelationId(req);
  try {
    return await withRequestContext(req, async () => {
      await requirePermission(PERMISSIONS.OPS_READ);
      const report = await getOpsHealthReport(correlationId);
      return apiSuccess(report);
    });
  } catch (error) {
    return apiError(error);
  }
}

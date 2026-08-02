import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { dashboardService } from "@/modules/dashboard/services/dashboard.service";
import {
  resolveCorrelationId,
  withRequestContext,
} from "@/lib/observability/http";

export async function GET(req: NextRequest) {
  const correlationId = resolveCorrelationId(req);
  try {
    return await withRequestContext(req, async () => {
      await requirePermission(PERMISSIONS.DASHBOARD_READ);
      const stats = await dashboardService.getStats(correlationId);
      return apiSuccess(stats);
    });
  } catch (error) {
    return apiError(error);
  }
}

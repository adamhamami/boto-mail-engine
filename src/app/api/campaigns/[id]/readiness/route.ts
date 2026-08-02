import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { campaignService } from "@/modules/campaigns/services/campaign.service";
import {
  resolveCorrelationId,
  withRequestContext,
} from "@/lib/observability/http";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    return await withRequestContext(
      req,
      async () => {
        await requirePermission(PERMISSIONS.CAMPAIGNS_READ);
        const correlationId = resolveCorrelationId(req);
        const readiness = await campaignService.getReadiness(id);
        return apiSuccess({ ...readiness, correlationId });
      },
      { campaignId: id },
    );
  } catch (error) {
    return apiError(error);
  }
}

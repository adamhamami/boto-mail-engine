import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { campaignService } from "@/modules/campaigns/services/campaign.service";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requirePermission(PERMISSIONS.CAMPAIGNS_WRITE);
    const { id } = await params;
    const campaign = await campaignService.markTested(id, session.user.id);
    return apiSuccess(campaign);
  } catch (error) {
    return apiError(error);
  }
}

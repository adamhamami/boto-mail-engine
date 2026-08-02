import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { campaignService } from "@/modules/campaigns/services/campaign.service";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requirePermission(PERMISSIONS.CAMPAIGNS_SEND);
    const { id } = await params;
    const campaign = await campaignService.pause(id, session.user.id);

    return apiSuccess(campaign, 200);
  } catch (error) {
    return apiError(error);
  }
}

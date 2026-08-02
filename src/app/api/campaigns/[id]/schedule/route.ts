import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { campaignService } from "@/modules/campaigns/services/campaign.service";
import { scheduleCampaignSchema } from "@/modules/campaigns/validators/campaign.validator";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requirePermission(PERMISSIONS.CAMPAIGNS_SEND);
    const { id } = await params;
    const body: unknown = await req.json().catch(() => ({}));
    const input = scheduleCampaignSchema.parse(body);
    const campaign = await campaignService.schedule(id, input, session.user.id);

    return apiSuccess(campaign, 200);
  } catch (error) {
    return apiError(error);
  }
}

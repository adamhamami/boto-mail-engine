import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { campaignService } from "@/modules/campaigns/services/campaign.service";
import { updateCampaignSchema } from "@/modules/campaigns/validators/campaign.validator";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requirePermission(PERMISSIONS.CAMPAIGNS_READ);
    const { id } = await params;
    const campaign = await campaignService.getById(id);

    return apiSuccess(campaign, 200);
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requirePermission(PERMISSIONS.CAMPAIGNS_WRITE);
    const { id } = await params;
    const body: unknown = await req.json();
    const input = updateCampaignSchema.parse(body);
    const campaign = await campaignService.update(id, input, session.user.id);

    return apiSuccess(campaign, 200);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requirePermission(PERMISSIONS.CAMPAIGNS_DELETE);
    const { id } = await params;
    const campaign = await campaignService.delete(id, session.user.id);

    return apiSuccess(campaign, 200);
  } catch (error) {
    return apiError(error);
  }
}

import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { getPaginationMeta } from "@/lib/api/pagination";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { campaignService } from "@/modules/campaigns/services/campaign.service";
import { listCampaignRecipientsSchema } from "@/modules/campaigns/validators/campaign.validator";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    await requirePermission(PERMISSIONS.CAMPAIGNS_READ);
    const { id } = await params;
    const queryParams = Object.fromEntries(req.nextUrl.searchParams);
    const input = listCampaignRecipientsSchema.parse(queryParams);
    const { items, total, stats } = await campaignService.getRecipients(id, input);

    return apiSuccess(
      { items, stats },
      200,
      getPaginationMeta(input.page, input.limit, total),
    );
  } catch (error) {
    return apiError(error);
  }
}

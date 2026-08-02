import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { getPaginationMeta } from "@/lib/api/pagination";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { campaignService } from "@/modules/campaigns/services/campaign.service";
import {
  createCampaignSchema,
  listCampaignsSchema,
} from "@/modules/campaigns/validators/campaign.validator";

export async function GET(req: NextRequest) {
  try {
    await requirePermission(PERMISSIONS.CAMPAIGNS_READ);

    const params = Object.fromEntries(req.nextUrl.searchParams);
    const input = listCampaignsSchema.parse(params);
    const { items, total } = await campaignService.list(input);

    return apiSuccess(items, 200, getPaginationMeta(input.page, input.limit, total));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(PERMISSIONS.CAMPAIGNS_WRITE);
    const body: unknown = await req.json();
    const input = createCampaignSchema.parse(body);
    const campaign = await campaignService.create(input, session.user.id);

    return apiSuccess(campaign, 201);
  } catch (error) {
    return apiError(error);
  }
}

import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { getPaginationMeta } from "@/lib/api/pagination";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { responseService } from "@/modules/responses/services/response.service";
import { listResponsesSchema } from "@/modules/responses/validators/response.validator";

export async function GET(req: NextRequest) {
  try {
    await requirePermission(PERMISSIONS.RESPONSES_READ);

    const params = Object.fromEntries(req.nextUrl.searchParams);
    const input = listResponsesSchema.parse(params);
    const { items, total } = await responseService.list(input);

    return apiSuccess(items, 200, getPaginationMeta(input.page, input.limit, total));
  } catch (error) {
    return apiError(error);
  }
}

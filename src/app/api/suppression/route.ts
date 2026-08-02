import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { getPaginationMeta } from "@/lib/api/pagination";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { suppressionService } from "@/modules/suppression/services/suppression.service";
import {
  createSuppressionSchema,
  listSuppressionSchema,
} from "@/modules/suppression/validators/suppression.validator";

export async function GET(req: NextRequest) {
  try {
    await requirePermission(PERMISSIONS.SUPPRESSION_READ);

    const params = Object.fromEntries(req.nextUrl.searchParams);
    const input = listSuppressionSchema.parse(params);
    const { items, total } = await suppressionService.list(input);

    return apiSuccess(items, 200, getPaginationMeta(input.page, input.limit, total));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(PERMISSIONS.SUPPRESSION_WRITE);
    const body: unknown = await req.json();
    const input = createSuppressionSchema.parse(body);
    const entry = await suppressionService.create(input, session.user.id);

    return apiSuccess(entry, 201);
  } catch (error) {
    return apiError(error);
  }
}

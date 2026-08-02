import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { responseService } from "@/modules/responses/services/response.service";
import { updateResponseSchema } from "@/modules/responses/validators/response.validator";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requirePermission(PERMISSIONS.RESPONSES_WRITE);
    const { id } = await context.params;
    const body: unknown = await req.json();
    const input = updateResponseSchema.parse(body);
    const result = await responseService.update(id, input, session.user.id);

    return apiSuccess(result);
  } catch (error) {
    return apiError(error);
  }
}

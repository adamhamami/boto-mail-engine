import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { suppressionService } from "@/modules/suppression/services/suppression.service";

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requirePermission(PERMISSIONS.SUPPRESSION_WRITE);
    const { id } = await context.params;
    const entry = await suppressionService.delete(id, session.user.id);

    return apiSuccess(entry);
  } catch (error) {
    return apiError(error);
  }
}

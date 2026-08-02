import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { complianceRequestService } from "@/modules/compliance/services/request.service";
import { updateDataSubjectRequestSchema } from "@/modules/compliance/validators/compliance.validator";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requirePermission(PERMISSIONS.COMPLIANCE_WRITE);
    const { id } = await ctx.params;
    const body = updateDataSubjectRequestSchema.parse(await req.json());
    const updated = await complianceRequestService.update(
      id,
      body,
      session.user.id,
    );
    return apiSuccess(updated);
  } catch (error) {
    return apiError(error);
  }
}

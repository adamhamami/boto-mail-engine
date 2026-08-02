import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { anonymizeContact } from "@/modules/compliance/services/anonymize.service";
import { anonymizeContactSchema } from "@/modules/compliance/validators/compliance.validator";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requirePermission(PERMISSIONS.COMPLIANCE_ERASE);
    const { id } = await ctx.params;
    const body = anonymizeContactSchema.parse(await req.json());
    const result = await anonymizeContact(id, body, session.user.id);
    return apiSuccess(result);
  } catch (error) {
    return apiError(error);
  }
}

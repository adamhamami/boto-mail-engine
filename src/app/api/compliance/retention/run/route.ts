import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { runRetentionJob } from "@/modules/compliance/services/retention.service";
import { runRetentionSchema } from "@/modules/compliance/validators/compliance.validator";

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(PERMISSIONS.COMPLIANCE_RETENTION);
    const body = runRetentionSchema.parse(await req.json());
    const result = await runRetentionJob({
      dryRun: body.dryRun,
      actorUserId: session.user.id,
    });
    return apiSuccess(result);
  } catch (error) {
    return apiError(error);
  }
}
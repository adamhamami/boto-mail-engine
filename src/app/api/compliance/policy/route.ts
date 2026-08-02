import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getCompliancePolicy } from "@/modules/compliance/services/policy.service";

export async function GET() {
  try {
    await requirePermission(PERMISSIONS.COMPLIANCE_READ);
    return apiSuccess(getCompliancePolicy());
  } catch (error) {
    return apiError(error);
  }
}

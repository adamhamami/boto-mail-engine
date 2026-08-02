import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { userService } from "@/modules/users/services/user.service";

export async function GET() {
  try {
    await requirePermission(PERMISSIONS.USERS_READ);
    const roles = await userService.listRoles();
    return apiSuccess(roles, 200);
  } catch (error) {
    return apiError(error);
  }
}

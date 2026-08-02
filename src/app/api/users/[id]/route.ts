import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { userService } from "@/modules/users/services/user.service";
import { updateUserSchema } from "@/modules/users/validators/user.validator";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requirePermission(PERMISSIONS.USERS_READ);
    const { id } = await params;
    const user = await userService.getById(id);

    return apiSuccess(user, 200);
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requirePermission(PERMISSIONS.USERS_WRITE);
    const { id } = await params;
    const body: unknown = await req.json();
    const input = updateUserSchema.parse(body);
    const user = await userService.update(id, input, session.user.id);

    return apiSuccess(user, 200);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requirePermission(PERMISSIONS.USERS_DELETE);
    const { id } = await params;
    const user = await userService.delete(id, session.user.id);

    return apiSuccess(user, 200);
  } catch (error) {
    return apiError(error);
  }
}

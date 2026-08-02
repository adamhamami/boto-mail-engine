import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import {
  getPaginationMeta,
} from "@/lib/api/pagination";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { userService } from "@/modules/users/services/user.service";
import {
  createUserSchema,
  listUsersSchema,
} from "@/modules/users/validators/user.validator";

export async function GET(req: NextRequest) {
  try {
    await requirePermission(PERMISSIONS.USERS_READ);

    const params = Object.fromEntries(req.nextUrl.searchParams);
    const input = listUsersSchema.parse(params);
    const { items, total } = await userService.list(input);

    return apiSuccess(items, 200, getPaginationMeta(input.page, input.limit, total));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(PERMISSIONS.USERS_WRITE);
    const body: unknown = await req.json();
    const input = createUserSchema.parse(body);
    const user = await userService.create(input, session.user.id);

    return apiSuccess(user, 201);
  } catch (error) {
    return apiError(error);
  }
}

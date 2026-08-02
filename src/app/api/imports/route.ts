import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import {
  getPaginationMeta,
} from "@/lib/api/pagination";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { importService } from "@/modules/imports/services/import.service";
import {
  createImportSchema,
  listImportsSchema,
} from "@/modules/imports/validators/import.validator";

export async function GET(req: NextRequest) {
  try {
    await requirePermission(PERMISSIONS.IMPORTS_READ);

    const params = Object.fromEntries(req.nextUrl.searchParams);
    const input = listImportsSchema.parse(params);
    const { items, total } = await importService.list(input);

    return apiSuccess(items, 200, getPaginationMeta(input.page, input.limit, total));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(PERMISSIONS.IMPORTS_WRITE);
    const body: unknown = await req.json();
    const input = createImportSchema.parse(body);
    const batch = await importService.create(input, session.user.id);

    return apiSuccess(batch, 201);
  } catch (error) {
    return apiError(error);
  }
}

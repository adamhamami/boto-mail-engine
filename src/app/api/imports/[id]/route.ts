import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { importService } from "@/modules/imports/services/import.service";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requirePermission(PERMISSIONS.IMPORTS_READ);
    const { id } = await params;
    const batch = await importService.getById(id);

    return apiSuccess(batch, 200);
  } catch (error) {
    return apiError(error);
  }
}

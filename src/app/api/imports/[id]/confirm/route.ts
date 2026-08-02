import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { importService } from "@/modules/imports/services/import.service";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requirePermission(PERMISSIONS.IMPORTS_WRITE);
    const { id } = await params;
    const batch = await importService.confirmAndEnqueue(id, session.user.id);
    return apiSuccess(batch, 202);
  } catch (error) {
    return apiError(error);
  }
}

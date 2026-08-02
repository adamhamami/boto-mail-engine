import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { importService } from "@/modules/imports/services/import.service";
import { setImportMappingSchema } from "@/modules/imports/validators/import.validator";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requirePermission(PERMISSIONS.IMPORTS_WRITE);
    const { id } = await params;
    const body: unknown = await req.json();
    const input = setImportMappingSchema.parse(body);
    const batch = await importService.setMapping(id, input, session.user.id);
    return apiSuccess(batch);
  } catch (error) {
    return apiError(error);
  }
}

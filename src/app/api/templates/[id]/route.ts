import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { templateService } from "@/modules/templates/services/template.service";
import { updateTemplateSchema } from "@/modules/templates/validators/template.validator";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requirePermission(PERMISSIONS.TEMPLATES_READ);
    const { id } = await params;
    const template = await templateService.getById(id);

    return apiSuccess(template, 200);
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requirePermission(PERMISSIONS.TEMPLATES_WRITE);
    const { id } = await params;
    const body: unknown = await req.json();
    const input = updateTemplateSchema.parse(body);
    const template = await templateService.update(id, input, session.user.id);

    return apiSuccess(template, 200);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requirePermission(PERMISSIONS.TEMPLATES_DELETE);
    const { id } = await params;
    const template = await templateService.delete(id, session.user.id);

    return apiSuccess(template, 200);
  } catch (error) {
    return apiError(error);
  }
}

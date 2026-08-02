import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { templateService } from "@/modules/templates/services/template.service";
import { previewTemplateSchema } from "@/modules/templates/validators/template.validator";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    await requirePermission(PERMISSIONS.TEMPLATES_READ);
    const { id } = await params;
    const body: unknown = await req.json().catch(() => ({}));
    const input = previewTemplateSchema.parse(body);
    const preview = await templateService.preview(id, input);

    return apiSuccess(preview, 200);
  } catch (error) {
    return apiError(error);
  }
}

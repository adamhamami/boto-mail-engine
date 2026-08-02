import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { getPaginationMeta } from "@/lib/api/pagination";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { templateService } from "@/modules/templates/services/template.service";
import {
  createTemplateSchema,
  listTemplatesSchema,
} from "@/modules/templates/validators/template.validator";

export async function GET(req: NextRequest) {
  try {
    await requirePermission(PERMISSIONS.TEMPLATES_READ);

    const params = Object.fromEntries(req.nextUrl.searchParams);
    const input = listTemplatesSchema.parse(params);
    const { items, total } = await templateService.list(input);

    return apiSuccess(items, 200, getPaginationMeta(input.page, input.limit, total));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(PERMISSIONS.TEMPLATES_WRITE);
    const body: unknown = await req.json();
    const input = createTemplateSchema.parse(body);
    const template = await templateService.create(input, session.user.id);

    return apiSuccess(template, 201);
  } catch (error) {
    return apiError(error);
  }
}

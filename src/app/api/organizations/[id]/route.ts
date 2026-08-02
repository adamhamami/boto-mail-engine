import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { organizationService } from "@/modules/organizations/services/organization.service";
import { updateOrganizationSchema } from "@/modules/organizations/validators/organization.validator";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requirePermission(PERMISSIONS.ORGS_READ);
    const { id } = await params;
    const org = await organizationService.getById(id);

    return apiSuccess(org, 200);
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requirePermission(PERMISSIONS.ORGS_WRITE);
    const { id } = await params;
    const body: unknown = await req.json();
    const input = updateOrganizationSchema.parse(body);
    const org = await organizationService.update(id, input, session.user.id);

    return apiSuccess(org, 200);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requirePermission(PERMISSIONS.ORGS_DELETE);
    const { id } = await params;
    const org = await organizationService.delete(id, session.user.id);

    return apiSuccess(org, 200);
  } catch (error) {
    return apiError(error);
  }
}

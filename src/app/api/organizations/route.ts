import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { getPaginationMeta } from "@/lib/api/pagination";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { organizationService } from "@/modules/organizations/services/organization.service";
import {
  createOrganizationSchema,
  listOrganizationsSchema,
} from "@/modules/organizations/validators/organization.validator";

export async function GET(req: NextRequest) {
  try {
    await requirePermission(PERMISSIONS.ORGS_READ);

    const params = Object.fromEntries(req.nextUrl.searchParams);
    const input = listOrganizationsSchema.parse(params);
    const { items, total } = await organizationService.list(input);

    return apiSuccess(items, 200, getPaginationMeta(input.page, input.limit, total));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(PERMISSIONS.ORGS_WRITE);
    const body: unknown = await req.json();
    const input = createOrganizationSchema.parse(body);
    const org = await organizationService.create(input, session.user.id);

    return apiSuccess(org, 201);
  } catch (error) {
    return apiError(error);
  }
}

import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { getPaginationMeta } from "@/lib/api/pagination";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { complianceRequestService } from "@/modules/compliance/services/request.service";
import {
  createDataSubjectRequestSchema,
  listDataSubjectRequestsSchema,
} from "@/modules/compliance/validators/compliance.validator";

export async function GET(req: NextRequest) {
  try {
    await requirePermission(PERMISSIONS.COMPLIANCE_READ);
    const params = Object.fromEntries(req.nextUrl.searchParams);
    const input = listDataSubjectRequestsSchema.parse(params);
    const { items, total } = await complianceRequestService.list(input);
    return apiSuccess(
      items,
      200,
      getPaginationMeta(input.page, input.limit, total),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(PERMISSIONS.COMPLIANCE_WRITE);
    const body = createDataSubjectRequestSchema.parse(await req.json());
    const created = await complianceRequestService.create(
      body,
      session.user.id,
    );
    return apiSuccess(created, 201);
  } catch (error) {
    return apiError(error);
  }
}

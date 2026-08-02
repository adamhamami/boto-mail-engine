import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { segmentService } from "@/modules/segments/services/segment.service";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requirePermission(PERMISSIONS.SEGMENTS_WRITE);
    const { id } = await params;
    const segment = await segmentService.refresh(id, session.user.id);

    return apiSuccess(segment, 200);
  } catch (error) {
    return apiError(error);
  }
}

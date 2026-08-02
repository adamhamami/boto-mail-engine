import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { segmentService } from "@/modules/segments/services/segment.service";
import { updateSegmentSchema } from "@/modules/segments/validators/segment.validator";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requirePermission(PERMISSIONS.SEGMENTS_READ);
    const { id } = await params;
    const segment = await segmentService.getById(id);

    return apiSuccess(segment, 200);
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requirePermission(PERMISSIONS.SEGMENTS_WRITE);
    const { id } = await params;
    const body: unknown = await req.json();
    const input = updateSegmentSchema.parse(body);
    const segment = await segmentService.update(id, input, session.user.id);

    return apiSuccess(segment, 200);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requirePermission(PERMISSIONS.SEGMENTS_DELETE);
    const { id } = await params;
    const segment = await segmentService.delete(id, session.user.id);

    return apiSuccess(segment, 200);
  } catch (error) {
    return apiError(error);
  }
}

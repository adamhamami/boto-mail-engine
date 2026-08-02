import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { segmentService } from "@/modules/segments/services/segment.service";
import { previewSegmentSchema } from "@/modules/segments/validators/segment.validator";

export async function POST(req: NextRequest) {
  try {
    await requirePermission(PERMISSIONS.SEGMENTS_READ);
    const body: unknown = await req.json();
    const input = previewSegmentSchema.parse(body);
    const preview = await segmentService.preview(
      input.filters,
      input.page,
      input.limit,
    );
    return apiSuccess(preview);
  } catch (error) {
    return apiError(error);
  }
}

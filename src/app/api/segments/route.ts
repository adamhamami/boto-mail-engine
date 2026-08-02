import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import {
  getPaginationMeta,
} from "@/lib/api/pagination";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { segmentService } from "@/modules/segments/services/segment.service";
import {
  createSegmentSchema,
  listSegmentsSchema,
} from "@/modules/segments/validators/segment.validator";

export async function GET(req: NextRequest) {
  try {
    await requirePermission(PERMISSIONS.SEGMENTS_READ);

    const params = Object.fromEntries(req.nextUrl.searchParams);
    const input = listSegmentsSchema.parse(params);
    const { items, total } = await segmentService.list(input);

    return apiSuccess(items, 200, getPaginationMeta(input.page, input.limit, total));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(PERMISSIONS.SEGMENTS_WRITE);
    const body: unknown = await req.json();
    const input = createSegmentSchema.parse(body);
    const segment = await segmentService.create(input, session.user.id);

    return apiSuccess(segment, 201);
  } catch (error) {
    return apiError(error);
  }
}

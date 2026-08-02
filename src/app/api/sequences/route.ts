import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { getPaginationMeta } from "@/lib/api/pagination";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { sequenceService } from "@/modules/sequences/services/sequence.service";
import {
  createSequenceSchema,
  listSequencesSchema,
} from "@/modules/sequences/validators/sequence.validator";

export async function GET(req: NextRequest) {
  try {
    await requirePermission(PERMISSIONS.SEQUENCES_READ);

    const params = Object.fromEntries(req.nextUrl.searchParams);
    const input = listSequencesSchema.parse(params);
    const { items, total } = await sequenceService.list(input);

    return apiSuccess(items, 200, getPaginationMeta(input.page, input.limit, total));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(PERMISSIONS.SEQUENCES_WRITE);
    const body: unknown = await req.json();
    const input = createSequenceSchema.parse(body);
    const sequence = await sequenceService.create(input, session.user.id);

    return apiSuccess(sequence, 201);
  } catch (error) {
    return apiError(error);
  }
}

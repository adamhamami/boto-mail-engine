import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { sequenceService } from "@/modules/sequences/services/sequence.service";
import { updateSequenceSchema } from "@/modules/sequences/validators/sequence.validator";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requirePermission(PERMISSIONS.SEQUENCES_READ);
    const { id } = await params;
    const sequence = await sequenceService.getById(id);

    return apiSuccess(sequence, 200);
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requirePermission(PERMISSIONS.SEQUENCES_WRITE);
    const { id } = await params;
    const body: unknown = await req.json();
    const input = updateSequenceSchema.parse(body);
    const sequence = await sequenceService.update(id, input, session.user.id);

    return apiSuccess(sequence, 200);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requirePermission(PERMISSIONS.SEQUENCES_DELETE);
    const { id } = await params;
    const sequence = await sequenceService.delete(id, session.user.id);

    return apiSuccess(sequence, 200);
  } catch (error) {
    return apiError(error);
  }
}

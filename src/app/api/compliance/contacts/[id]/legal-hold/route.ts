import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { NotFoundError } from "@/lib/errors";
import { AuditAction } from "@/generated/prisma/client";
import { auditService } from "@/modules/audit/services/audit.service";
import { legalHoldSchema } from "@/modules/compliance/validators/compliance.validator";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requirePermission(PERMISSIONS.COMPLIANCE_RETENTION);
    const { id } = await ctx.params;
    const body = legalHoldSchema.parse(await req.json());

    const contact = await prisma.contact.findUnique({ where: { id } });
    if (!contact) throw new NotFoundError("Contact", id);

    const updated = await prisma.contact.update({
      where: { id },
      data: { legalHold: body.legalHold },
      select: { id: true, legalHold: true, email: true },
    });

    await auditService.log({
      action: AuditAction.UPDATE,
      module: "compliance",
      entityType: "Contact",
      entityId: id,
      userId: session.user.id,
      newValues: {
        legalHold: body.legalHold,
        reason: body.reason ?? null,
      },
      metadata: { kind: "legal_hold" },
    });

    return apiSuccess(updated);
  } catch (error) {
    return apiError(error);
  }
}

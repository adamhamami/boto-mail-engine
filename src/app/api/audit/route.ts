import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { getPaginationMeta, paginationSchema } from "@/lib/api/pagination";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AuditAction } from "@/generated/prisma/client";
import { auditService } from "@/modules/audit/services/audit.service";

const listAuditSchema = paginationSchema.extend({
  module: z.string().optional(),
  action: z.nativeEnum(AuditAction).optional(),
  userId: z.string().cuid().optional(),
});

export async function GET(req: NextRequest) {
  try {
    await requirePermission(PERMISSIONS.AUDIT_READ);

    const params = Object.fromEntries(req.nextUrl.searchParams);
    const input = listAuditSchema.parse(params);
    const { items, total, nextCursor, hasNext } = await auditService.findMany({
      page: input.page,
      limit: input.limit,
      module: input.module,
      action: input.action,
      userId: input.userId,
      cursor: input.cursor,
    });

    if (input.cursor) {
      return apiSuccess(items, 200, {
        limit: input.limit,
        nextCursor,
        hasNext: hasNext ?? false,
        mode: "cursor" as const,
      });
    }

    return apiSuccess(
      items,
      200,
      getPaginationMeta(input.page, input.limit, total ?? 0),
    );
  } catch (error) {
    return apiError(error);
  }
}

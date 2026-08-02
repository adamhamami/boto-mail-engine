import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AuditAction } from "@/generated/prisma/client";
import { toCsvDocument } from "@/lib/export/csv-safe";
import { auditService } from "@/modules/audit/services/audit.service";

const exportAuditSchema = z.object({
  module: z.string().optional(),
  action: z.nativeEnum(AuditAction).optional(),
  userId: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(10_000).default(5000),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requirePermission(PERMISSIONS.AUDIT_EXPORT);

    const params = Object.fromEntries(req.nextUrl.searchParams);
    const input = exportAuditSchema.parse(params);
    const { items } = await auditService.findMany({
      page: 1,
      limit: input.limit,
      module: input.module,
      action: input.action,
      userId: input.userId,
    });

    const headers = [
      "id",
      "createdAt",
      "action",
      "module",
      "entityType",
      "entityId",
      "userEmail",
      "userName",
      "ipAddress",
    ];

    const rows = items.map((item) => [
      item.id,
      item.createdAt.toISOString(),
      item.action,
      item.module,
      item.entityType,
      item.entityId ?? "",
      item.user?.email ?? "",
      item.user?.name ?? "",
      item.ipAddress ?? "",
    ]);

    const csv = toCsvDocument(headers, rows);

    await auditService.log({
      action: "EXPORT",
      module: "audit",
      entityType: "AuditLog",
      userId: session.user.id,
      metadata: { count: items.length },
    });

    const filename = `audit-export-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

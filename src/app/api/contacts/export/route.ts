import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ContactStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { toCsvDocument } from "@/lib/export/csv-safe";
import { auditService } from "@/modules/audit/services/audit.service";
import { buildContactFilterWhere } from "@/modules/segments/repositories/segment.repository";
import { segmentFiltersSchema } from "@/modules/segments/validators/segment.validator";

const exportContactsSchema = z.object({
  status: z.nativeEnum(ContactStatus).optional(),
  organizationId: z.string().cuid().optional(),
  city: z.string().optional(),
  eligibleOnly: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => v === true || v === "true")
    .optional(),
  limit: z.coerce.number().int().min(1).max(50_000).default(5000),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requirePermission(PERMISSIONS.CONTACTS_EXPORT);

    const params = Object.fromEntries(req.nextUrl.searchParams);
    const input = exportContactsSchema.parse(params);
    const filters = segmentFiltersSchema.parse({
      status: input.status,
      organizationId: input.organizationId,
      city: input.city,
      eligibleOnly: input.eligibleOnly,
    });
    const where = buildContactFilterWhere(filters);

    const contacts = await prisma.contact.findMany({
      where,
      take: input.limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        city: true,
        status: true,
        tags: true,
        source: true,
        organization: { select: { name: true, industry: true, size: true } },
      },
    });

    const headers = [
      "id",
      "email",
      "firstName",
      "lastName",
      "city",
      "status",
      "organization",
      "establishmentType",
      "size",
      "tags",
      "source",
    ];

    const rows = contacts.map((c) => [
      c.id,
      c.email,
      c.firstName,
      c.lastName,
      c.city,
      c.status,
      c.organization?.name,
      c.organization?.industry,
      c.organization?.size,
      c.tags.join("|"),
      c.source,
    ]);

    const csv = toCsvDocument(headers, rows);

    await auditService.log({
      action: "EXPORT",
      module: "contacts",
      entityType: "Contact",
      userId: session.user.id,
      metadata: { count: contacts.length, filters },
    });

    const filename = `contacts-export-${new Date().toISOString().slice(0, 10)}.csv`;
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

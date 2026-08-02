import { prisma } from "@/lib/db/prisma";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { getSkipTake } from "@/lib/api/pagination";
import { auditService } from "@/modules/audit/services/audit.service";
import { normalizeEmailAddress } from "@/lib/data/integrity";
import type {
  CreateSuppressionInput,
  ListSuppressionInput,
} from "@/modules/suppression/validators/suppression.validator";

export class SuppressionService {
  async list(input: ListSuppressionInput) {
    const { skip, take } = getSkipTake(input.page, input.limit);

    const where = {
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.search
        ? { email: { contains: input.search, mode: "insensitive" as const } }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.suppressionList.findMany({
        where,
        include: {
          contact: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
          createdBy: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: input.sortOrder },
        skip,
        take,
      }),
      prisma.suppressionList.count({ where }),
    ]);

    return { items, total };
  }

  async create(input: CreateSuppressionInput, userId: string) {
    const emailNormalized = normalizeEmailAddress(input.email);
    const existing = await prisma.suppressionList.findUnique({
      where: { emailNormalized },
    });

    if (existing) {
      throw new ConflictError(
        `L'email ${input.email} est déjà dans la liste de suppression`,
      );
    }

    const entry = await prisma.suppressionList.create({
      data: {
        email: input.email.trim(),
        emailNormalized,
        reason: input.reason,
        notes: input.notes,
        contactId: input.contactId,
        source: "manual",
        createdById: userId,
      },
      include: {
        contact: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    await auditService.log({
      action: "CREATE",
      module: "suppression",
      entityType: "SuppressionList",
      entityId: entry.id,
      userId,
      newValues: entry,
    });

    return entry;
  }

  async delete(id: string, userId: string) {
    const existing = await prisma.suppressionList.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError("SuppressionList", id);
    }

    await prisma.suppressionList.delete({ where: { id } });

    await auditService.log({
      action: "DELETE",
      module: "suppression",
      entityType: "SuppressionList",
      entityId: id,
      userId,
      oldValues: existing,
    });

    return existing;
  }
}

export const suppressionService = new SuppressionService();

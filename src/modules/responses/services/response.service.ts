import { prisma } from "@/lib/db/prisma";
import { NotFoundError } from "@/lib/errors";
import { getSkipTake } from "@/lib/api/pagination";
import { auditService } from "@/modules/audit/services/audit.service";
import { EventType, type Prisma } from "@/generated/prisma/client";
import type {
  ListResponsesInput,
  UpdateResponseInput,
} from "@/modules/responses/validators/response.validator";

export class ResponseService {
  async list(input: ListResponsesInput) {
    const { skip, take } = getSkipTake(input.page, input.limit);

    const where = {
      type: EventType.EMAIL_REPLIED,
      ...(input.campaignId ? { campaignId: input.campaignId } : {}),
      ...(input.search
        ? {
            contact: {
              OR: [
                { email: { contains: input.search, mode: "insensitive" as const } },
                { firstName: { contains: input.search, mode: "insensitive" as const } },
                { lastName: { contains: input.search, mode: "insensitive" as const } },
              ],
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.event.findMany({
        where,
        include: {
          contact: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              status: true,
              customFields: true,
              organization: { select: { id: true, name: true } },
            },
          },
          campaign: { select: { id: true, name: true } },
        },
        orderBy: { occurredAt: input.sortOrder },
        skip,
        take,
      }),
      prisma.event.count({ where }),
    ]);

    return { items, total };
  }

  async update(id: string, input: UpdateResponseInput, userId: string) {
    const event = await prisma.event.findFirst({
      where: { id, type: EventType.EMAIL_REPLIED },
      include: { contact: true },
    });

    if (!event?.contact) {
      throw new NotFoundError("Response", id);
    }

    const existing = event.contact;
    const existingFields =
      typeof existing.customFields === "object" &&
      existing.customFields !== null &&
      !Array.isArray(existing.customFields)
        ? (existing.customFields as Record<string, unknown>)
        : {};

    const customFields =
      input.notes !== undefined
        ? { ...existingFields, notes: input.notes ?? "" }
        : existingFields;

    const contact = await prisma.contact.update({
      where: { id: existing.id },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.notes !== undefined
          ? { customFields: customFields as Prisma.InputJsonValue }
          : {}),
        updatedById: userId,
      },
      include: {
        organization: { select: { id: true, name: true } },
      },
    });

    await auditService.log({
      action: "UPDATE",
      module: "responses",
      entityType: "Contact",
      entityId: contact.id,
      userId,
      oldValues: {
        status: existing.status,
        customFields: existing.customFields,
      },
      newValues: {
        status: contact.status,
        customFields: contact.customFields,
      },
      metadata: { responseEventId: id },
    });

    return { event, contact };
  }
}

export const responseService = new ResponseService();

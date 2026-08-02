import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type {
  CreateSegmentInput,
  SegmentFilters,
  UpdateSegmentInput,
} from "@/modules/segments/validators/segment.validator";

const segmentSelect = {
  id: true,
  name: true,
  description: true,
  filters: true,
  isDynamic: true,
  contactCount: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  createdById: true,
  updatedById: true,
  createdBy: { select: { id: true, name: true, email: true } },
  updatedBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.SegmentSelect;

export function buildContactFilterWhere(
  filters: SegmentFilters,
): Prisma.ContactWhereInput {
  const statusFilter = filters.eligibleOnly
    ? { status: "ELIGIBLE" as const }
    : filters.statuses?.length
      ? { status: { in: filters.statuses } }
      : filters.status
        ? { status: filters.status }
        : {};

  return {
    deletedAt: null,
    ...statusFilter,
    ...(filters.organizationId
      ? { organizationId: filters.organizationId }
      : {}),
    ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
    ...(filters.tags?.length ? { tags: { hasEvery: filters.tags } } : {}),
    ...(filters.city
      ? {
          OR: [
            { city: { equals: filters.city, mode: "insensitive" } },
            {
              organization: {
                city: { equals: filters.city, mode: "insensitive" },
              },
            },
          ],
        }
      : {}),
    ...(filters.establishmentType || filters.organizationSize
      ? {
          organization: {
            ...(filters.establishmentType
              ? {
                  industry: {
                    equals: filters.establishmentType,
                    mode: "insensitive",
                  },
                }
              : {}),
            ...(filters.organizationSize
              ? {
                  size: {
                    equals: filters.organizationSize,
                    mode: "insensitive",
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(filters.scoreMin !== undefined || filters.scoreMax !== undefined
      ? {
          score: {
            ...(filters.scoreMin !== undefined
              ? { gte: filters.scoreMin }
              : {}),
            ...(filters.scoreMax !== undefined
              ? { lte: filters.scoreMax }
              : {}),
          },
        }
      : {}),
  };
}

export class SegmentRepository {
  async findMany(params: {
    skip: number;
    take: number;
    search?: string;
    sortOrder?: "asc" | "desc";
  }) {
    const where: Prisma.SegmentWhereInput = {
      deletedAt: null,
      ...(params.search
        ? { name: { contains: params.search, mode: "insensitive" } }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.segment.findMany({
        where,
        select: segmentSelect,
        orderBy: { createdAt: params.sortOrder ?? "desc" },
        skip: params.skip,
        take: params.take,
      }),
      prisma.segment.count({ where }),
    ]);

    return { items, total };
  }

  async findById(id: string) {
    return prisma.segment.findFirst({
      where: { id, deletedAt: null },
      select: segmentSelect,
    });
  }

  async create(input: CreateSegmentInput, userId: string) {
    return prisma.segment.create({
      data: {
        name: input.name,
        description: input.description,
        filters: input.filters,
        isDynamic: input.isDynamic ?? true,
        createdById: userId,
        updatedById: userId,
      },
      select: segmentSelect,
    });
  }

  async update(id: string, input: UpdateSegmentInput, userId: string) {
    return prisma.segment.update({
      where: { id },
      data: {
        ...input,
        ...(input.filters !== undefined ? { version: { increment: 1 } } : {}),
        updatedById: userId,
      },
      select: segmentSelect,
    });
  }

  async softDelete(id: string, userId: string) {
    return prisma.segment.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        updatedById: userId,
      },
      select: segmentSelect,
    });
  }

  async refreshMembership(segmentId: string, contactIds: string[]) {
    return prisma.$transaction(async (tx) => {
      await tx.segmentContact.deleteMany({ where: { segmentId } });

      if (contactIds.length > 0) {
        await tx.segmentContact.createMany({
          data: contactIds.map((contactId) => ({
            segmentId,
            contactId,
          })),
          skipDuplicates: true,
        });
      }

      return tx.segment.update({
        where: { id: segmentId },
        data: { contactCount: contactIds.length },
        select: segmentSelect,
      });
    });
  }
}

export const segmentRepository = new SegmentRepository();

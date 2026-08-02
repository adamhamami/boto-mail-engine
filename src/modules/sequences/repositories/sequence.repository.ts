import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type {
  CreateSequenceInput,
  UpdateSequenceInput,
} from "@/modules/sequences/validators/sequence.validator";

const sequenceStepSelect = {
  id: true,
  stepOrder: true,
  type: true,
  templateId: true,
  delayDays: true,
  delayHours: true,
  template: {
    select: { id: true, name: true, subject: true },
  },
} satisfies Prisma.SequenceStepSelect;

const sequenceSelect = {
  id: true,
  name: true,
  description: true,
  isActive: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  createdById: true,
  updatedById: true,
  createdBy: { select: { id: true, name: true, email: true } },
  updatedBy: { select: { id: true, name: true, email: true } },
  steps: {
    select: sequenceStepSelect,
    orderBy: { stepOrder: "asc" as const },
  },
} satisfies Prisma.SequenceSelect;

export class SequenceRepository {
  async findMany(params: {
    skip: number;
    take: number;
    search?: string;
    sortOrder?: "asc" | "desc";
  }) {
    const where: Prisma.SequenceWhereInput = {
      deletedAt: null,
      ...(params.search
        ? { name: { contains: params.search, mode: "insensitive" } }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.sequence.findMany({
        where,
        select: sequenceSelect,
        orderBy: { createdAt: params.sortOrder ?? "desc" },
        skip: params.skip,
        take: params.take,
      }),
      prisma.sequence.count({ where }),
    ]);

    return { items, total };
  }

  async findById(id: string) {
    return prisma.sequence.findFirst({
      where: { id, deletedAt: null },
      select: sequenceSelect,
    });
  }

  async create(input: CreateSequenceInput, userId: string) {
    return prisma.sequence.create({
      data: {
        name: input.name,
        description: input.description,
        isActive: input.isActive ?? true,
        createdById: userId,
        updatedById: userId,
        steps: {
          create: input.steps.map((step) => ({
            stepOrder: step.stepOrder,
            type: step.type,
            templateId: step.templateId,
            delayDays: step.delayDays ?? 0,
            delayHours: step.delayHours ?? 0,
          })),
        },
      },
      select: sequenceSelect,
    });
  }

  async update(id: string, input: UpdateSequenceInput, userId: string) {
    return prisma.$transaction(async (tx) => {
      if (input.steps) {
        await tx.sequenceStep.deleteMany({ where: { sequenceId: id } });
      }

      return tx.sequence.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          isActive: input.isActive,
          updatedById: userId,
          ...(input.steps
            ? {
                version: { increment: 1 },
                steps: {
                  create: input.steps.map((step) => ({
                    stepOrder: step.stepOrder,
                    type: step.type,
                    templateId: step.templateId,
                    delayDays: step.delayDays ?? 0,
                    delayHours: step.delayHours ?? 0,
                  })),
                },
              }
            : {}),
        },
        select: sequenceSelect,
      });
    });
  }

  async softDelete(id: string, userId: string) {
    return prisma.sequence.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isActive: false,
        updatedById: userId,
      },
      select: sequenceSelect,
    });
  }
}

export const sequenceRepository = new SequenceRepository();

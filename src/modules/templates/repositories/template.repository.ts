import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { hashContent } from "@/lib/data/integrity";
import type {
  CreateTemplateInput,
  UpdateTemplateInput,
} from "@/modules/templates/validators/template.validator";

/** Liste légère — pas de bodyHtml/bodyText (payloads lourds). */
const templateListSelect = {
  id: true,
  name: true,
  subject: true,
  variables: true,
  isActive: true,
  version: true,
  contentHash: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  createdById: true,
  updatedById: true,
  createdBy: { select: { id: true, name: true, email: true } },
  updatedBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.TemplateSelect;

const templateSelect = {
  ...templateListSelect,
  bodyHtml: true,
  bodyText: true,
} satisfies Prisma.TemplateSelect;

export class TemplateRepository {
  async findMany(params: {
    skip: number;
    take: number;
    search?: string;
    sortOrder?: "asc" | "desc";
  }) {
    const where: Prisma.TemplateWhereInput = {
      deletedAt: null,
      ...(params.search
        ? {
            OR: [
              { name: { contains: params.search, mode: "insensitive" } },
              { subject: { contains: params.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.template.findMany({
        where,
        select: templateListSelect,
        orderBy: { createdAt: params.sortOrder ?? "desc" },
        skip: params.skip,
        take: params.take,
      }),
      prisma.template.count({ where }),
    ]);

    return { items, total };
  }

  async findById(id: string) {
    return prisma.template.findFirst({
      where: { id, deletedAt: null },
      select: templateSelect,
    });
  }

  async create(input: CreateTemplateInput, userId: string) {
    const contentHash = hashContent({
      subject: input.subject,
      bodyHtml: input.bodyHtml,
      bodyText: input.bodyText ?? "",
    });
    return prisma.template.create({
      data: {
        name: input.name,
        subject: input.subject,
        bodyHtml: input.bodyHtml,
        bodyText: input.bodyText,
        variables: input.variables,
        version: 1,
        contentHash,
        createdById: userId,
        updatedById: userId,
      },
      select: templateSelect,
    });
  }

  async update(id: string, input: UpdateTemplateInput, userId: string) {
    const existing = await this.findById(id);
    const subject = input.subject ?? existing?.subject ?? "";
    const bodyHtml = input.bodyHtml ?? existing?.bodyHtml ?? "";
    const bodyText =
      input.bodyText !== undefined
        ? input.bodyText
        : (existing?.bodyText ?? "");
    const contentChanged =
      input.subject !== undefined ||
      input.bodyHtml !== undefined ||
      input.bodyText !== undefined;

    return prisma.template.update({
      where: { id },
      data: {
        ...input,
        ...(contentChanged
          ? {
              version: { increment: 1 },
              contentHash: hashContent({
                subject,
                bodyHtml,
                bodyText: bodyText ?? "",
              }),
            }
          : {}),
        updatedById: userId,
      },
      select: templateSelect,
    });
  }

  async softDelete(id: string, userId: string) {
    return prisma.template.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isActive: false,
        updatedById: userId,
      },
      select: templateSelect,
    });
  }
}

export const templateRepository = new TemplateRepository();

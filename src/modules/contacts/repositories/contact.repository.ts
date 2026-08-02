import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { normalizeEmailAddress } from "@/lib/data/integrity";

/** Liste légère (Phase 11) — pas de customFields / eligibilityNotes. */
const contactListSelect = {
  id: true,
  email: true,
  emailNormalized: true,
  firstName: true,
  lastName: true,
  phone: true,
  jobTitle: true,
  city: true,
  status: true,
  score: true,
  tags: true,
  source: true,
  consentBase: true,
  isTestRecipient: true,
  isDuplicate: true,
  duplicateOfId: true,
  organizationId: true,
  lastContactedAt: true,
  createdAt: true,
  updatedAt: true,
  organization: { select: { id: true, name: true, domain: true, city: true } },
  duplicateOf: {
    select: { id: true, email: true, firstName: true, lastName: true },
  },
} satisfies Prisma.ContactSelect;

const contactSelect = {
  ...contactListSelect,
  customFields: true,
  eligibilityNotes: true,
  importBatchId: true,
  deletedAt: true,
  createdById: true,
  updatedById: true,
} satisfies Prisma.ContactSelect;

type CreateContactData = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  city?: string | null;
  status?: Prisma.ContactCreateInput["status"];
  score?: number;
  tags?: string[];
  customFields?: Record<string, unknown>;
  organizationId?: string | null;
  importBatchId?: string | null;
  source?: string | null;
  consentBase?: string | null;
  eligibilityNotes?: string | null;
  isTestRecipient?: boolean;
  isDuplicate?: boolean;
  duplicateOfId?: string | null;
};

type UpdateContactData = Partial<CreateContactData>;

export class ContactRepository {
  async findMany(params: {
    skip: number;
    take: number;
    search?: string;
    status?: string;
    organizationId?: string;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
  }) {
    const where: Prisma.ContactWhereInput = {
      deletedAt: null,
      ...(params.status ? { status: params.status as Prisma.EnumContactStatusFilter["equals"] } : {}),
      ...(params.organizationId ? { organizationId: params.organizationId } : {}),
      ...(params.search
        ? {
            OR: [
              { email: { contains: params.search, mode: "insensitive" } },
              { firstName: { contains: params.search, mode: "insensitive" } },
              { lastName: { contains: params.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const orderBy: Prisma.ContactOrderByWithRelationInput = {
      [params.sortBy === "email" ? "email" : "createdAt"]:
        params.sortOrder ?? "desc",
    };

    const [items, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        select: contactListSelect,
        orderBy,
        skip: params.skip,
        take: params.take,
      }),
      prisma.contact.count({ where }),
    ]);

    return { items, total };
  }

  async findById(id: string) {
    return prisma.contact.findFirst({
      where: { id, deletedAt: null },
      select: contactSelect,
    });
  }

  async findByEmail(email: string, excludeId?: string) {
    const emailNormalized = normalizeEmailAddress(email);
    return prisma.contact.findFirst({
      where: {
        emailNormalized,
        deletedAt: null,
        isDuplicate: false,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async findDuplicates(params: { skip: number; take: number }) {
    const where: Prisma.ContactWhereInput = {
      deletedAt: null,
      isDuplicate: true,
    };

    const [items, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        select: contactSelect,
        orderBy: { createdAt: "desc" },
        skip: params.skip,
        take: params.take,
      }),
      prisma.contact.count({ where }),
    ]);

    return { items, total };
  }

  async create(data: CreateContactData, userId: string) {
    const emailNormalized = normalizeEmailAddress(data.email);
    return prisma.contact.create({
      data: {
        email: data.email.trim(),
        emailNormalized,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        jobTitle: data.jobTitle,
        city: data.city,
        status: data.status ?? "IMPORTED",
        score: data.score ?? 0,
        tags: data.tags ?? [],
        customFields: (data.customFields ?? {}) as Prisma.InputJsonValue,
        organizationId: data.organizationId,
        importBatchId: data.importBatchId,
        source: data.source,
        consentBase: data.consentBase,
        eligibilityNotes: data.eligibilityNotes,
        isTestRecipient: data.isTestRecipient ?? false,
        isDuplicate: data.isDuplicate ?? false,
        duplicateOfId: data.duplicateOfId,
        createdById: userId,
        updatedById: userId,
      },
      select: contactSelect,
    });
  }

  async update(id: string, data: UpdateContactData, userId: string) {
    return prisma.contact.update({
      where: { id },
      data: {
        ...(data.email !== undefined
          ? {
              email: data.email.trim(),
              emailNormalized: normalizeEmailAddress(data.email),
            }
          : {}),
        ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
        ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.jobTitle !== undefined ? { jobTitle: data.jobTitle } : {}),
        ...(data.city !== undefined ? { city: data.city } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.score !== undefined ? { score: data.score } : {}),
        ...(data.tags !== undefined ? { tags: data.tags } : {}),
        ...(data.customFields !== undefined
          ? { customFields: data.customFields as Prisma.InputJsonValue }
          : {}),
        ...(data.organizationId !== undefined
          ? { organizationId: data.organizationId }
          : {}),
        ...(data.importBatchId !== undefined
          ? { importBatchId: data.importBatchId }
          : {}),
        ...(data.source !== undefined ? { source: data.source } : {}),
        ...(data.consentBase !== undefined
          ? { consentBase: data.consentBase }
          : {}),
        ...(data.eligibilityNotes !== undefined
          ? { eligibilityNotes: data.eligibilityNotes }
          : {}),
        ...(data.isTestRecipient !== undefined
          ? { isTestRecipient: data.isTestRecipient }
          : {}),
        ...(data.isDuplicate !== undefined
          ? { isDuplicate: data.isDuplicate }
          : {}),
        ...(data.duplicateOfId !== undefined
          ? { duplicateOfId: data.duplicateOfId }
          : {}),
        updatedById: userId,
      },
      select: contactSelect,
    });
  }

  async softDelete(id: string, userId: string) {
    return prisma.contact.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        updatedById: userId,
      },
      select: contactSelect,
    });
  }

  async findMatchingFilters(filters: Prisma.ContactWhereInput) {
    return prisma.contact.findMany({
      where: {
        deletedAt: null,
        isDuplicate: false,
        ...filters,
      },
      select: { id: true },
    });
  }
}

export const contactRepository = new ContactRepository();

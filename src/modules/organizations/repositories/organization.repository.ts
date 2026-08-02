import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type {
  CreateOrganizationInput,
  UpdateOrganizationInput,
} from "@/modules/organizations/validators/organization.validator";

const organizationSelect = {
  id: true,
  name: true,
  domain: true,
  industry: true,
  size: true,
  website: true,
  address: true,
  city: true,
  country: true,
  notes: true,
  tags: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  createdById: true,
  updatedById: true,
  createdBy: { select: { id: true, name: true, email: true } },
  updatedBy: { select: { id: true, name: true, email: true } },
  _count: { select: { contacts: true } },
} satisfies Prisma.OrganizationSelect;

export class OrganizationRepository {
  async findMany(params: {
    skip: number;
    take: number;
    search?: string;
    domain?: string;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
  }) {
    const where: Prisma.OrganizationWhereInput = {
      deletedAt: null,
      ...(params.domain
        ? { domain: { contains: params.domain, mode: "insensitive" } }
        : {}),
      ...(params.search
        ? {
            OR: [
              { name: { contains: params.search, mode: "insensitive" } },
              { domain: { contains: params.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const orderBy: Prisma.OrganizationOrderByWithRelationInput = {
      [params.sortBy === "name" ? "name" : "createdAt"]:
        params.sortOrder ?? "desc",
    };

    const [items, total] = await Promise.all([
      prisma.organization.findMany({
        where,
        select: organizationSelect,
        orderBy,
        skip: params.skip,
        take: params.take,
      }),
      prisma.organization.count({ where }),
    ]);

    return { items, total };
  }

  async findById(id: string) {
    return prisma.organization.findFirst({
      where: { id, deletedAt: null },
      select: organizationSelect,
    });
  }

  async findByName(name: string) {
    return prisma.organization.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        deletedAt: null,
      },
    });
  }

  async create(data: CreateOrganizationInput, userId: string) {
    return prisma.organization.create({
      data: {
        ...data,
        website: data.website || null,
        createdById: userId,
        updatedById: userId,
      },
      select: organizationSelect,
    });
  }

  async update(id: string, data: UpdateOrganizationInput, userId: string) {
    return prisma.organization.update({
      where: { id },
      data: {
        ...data,
        website: data.website === "" ? null : data.website,
        updatedById: userId,
      },
      select: organizationSelect,
    });
  }

  async softDelete(id: string, userId: string) {
    return prisma.organization.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        updatedById: userId,
      },
      select: organizationSelect,
    });
  }
}

export const organizationRepository = new OrganizationRepository();

import { prisma } from "@/lib/db/prisma";
import type { Prisma, User } from "@/generated/prisma/client";
import type {
  CreateUserInput,
  UpdateUserInput,
} from "@/modules/users/validators/user.validator";

const userSelect = {
  id: true,
  email: true,
  emailVerified: true,
  name: true,
  image: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  userRoles: {
    select: {
      id: true,
      role: {
        select: { id: true, name: true, slug: true },
      },
    },
  },
} satisfies Prisma.UserSelect;

export type SafeUser = Omit<User, "passwordHash"> & {
  userRoles: Array<{
    id: string;
    role: { id: string; name: string; slug: string };
  }>;
};

export class UserRepository {
  async findMany(params: {
    skip: number;
    take: number;
    search?: string;
    status?: string;
    sortOrder?: "asc" | "desc";
  }) {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(params.status
        ? { status: params.status as Prisma.EnumUserStatusFilter["equals"] }
        : {}),
      ...(params.search
        ? {
            OR: [
              { email: { contains: params.search, mode: "insensitive" } },
              { name: { contains: params.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: userSelect,
        orderBy: { createdAt: params.sortOrder ?? "desc" },
        skip: params.skip,
        take: params.take,
      }),
      prisma.user.count({ where }),
    ]);

    return { items, total };
  }

  async findById(id: string) {
    return prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: userSelect,
    });
  }

  async findByEmail(email: string, excludeId?: string) {
    return prisma.user.findFirst({
      where: {
        email: email.toLowerCase(),
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  async create(
    data: CreateUserInput & { passwordHash: string },
  ) {
    return prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        name: data.name,
        passwordHash: data.passwordHash,
        status: data.status,
        userRoles: {
          create: data.roleIds.map((roleId) => ({ roleId })),
        },
      },
      select: userSelect,
    });
  }

  async update(
    id: string,
    data: UpdateUserInput & { passwordHash?: string },
  ) {
    return prisma.$transaction(async (tx) => {
      if (data.roleIds) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        if (data.roleIds.length > 0) {
          await tx.userRole.createMany({
            data: data.roleIds.map((roleId) => ({ userId: id, roleId })),
          });
        }
      }

      return tx.user.update({
        where: { id },
        data: {
          email: data.email ? data.email.toLowerCase() : undefined,
          name: data.name,
          status: data.status,
          passwordHash: data.passwordHash,
        },
        select: userSelect,
      });
    });
  }

  async softDelete(id: string) {
    return prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), status: "INACTIVE" },
      select: userSelect,
    });
  }

  async listRoles() {
    return prisma.role.findMany({
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    });
  }
}

export const userRepository = new UserRepository();

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { loginSchema } from "@/modules/auth/validators/auth.validator";
import { authConfig } from "@/lib/auth/auth.config";
import { consumeRateLimit } from "@/lib/api/rate-limit";
import { logger } from "@/lib/logger";
import { extractClientMeta } from "@/lib/observability/http";

async function findUserWithAccess(email: string) {
  return prisma.user.findUnique({
    where: { email },
    include: {
      userRoles: {
        include: {
          role: {
            include: {
              rolePermissions: {
                include: {
                  permission: true,
                },
              },
            },
          },
        },
      },
    },
  });
}

function collectRolesAndPermissions(
  user: NonNullable<Awaited<ReturnType<typeof findUserWithAccess>>>,
) {
  const roles = user.userRoles.map((userRole) => userRole.role.slug);
  const permissionSlugs = new Set<string>();

  for (const userRole of user.userRoles) {
    for (const rolePermission of userRole.role.rolePermissions) {
      permissionSlugs.add(rolePermission.permission.slug);
    }
  }

  return {
    roles,
    permissions: [...permissionSlugs],
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) {
          return null;
        }

        const email = parsed.data.email.trim().toLowerCase();

        const rate = await consumeRateLimit("login", email);
        if (!rate.allowed) {
          logger.warn(
            { emailDomain: email.split("@")[1] ?? "unknown" },
            "Login rate limit exceeded",
          );
          return null;
        }

        const { ipAddress } = extractClientMeta({ headers: request.headers });
        if (ipAddress) {
          const ipRate = await consumeRateLimit("login-ip", ipAddress);
          if (!ipRate.allowed) {
            logger.warn("Login IP rate limit exceeded");
            return null;
          }
        }

        const user = await findUserWithAccess(email);

        if (
          !user ||
          user.deletedAt !== null ||
          user.status !== "ACTIVE" ||
          !user.passwordHash
        ) {
          return null;
        }

        const passwordValid = await bcrypt.compare(
          parsed.data.password,
          user.passwordHash,
        );

        if (!passwordValid) {
          return null;
        }

        const { roles, permissions } = collectRolesAndPermissions(user);

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          roles,
          permissions,
        };
      },
    }),
  ],
});

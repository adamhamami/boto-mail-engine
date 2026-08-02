import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { consumeRateLimit } from "@/lib/api/rate-limit";
import { AppError, ForbiddenError, UnauthorizedError } from "@/lib/errors";
import type { PermissionSlug } from "@/lib/auth/permissions";
import { extractClientMeta } from "@/lib/observability/http";

export interface AuthSession {
  user: {
    id: string;
    email: string;
    name: string | null;
    permissions: PermissionSlug[];
    roles: string[];
  };
}

async function assertAuthenticatedApiRateLimit(userId: string): Promise<void> {
  const userRate = await consumeRateLimit("api", `user:${userId}`);
  if (!userRate.allowed) {
    throw new AppError(
      "Trop de requêtes. Réessayez dans une minute.",
      429,
      "RATE_LIMITED",
      { retryAfterMs: userRate.retryAfterMs },
    );
  }

  try {
    const h = await headers();
    const { ipAddress } = extractClientMeta({ headers: h });
    if (!ipAddress) return;
    const ipRate = await consumeRateLimit("api-ip", ipAddress);
    if (!ipRate.allowed) {
      throw new AppError(
        "Trop de requêtes depuis cette adresse. Réessayez dans une minute.",
        429,
        "RATE_LIMITED",
        { retryAfterMs: ipRate.retryAfterMs },
      );
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    /* headers() hors contexte requête — ignore bucket IP */
  }
}

export async function requireAuth(): Promise<AuthSession> {
  const session = await auth();

  if (!session?.user?.id) {
    throw new UnauthorizedError();
  }

  await assertAuthenticatedApiRateLimit(session.user.id);

  return session as AuthSession;
}

export async function requirePermission(
  permission: PermissionSlug,
): Promise<AuthSession> {
  const session = await requireAuth();

  if (!session.user.permissions.includes(permission)) {
    throw new ForbiddenError(`Missing permission: ${permission}`);
  }

  return session;
}

export async function requireAnyPermission(
  permissions: PermissionSlug[],
): Promise<AuthSession> {
  const session = await requireAuth();
  const has = permissions.some((p) => session.user.permissions.includes(p));

  if (!has) {
    throw new ForbiddenError("Insufficient permissions");
  }

  return session;
}

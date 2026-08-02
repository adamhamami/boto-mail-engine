import type { NextAuthConfig } from "next-auth";
import type { PermissionSlug } from "@/lib/auth/permissions";

const isProd = process.env.NODE_ENV === "production";

/**
 * Auth.js edge-compatible config.
 * Secrets : AUTH_SECRET (+ AUTH_SECRET_PREVIOUS pour rotation JWT).
 * Cookies : HttpOnly / SameSite=Lax / Secure en production (via useSecureCookies).
 */
function resolveAuthSecrets(): string | string[] | undefined {
  const current = process.env.AUTH_SECRET?.trim();
  const previous = process.env.AUTH_SECRET_PREVIOUS?.trim();
  if (current && previous) {
    return [current, previous];
  }
  return current;
}

const sessionMaxAge = Number.parseInt(
  process.env.AUTH_SESSION_MAX_AGE_SECONDS ?? "",
  10,
);

export const authConfig = {
  secret: resolveAuthSecrets(),
  trustHost: true,
  useSecureCookies: isProd,
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge:
      Number.isFinite(sessionMaxAge) && sessionMaxAge > 0
        ? sessionMaxAge
        : 30 * 24 * 60 * 60,
  },
  cookies: {
    sessionToken: {
      options: {
        httpOnly: true,
        sameSite: "lax" as const,
        path: "/",
        secure: isProd,
      },
    },
    csrfToken: {
      options: {
        httpOnly: true,
        sameSite: "lax" as const,
        path: "/",
        secure: isProd,
      },
    },
    callbackUrl: {
      options: {
        httpOnly: true,
        sameSite: "lax" as const,
        path: "/",
        secure: isProd,
      },
    },
  },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        const authUser = user as {
          id: string;
          roles?: string[];
          permissions?: PermissionSlug[];
        };
        token.id = authUser.id;
        token.roles = authUser.roles ?? [];
        token.permissions = authUser.permissions ?? [];
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.roles = (token.roles as string[] | undefined) ?? [];
        session.user.permissions =
          (token.permissions as PermissionSlug[] | undefined) ?? [];
      }

      return session;
    },
  },
} satisfies NextAuthConfig;

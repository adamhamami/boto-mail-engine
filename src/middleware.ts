import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth/auth.config";
import {
  applySecurityHeaders,
  isMutatingApiCsrfAllowed,
} from "@/lib/security/security-headers";

const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth",
  "/api/health",
  "/api/webhooks",
  "/unsubscribe",
  "/api/unsubscribe",
];

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/contacts",
  "/organizations",
  "/imports",
  "/segments",
  "/templates",
  "/sequences",
  "/campaigns",
  "/responses",
  "/suppression",
  "/sales-tasks",
  "/audit",
  "/compliance",
  "/settings",
  "/users",
  "/ops",
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

function isProtectedPath(pathname: string): boolean {
  if (PROTECTED_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) {
    return true;
  }
  if (pathname.startsWith("/api/") && !isPublicPath(pathname)) {
    return true;
  }
  return false;
}

function newId(): string {
  return crypto.randomUUID();
}

/**
 * Propage / génère correlationId + requestId + traceparent (Edge-safe).
 * Les handlers Node les lisent via withRequestContext.
 */
function withObsHeaders(
  request: { headers: Headers },
  response: NextResponse,
): NextResponse {
  const correlationId =
    request.headers.get("x-correlation-id")?.trim() || newId();
  const requestId = request.headers.get("x-request-id")?.trim() || newId();

  let traceparent = request.headers.get("traceparent")?.trim() || "";
  if (!traceparent) {
    // Trace ID 32 hex + span 16 hex — génération Edge via Web Crypto.
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    traceparent = `00-${hex.slice(0, 32)}-${hex.slice(32, 48)}-01`;
  }

  response.headers.set("x-correlation-id", correlationId);
  response.headers.set("x-request-id", requestId);
  response.headers.set("traceparent", traceparent);
  return applySecurityHeaders(response);
}

function nextWithObs(request: {
  headers: Headers;
}): NextResponse {
  const correlationId =
    request.headers.get("x-correlation-id")?.trim() || newId();
  const requestId = request.headers.get("x-request-id")?.trim() || newId();

  let traceparent = request.headers.get("traceparent")?.trim() || "";
  if (!traceparent) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    traceparent = `00-${hex.slice(0, 32)}-${hex.slice(32, 48)}-01`;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-correlation-id", correlationId);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("traceparent", traceparent);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  return withObsHeaders(
    { headers: requestHeaders },
    response,
  );
}

const { auth } = NextAuth(authConfig);

export default auth((request) => {
  const { pathname } = request.nextUrl;
  const isLoggedIn = Boolean(request.auth);

  if (
    pathname.startsWith("/api/ops/metrics") &&
    (request.headers.get("authorization") ?? "").startsWith("Bearer ")
  ) {
    // Scrape Prometheus : auth Bearer validée dans le handler (pas de cookie).
    return nextWithObs(request);
  }

  if (pathname === "/login" && isLoggedIn) {
    return withObsHeaders(
      request,
      NextResponse.redirect(new URL("/dashboard", request.url)),
    );
  }

  if (isProtectedPath(pathname) && !isLoggedIn) {
    if (pathname.startsWith("/api/")) {
      return withObsHeaders(
        request,
        NextResponse.json(
          {
            success: false,
            error: { code: "UNAUTHORIZED", message: "Unauthorized" },
          },
          { status: 401 },
        ),
      );
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return withObsHeaders(request, NextResponse.redirect(loginUrl));
  }

  if (
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    pathname.startsWith("/api/") &&
    !isPublicPath(pathname)
  ) {
    const csrf = isMutatingApiCsrfAllowed(request);
    if (!csrf.allowed) {
      return withObsHeaders(
        request,
        NextResponse.json(
          {
            success: false,
            error: {
              code: "CSRF",
              message: "Invalid or missing origin",
              details: csrf.reason,
            },
          },
          { status: 403 },
        ),
      );
    }
  }

  return nextWithObs(request);
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

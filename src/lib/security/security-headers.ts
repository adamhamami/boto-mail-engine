import { NextResponse } from "next/server";

/**
 * Headers de sécurité applicatifs (équivalent Helmet ciblé Next.js).
 * Appliqués sur TOUTES les réponses middleware (redirect, 401, CSRF, next).
 */

export function buildContentSecurityPolicy(isProduction = false): string {
  // Next.js App Router + Auth.js : scripts/styles self ; images data/blob pour UI.
  // Dev : 'unsafe-eval' requis par React Refresh / stack reconstruit.
  // Prod : pas de 'unsafe-eval'.
  const scriptSrc = isProduction
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    scriptSrc,
    "connect-src 'self'",
    "worker-src 'self' blob:",
  ];
  if (isProduction) {
    directives.push("upgrade-insecure-requests");
  }
  return directives.join("; ");
}

export function applySecurityHeaders(
  response: NextResponse,
  options?: {
    cspEnabled?: boolean;
    cspReportOnly?: boolean;
    isProduction?: boolean;
  },
): NextResponse {
  const isProduction =
    options?.isProduction ?? process.env.NODE_ENV === "production";
  const cspEnabled =
    options?.cspEnabled ??
    parseEnvBool(process.env.CSP_ENABLED, true);
  const cspReportOnly =
    options?.cspReportOnly ??
    parseEnvBool(process.env.CSP_REPORT_ONLY, false);

  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set("X-DNS-Prefetch-Control", "off");

  if (cspEnabled) {
    const csp = buildContentSecurityPolicy(isProduction);
    response.headers.set(
      cspReportOnly
        ? "Content-Security-Policy-Report-Only"
        : "Content-Security-Policy",
      csp,
    );
  }

  if (isProduction) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }

  return response;
}

function parseEnvBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  const n = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(n)) return true;
  if (["false", "0", "no"].includes(n)) return false;
  return fallback;
}

/**
 * CSRF pour API authentifiées mutantes.
 * - Origin présent → doit matcher Host
 * - Sinon Sec-Fetch-Site same-origin | same-site | none
 * - Sinon rejet (fail-closed)
 */
export function isMutatingApiCsrfAllowed(request: {
  headers: Headers;
}): { allowed: boolean; reason?: string } {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();

  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return { allowed: false, reason: "origin_mismatch" };
      }
      return { allowed: true };
    } catch {
      return { allowed: false, reason: "origin_invalid" };
    }
  }

  if (
    fetchSite === "same-origin" ||
    fetchSite === "same-site" ||
    fetchSite === "none"
  ) {
    return { allowed: true };
  }

  return { allowed: false, reason: "origin_required" };
}

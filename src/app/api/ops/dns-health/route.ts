import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { consumeRateLimit } from "@/lib/api/rate-limit";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AppError, ValidationError } from "@/lib/errors";
import { getDnsHealth } from "@/lib/dns/dns-health";
import { isValidDnsDomain } from "@/lib/dns/checks";
import { auditService } from "@/modules/audit/services/audit.service";
import {
  resolveCorrelationId,
  withRequestContext,
} from "@/lib/observability/http";

/** Lookups DNS Node — runtime Node requis. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dnsHealthBodySchema = z
  .object({
    domain: z.string().trim().min(1).max(253).optional(),
  })
  .strict();

function optionalDomain(raw: string | null | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const domain = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!isValidDnsDomain(domain)) {
    throw new ValidationError(
      `Domaine invalide « ${raw} ». Attendu : exemple.com (pas d'URL ni d'IP).`,
    );
  }
  return domain;
}

/**
 * Santé DNS (SPF / DKIM / DMARC / MX / Reverse DNS) — RBAC ops:read.
 * Query optionnelle : ?domain=exemple.com
 */
export async function GET(req: NextRequest) {
  try {
    return await withRequestContext(req, async () => {
      await requirePermission(PERMISSIONS.OPS_READ);
      const domain = optionalDomain(req.nextUrl.searchParams.get("domain"));
      const report = await getDnsHealth({ domain });
      return apiSuccess(report);
    });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Test forcé — RBAC settings:write, limité à 10/minute.
 * Body JSON optionnel : { "domain": "exemple.com" }
 */
export async function POST(req: NextRequest) {
  const correlationId = resolveCorrelationId(req);
  try {
    return await withRequestContext(req, async () => {
      const session = await requirePermission(PERMISSIONS.SETTINGS_WRITE);

      const rate = await consumeRateLimit("dns-health-test", session.user.id);
      if (!rate.allowed) {
        throw new AppError(
          "Trop de tests DNS consécutifs. Réessayez dans une minute.",
          429,
          "RATE_LIMITED",
        );
      }

      let domain: string | undefined;
      try {
        const json: unknown = await req.json();
        const body = dnsHealthBodySchema.parse(json);
        domain = optionalDomain(body.domain);
      } catch (error) {
        if (error instanceof ValidationError) throw error;
        if (error instanceof z.ZodError) {
          throw new ValidationError("Corps JSON invalide", error.flatten());
        }
        // Corps absent ou non-JSON : domaine par défaut (SMTP_FROM_EMAIL).
      }

      const report = await getDnsHealth({ force: true, domain });

      await auditService.log({
        action: "VALIDATE",
        module: "ops",
        entityType: "DnsDomain",
        entityId: report.domain,
        userId: session.user.id,
        newValues: {
          status: report.status,
          checks: report.checks.map((c) => ({
            id: c.id,
            status: c.status,
          })),
          correlationId,
        },
      });

      return apiSuccess(report);
    });
  } catch (error) {
    return apiError(error);
  }
}

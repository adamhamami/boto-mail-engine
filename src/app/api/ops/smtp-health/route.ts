import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/auth-guard";
import { consumeRateLimit } from "@/lib/api/rate-limit";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AppError } from "@/lib/errors";
import { getSmtpHealth } from "@/lib/mail/smtp-health";
import { auditService } from "@/modules/audit/services/audit.service";
import {
  resolveCorrelationId,
  withRequestContext,
} from "@/lib/observability/http";

/** Sockets sortants + certificat : runtime Node requis (pas Edge). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Santé du connecteur SMTP — RBAC ops:read.
 *
 * Sert le dernier rapport tant qu'il est frais (SMTP_HEALTH_CACHE_TTL_MS),
 * sinon relance un test. Aucun hôte, identifiant ou secret en clair.
 */
export async function GET(req: NextRequest) {
  try {
    return await withRequestContext(req, async () => {
      await requirePermission(PERMISSIONS.OPS_READ);
      const report = await getSmtpHealth();
      return apiSuccess(report);
    });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Test forcé — RBAC settings:write, limité à 5 exécutions par minute.
 * Ouvre une connexion SMTP (poignée de main + AUTH) sans envoyer d'email.
 */
export async function POST(req: NextRequest) {
  const correlationId = resolveCorrelationId(req);
  try {
    return await withRequestContext(req, async () => {
      const session = await requirePermission(PERMISSIONS.SETTINGS_WRITE);

      const rate = await consumeRateLimit("smtp-health-test", session.user.id);
      if (!rate.allowed) {
        throw new AppError(
          "Trop de tests SMTP consécutifs. Réessayez dans une minute.",
          429,
          "RATE_LIMITED",
        );
      }

      const report = await getSmtpHealth({ force: true });

      await auditService.log({
        action: "VALIDATE",
        module: "ops",
        entityType: "SmtpConnector",
        entityId: report.connector.id,
        userId: session.user.id,
        newValues: {
          status: report.status,
          reachable: report.connection.reachable,
          authentication: report.authentication.status,
          tlsProtocol: report.connection.tls.protocol,
          correlationId,
        },
      });

      return apiSuccess(report);
    });
  } catch (error) {
    return apiError(error);
  }
}

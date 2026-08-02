import { logger as baseLogger } from "@/lib/logger";
import { getRequestContext } from "./context";

/**
 * Logger contextualisé — jamais de secrets / PII excessives.
 */
export function logInfo(
  fields: Record<string, unknown>,
  message: string,
): void {
  baseLogger.info({ ...safeFields(fields), ...contextFields() }, message);
}

export function logWarn(
  fields: Record<string, unknown>,
  message: string,
): void {
  baseLogger.warn({ ...safeFields(fields), ...contextFields() }, message);
}

export function logError(
  fields: Record<string, unknown>,
  message: string,
): void {
  baseLogger.error({ ...safeFields(fields), ...contextFields() }, message);
}

function contextFields(): Record<string, unknown> {
  const ctx = getRequestContext();
  if (!ctx) return {};
  return {
    correlationId: ctx.correlationId,
    requestId: ctx.requestId,
    ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
    ...(ctx.spanId ? { spanId: ctx.spanId } : {}),
    ...(ctx.campaignId ? { campaignId: ctx.campaignId } : {}),
    ...(ctx.recipientId ? { recipientId: ctx.recipientId } : {}),
    ...(ctx.jobId ? { jobId: ctx.jobId } : {}),
    ...(ctx.providerEventId ? { providerEventId: ctx.providerEventId } : {}),
    ...(ctx.userId ? { userId: ctx.userId } : {}),
  };
}

const BLOCKED_KEYS = new Set([
  "password",
  "smtp_password",
  "smtppassword",
  "auth_secret",
  "authsecret",
  "authsecretprevious",
  "webhook_secret",
  "webhooksecret",
  "brevoapikey",
  "sessecretaccesskey",
  "sesaccesskeyid",
  "apikey",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "cookie",
  "html",
  "bodyhtml",
  "rawpayload",
  "payload",
]);

export function safeFields(
  fields: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (depth > 4) {
    return { truncated: true };
  }

  for (const [key, value] of Object.entries(fields)) {
    const normalized = key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    if (BLOCKED_KEYS.has(normalized)) {
      out[key] = "[Redacted]";
      continue;
    }
    if (typeof value === "string" && value.length > 500) {
      out[key] = `${value.slice(0, 120)}…[truncated]`;
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (value instanceof Error) {
        out[key] = {
          name: value.name,
          message: value.message.slice(0, 300),
        };
        continue;
      }
      out[key] = safeFields(value as Record<string, unknown>, depth + 1);
      continue;
    }
    out[key] = value;
  }
  return out;
}

import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/config/env";

export class WebhookAuthError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 401) {
    super(message);
    this.name = "WebhookAuthError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * Vérifie HMAC-SHA256(timestamp + "." + rawBody) en comparaison constante,
 * avec fenêtre anti-replay.
 */
export function verifyWebhookSignature(params: {
  rawBody: string;
  signatureHeader: string | null;
  timestampHeader: string | null;
  secret?: string;
  nowMs?: number;
  maxAgeSeconds?: number;
}): { timestampMs: number } {
  const env = getEnv();
  const secret = params.secret ?? env.WEBHOOK_SECRET;
  const maxAge = params.maxAgeSeconds ?? env.WEBHOOK_MAX_AGE_SECONDS;
  const now = params.nowMs ?? Date.now();

  if (!params.signatureHeader?.trim()) {
    throw new WebhookAuthError("MISSING_SIGNATURE", "Webhook signature required");
  }
  if (!params.timestampHeader?.trim()) {
    throw new WebhookAuthError("MISSING_TIMESTAMP", "Webhook timestamp required");
  }

  const timestampMs = Number(params.timestampHeader);
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    throw new WebhookAuthError("INVALID_TIMESTAMP", "Invalid webhook timestamp");
  }

  const ageSeconds = Math.abs(now - timestampMs) / 1000;
  if (ageSeconds > maxAge) {
    throw new WebhookAuthError(
      "TIMESTAMP_EXPIRED",
      "Webhook timestamp outside allowed window",
      401,
    );
  }

  if (!secret || secret.length < 16) {
    throw new WebhookAuthError(
      "SECRET_NOT_CONFIGURED",
      "Webhook secret not configured",
      503,
    );
  }

  const expected = createHmac("sha256", secret)
    .update(`${params.timestampHeader}.${params.rawBody}`)
    .digest("hex");

  const provided = normalizeSignature(params.signatureHeader);
  if (!safeEqualHex(provided, expected)) {
    throw new WebhookAuthError("INVALID_SIGNATURE", "Invalid webhook signature");
  }

  return { timestampMs };
}

function normalizeSignature(header: string): string {
  const trimmed = header.trim();
  if (trimmed.startsWith("sha256=")) {
    return trimmed.slice("sha256=".length).toLowerCase();
  }
  return trimmed.toLowerCase();
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(b, "hex");
    if (bufA.length === 0 || bufA.length !== bufB.length) {
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/** Helper tests / fournisseurs — signe un corps brut. */
export function signWebhookPayload(
  rawBody: string,
  timestampMs: number,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestampMs}.${rawBody}`)
    .digest("hex");
}

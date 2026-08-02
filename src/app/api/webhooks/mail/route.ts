import { type NextRequest } from "next/server";
import { ZodError } from "zod";
import { consumeRateLimit } from "@/lib/api/rate-limit";
import { getEnv } from "@/lib/config/env";
import { ingestNormalizedEvent } from "@/lib/inbound/ingest";
import {
  parseInboundWebhookPayload,
  toNormalizedMailEvent,
} from "@/lib/inbound/normalize";
import {
  verifyWebhookSignature,
  WebhookAuthError,
} from "@/lib/inbound/signature";
import { logger } from "@/lib/logger";
import { MAIL_EVENT_TYPES } from "@/lib/inbound/types";

export const runtime = "nodejs";

/**
 * Webhook public — auth → validate → store idempotent → enqueue → réponse rapide.
 * Aucune logique métier lourde ici.
 */
export async function POST(req: NextRequest) {
  const env = getEnv();
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  const rate = await consumeRateLimit("webhook-mail", ip);
  if (!rate.allowed) {
    return Response.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rate.retryAfterMs ?? 60_000) / 1000)),
        },
      },
    );
  }

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > env.WEBHOOK_MAX_PAYLOAD_BYTES) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }

  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > env.WEBHOOK_MAX_PAYLOAD_BYTES) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }

  try {
    verifyWebhookSignature({
      rawBody,
      signatureHeader: req.headers.get("x-webhook-signature"),
      timestampHeader: req.headers.get("x-webhook-timestamp"),
    });
  } catch (error) {
    if (error instanceof WebhookAuthError) {
      logger.warn(
        { code: error.code, ip },
        "Webhook authentication failed",
      );
      return Response.json(
        { error: error.code.toLowerCase() },
        { status: error.httpStatus },
      );
    }
    throw error;
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const payload = parseInboundWebhookPayload(json);

    if (!MAIL_EVENT_TYPES.includes(payload.type)) {
      return Response.json({ error: "unknown_event_type" }, { status: 400 });
    }

    const provider =
      req.headers.get("x-webhook-provider")?.trim() || "generic";

    const normalized = toNormalizedMailEvent(payload, provider);
    const result = await ingestNormalizedEvent(normalized);

    return Response.json(
      {
        received: true,
        duplicate: result.duplicate,
        id: result.webhookEventId,
      },
      { status: result.duplicate ? 200 : 202 },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        { error: "validation_failed", details: error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    logger.error(
      { err: error instanceof Error ? error.message : "unknown", ip },
      "Webhook ingest failed",
    );
    return Response.json({ error: "ingest_failed" }, { status: 500 });
  }
}

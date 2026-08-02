import { type NextRequest, NextResponse } from "next/server";
import {
  getCorrelationId,
  getRequestContext,
  getRequestId,
  runWithContext,
  withCorrelationHeaders,
  withRequestIdHeaders,
} from "@/lib/observability/context";
import {
  formatTraceparent,
  resolveTraceContext,
} from "@/lib/observability/tracing";

export function resolveCorrelationId(req: NextRequest): string {
  return withCorrelationHeaders(req.headers);
}

export function resolveRequestId(req: NextRequest): string {
  return withRequestIdHeaders(req.headers);
}

export async function withRequestContext<T>(
  req: NextRequest,
  fn: () => Promise<T>,
  extras?: { userId?: string; campaignId?: string },
): Promise<T> {
  const correlationId = resolveCorrelationId(req);
  const requestId = resolveRequestId(req);
  const trace = resolveTraceContext(req.headers.get("traceparent"));

  return runWithContext(
    {
      correlationId,
      requestId,
      traceId: trace.traceId,
      spanId: trace.spanId,
      parentSpanId: trace.parentSpanId,
      userId: extras?.userId,
      campaignId: extras?.campaignId,
    },
    fn,
  );
}

/** Attache correlation / request / traceparent sur une réponse. */
export function withObservabilityResponse(
  response: NextResponse,
  ids?: {
    correlationId?: string;
    requestId?: string;
    traceparent?: string;
  },
): NextResponse {
  const correlationId = ids?.correlationId ?? getCorrelationId();
  const requestId = ids?.requestId ?? getRequestId();

  if (correlationId && correlationId !== "no-correlation") {
    response.headers.set("x-correlation-id", correlationId);
  }
  if (requestId && requestId !== "no-request") {
    response.headers.set("x-request-id", requestId);
  }
  if (ids?.traceparent) {
    response.headers.set("traceparent", ids.traceparent);
  } else {
    const ctx = getRequestContext();
    if (ctx?.traceId && ctx.spanId) {
      response.headers.set(
        "traceparent",
        formatTraceparent(ctx.traceId, ctx.spanId, true),
      );
    }
  }
  return response;
}

/** @deprecated Prefer withObservabilityResponse — conservé pour compat. */
export function withCorrelationResponse(
  response: NextResponse,
  correlationId?: string,
): NextResponse {
  return withObservabilityResponse(response, { correlationId });
}

/**
 * Extrait IP / User-Agent pour l'audit enrichi (jamais stocké en log libre).
 */
export function extractClientMeta(req: {
  headers: Headers;
}): { ipAddress?: string; userAgent?: string } {
  const forwarded = req.headers.get("x-forwarded-for");
  const ipAddress =
    forwarded?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    undefined;
  const userAgent = req.headers.get("user-agent")?.slice(0, 500) || undefined;
  return { ipAddress, userAgent };
}

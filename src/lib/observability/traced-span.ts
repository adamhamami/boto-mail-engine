import { logger } from "@/lib/logger";
import {
  childSpan,
  formatTraceparent,
  generateSpanId,
  generateTraceId,
  type TraceContext,
} from "@/lib/observability/tracing";
import {
  getRequestContext,
  runWithContext,
} from "@/lib/observability/context";

/**
 * Span léger journalisé (Étape 5) — compatible collecteurs via logs JSON
 * (traceId / spanId). Pas de SDK OpenTelemetry.
 */
export async function withTracedSpan<T>(
  name: string,
  fn: () => Promise<T>,
  attrs?: Record<string, string | number | boolean | null | undefined>,
): Promise<T> {
  const ctx = getRequestContext();
  const parent: TraceContext =
    ctx?.traceId && ctx.spanId
      ? {
          traceId: ctx.traceId,
          spanId: ctx.spanId,
          parentSpanId: ctx.parentSpanId,
          sampled: true,
          traceparent: formatTraceparent(ctx.traceId, ctx.spanId, true),
        }
      : {
          traceId: generateTraceId(),
          spanId: generateSpanId(),
          sampled: true,
          traceparent: "",
        };
  if (!parent.traceparent) {
    parent.traceparent = formatTraceparent(parent.traceId, parent.spanId, true);
  }

  const span = childSpan(parent);
  const t0 = Date.now();

  return runWithContext(
    {
      ...(ctx ?? {
        correlationId: "no-correlation",
        requestId: "no-request",
      }),
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: parent.spanId,
    },
    async () => {
      logger.debug(
        {
          span: name,
          phase: "start",
          ...sanitizeAttrs(attrs),
        },
        `trace.start:${name}`,
      );
      try {
        const result = await fn();
        logger.debug(
          {
            span: name,
            phase: "end",
            durationMs: Date.now() - t0,
            ok: true,
          },
          `trace.end:${name}`,
        );
        return result;
      } catch (error) {
        logger.warn(
          {
            span: name,
            phase: "error",
            durationMs: Date.now() - t0,
            ok: false,
            err:
              error instanceof Error
                ? { name: error.name, message: error.message }
                : { message: "span failed" },
          },
          `trace.error:${name}`,
        );
        throw error;
      }
    },
  );
}

function sanitizeAttrs(
  attrs?: Record<string, string | number | boolean | null | undefined>,
): Record<string, string | number | boolean> {
  if (!attrs) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (/password|secret|token|authorization/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

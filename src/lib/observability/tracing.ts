import { randomBytes } from "node:crypto";

/**
 * Tracing léger W3C Trace Context — sans SDK OpenTelemetry.
 * Compatible avec les collecteurs qui lisent `traceparent` / les champs
 * `traceId` / `spanId` dans les logs JSON.
 *
 * Format : version-traceId-parentId-flags
 * Ex. 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 */

export interface TraceContext {
  traceId: string;
  spanId: string;
  /** Parent span (si présent dans l'en-tête entrant). */
  parentSpanId?: string;
  sampled: boolean;
  /** En-tête W3C à propager. */
  traceparent: string;
}

const HEX_16 = /^[0-9a-f]{16}$/i;
const HEX_32 = /^[0-9a-f]{32}$/i;

function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export function generateSpanId(): string {
  return hex(8);
}

export function generateTraceId(): string {
  return hex(16);
}

export function formatTraceparent(
  traceId: string,
  spanId: string,
  sampled = true,
): string {
  return `00-${traceId}-${spanId}-${sampled ? "01" : "00"}`;
}

/**
 * Parse `traceparent` ; génère un nouveau contexte si absent / invalide.
 * Si valide : conserve traceId, crée un nouveau spanId (enfant).
 */
export function resolveTraceContext(header: string | null | undefined): TraceContext {
  const raw = header?.trim();
  if (raw) {
    const parts = raw.split("-");
    if (parts.length === 4) {
      const [version, traceId, parentSpanId, flags] = parts;
      if (
        version === "00" &&
        HEX_32.test(traceId) &&
        HEX_16.test(parentSpanId) &&
        traceId !== "0".repeat(32) &&
        parentSpanId !== "0".repeat(16)
      ) {
        const sampled = (parseInt(flags, 16) & 0x1) === 1;
        const spanId = generateSpanId();
        return {
          traceId: traceId.toLowerCase(),
          spanId,
          parentSpanId: parentSpanId.toLowerCase(),
          sampled,
          traceparent: formatTraceparent(traceId.toLowerCase(), spanId, sampled),
        };
      }
    }
  }

  const traceId = generateTraceId();
  const spanId = generateSpanId();
  return {
    traceId,
    spanId,
    sampled: true,
    traceparent: formatTraceparent(traceId, spanId, true),
  };
}

/** Démarre un span enfant pour un worker / sous-opération. */
export function childSpan(parent: TraceContext): TraceContext {
  const spanId = generateSpanId();
  return {
    traceId: parent.traceId,
    spanId,
    parentSpanId: parent.spanId,
    sampled: parent.sampled,
    traceparent: formatTraceparent(parent.traceId, spanId, parent.sampled),
  };
}

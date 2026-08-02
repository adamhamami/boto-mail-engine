import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * Contexte requête / job (AsyncLocalStorage).
 *
 * - correlationId : bout-en-bout (client → API → worker)
 * - requestId     : hop HTTP courant
 * - traceId/spanId: tracing W3C léger
 */

export interface RequestContext {
  correlationId: string;
  requestId: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  campaignId?: string;
  recipientId?: string;
  jobId?: string;
  providerEventId?: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getCorrelationId(): string {
  return storage.getStore()?.correlationId ?? "no-correlation";
}

export function getRequestId(): string {
  return storage.getStore()?.requestId ?? "no-request";
}

export function getTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}

export function runWithContext<T>(
  ctx: Partial<RequestContext> & { correlationId?: string },
  fn: () => T,
): T {
  const current = storage.getStore();
  const next: RequestContext = {
    correlationId: ctx.correlationId ?? current?.correlationId ?? randomUUID(),
    requestId: ctx.requestId ?? current?.requestId ?? randomUUID(),
    traceId: ctx.traceId ?? current?.traceId,
    spanId: ctx.spanId ?? current?.spanId,
    parentSpanId: ctx.parentSpanId ?? current?.parentSpanId,
    campaignId: ctx.campaignId ?? current?.campaignId,
    recipientId: ctx.recipientId ?? current?.recipientId,
    jobId: ctx.jobId ?? current?.jobId,
    providerEventId: ctx.providerEventId ?? current?.providerEventId,
    userId: ctx.userId ?? current?.userId,
  };
  return storage.run(next, fn);
}

/** Champs stables à injecter dans chaque log structuré. */
export function observabilityLogFields(): Record<string, string> {
  const ctx = storage.getStore();
  if (!ctx) return {};
  const fields: Record<string, string> = {
    correlationId: ctx.correlationId,
    requestId: ctx.requestId,
  };
  if (ctx.traceId) fields.traceId = ctx.traceId;
  if (ctx.spanId) fields.spanId = ctx.spanId;
  if (ctx.parentSpanId) fields.parentSpanId = ctx.parentSpanId;
  if (ctx.campaignId) fields.campaignId = ctx.campaignId;
  if (ctx.recipientId) fields.recipientId = ctx.recipientId;
  if (ctx.jobId) fields.jobId = ctx.jobId;
  if (ctx.providerEventId) fields.providerEventId = ctx.providerEventId;
  if (ctx.userId) fields.userId = ctx.userId;
  return fields;
}

/**
 * Snapshot à embarquer dans un job BullMQ pour propager la corrélation.
 */
export function observabilityJobFields(): {
  correlationId: string;
  requestId: string;
  traceId?: string;
  spanId?: string;
} {
  const ctx = storage.getStore();
  return {
    correlationId: ctx?.correlationId ?? randomUUID(),
    requestId: ctx?.requestId ?? randomUUID(),
    ...(ctx?.traceId ? { traceId: ctx.traceId } : {}),
    ...(ctx?.spanId ? { spanId: ctx.spanId } : {}),
  };
}

export function withCorrelationHeaders(
  headers: Headers,
  correlationId?: string,
): string {
  return (
    correlationId ??
    headers.get("x-correlation-id")?.trim() ??
    randomUUID()
  );
}

export function withRequestIdHeaders(
  headers: Headers,
  requestId?: string,
): string {
  return (
    requestId ??
    headers.get("x-request-id")?.trim() ??
    randomUUID()
  );
}

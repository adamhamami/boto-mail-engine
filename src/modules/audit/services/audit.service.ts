import { prisma } from "@/lib/db/prisma";
import type { AuditAction, Prisma } from "@/generated/prisma/client";
import {
  cursorWhereDesc,
  encodeCursor,
  getSkipTake,
} from "@/lib/api/pagination";
import { getRequestContext } from "@/lib/observability/context";

export interface AuditEntry {
  action: AuditAction;
  module: string;
  entityType: string;
  entityId?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  oldValues?: unknown;
  newValues?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Enrichit metadata avec correlationId / requestId / traceId du contexte ALS.
 * Les champs déjà fournis par l'appelant priment.
 */
export function enrichAuditMetadata(
  metadata: Record<string, unknown> | undefined,
  ctx = getRequestContext(),
): Record<string, unknown> {
  const base = { ...(metadata ?? {}) };
  if (!ctx) return base;

  if (base.correlationId === undefined) base.correlationId = ctx.correlationId;
  if (base.requestId === undefined) base.requestId = ctx.requestId;
  if (ctx.traceId && base.traceId === undefined) base.traceId = ctx.traceId;
  if (ctx.spanId && base.spanId === undefined) base.spanId = ctx.spanId;
  if (ctx.campaignId && base.campaignId === undefined) {
    base.campaignId = ctx.campaignId;
  }
  return base;
}

export class AuditService {
  async log(entry: AuditEntry): Promise<void> {
    const metadata = enrichAuditMetadata(entry.metadata);

    await prisma.auditLog.create({
      data: {
        action: entry.action,
        module: entry.module,
        entityType: entry.entityType,
        entityId: entry.entityId,
        userId: entry.userId,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        oldValues: entry.oldValues as object | undefined,
        newValues: entry.newValues as object | undefined,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  async findMany(params: {
    page: number;
    limit: number;
    module?: string;
    action?: AuditAction;
    userId?: string;
    /** Keyset additif — si présent, ignore skip offset */
    cursor?: string;
  }) {
    const baseWhere = {
      ...(params.module ? { module: params.module } : {}),
      ...(params.action ? { action: params.action } : {}),
      ...(params.userId ? { userId: params.userId } : {}),
    };
    const cursorClause = cursorWhereDesc(params.cursor);
    const where = cursorClause
      ? { AND: [baseWhere, cursorClause] }
      : baseWhere;

    const listSelect = {
      id: true,
      action: true,
      module: true,
      entityType: true,
      entityId: true,
      userId: true,
      ipAddress: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true } },
    } as const;

    // Cursor : take+1 pour hasNext ; page : offset + count total
    if (params.cursor) {
      const rows = await prisma.auditLog.findMany({
        where,
        select: listSelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: params.limit + 1,
      });
      const hasNext = rows.length > params.limit;
      const items = hasNext ? rows.slice(0, params.limit) : rows;
      const last = items[items.length - 1];
      const nextCursor =
        hasNext && last ? encodeCursor(last.createdAt, last.id) : null;
      return { items, total: null as number | null, nextCursor, hasNext };
    }

    const { skip, take } = getSkipTake(params.page, params.limit);
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        // Liste : pas de oldValues/newValues/metadata JSON (Phase 11)
        select: listSelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { items, total, nextCursor: null as string | null, hasNext: null as boolean | null };
  }
}

export const auditService = new AuditService();

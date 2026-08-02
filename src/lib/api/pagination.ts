import { z } from "zod";

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  /** Cursor opaque (createdAt|id) — additif, rétrocompatible page/limit */
  cursor: z.string().optional(),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export function getPaginationMeta(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
    hasNext: page * limit < total,
    hasPrev: page > 1,
  };
}

export function getSkipTake(page: number, limit: number) {
  /** Offset Prisma : skip = (page - 1) * limit — centralisé pour éviter les divergences listes. */
  return { skip: (page - 1) * limit, take: limit };
}

/** Encode cursor keyset (createdAt + id). */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(
    `${createdAt.toISOString()}|${id}`,
    "utf8",
  ).toString("base64url");
}

export function decodeCursor(
  cursor: string,
): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const [iso, id] = raw.split("|");
    if (!iso || !id) return null;
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * Clause Prisma keyset pour orderBy createdAt desc, id desc.
 * Utiliser avec `take: limit + 1` pour détecter hasNext.
 */
export function cursorWhereDesc(cursor?: string):
  | {
      OR: Array<
        | { createdAt: { lt: Date } }
        | { createdAt: Date; id: { lt: string } }
      >;
    }
  | undefined {
  if (!cursor) return undefined;
  const decoded = decodeCursor(cursor);
  if (!decoded) return undefined;
  return {
    OR: [
      { createdAt: { lt: decoded.createdAt } },
      { createdAt: decoded.createdAt, id: { lt: decoded.id } },
    ],
  };
}

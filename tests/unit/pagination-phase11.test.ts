import { describe, it, expect } from "vitest";
import {
  encodeCursor,
  decodeCursor,
  cursorWhereDesc,
  getSkipTake,
  getPaginationMeta,
} from "@/lib/api/pagination";

describe("Phase 11 — pagination cursor", () => {
  it("round-trips cursor", () => {
    const at = new Date("2026-08-01T12:00:00.000Z");
    const cursor = encodeCursor(at, "cuid123");
    const decoded = decodeCursor(cursor);
    expect(decoded?.id).toBe("cuid123");
    expect(decoded?.createdAt.toISOString()).toBe(at.toISOString());
  });

  it("builds keyset where for desc order", () => {
    const at = new Date("2026-08-01T12:00:00.000Z");
    const where = cursorWhereDesc(encodeCursor(at, "abc"));
    expect(where?.OR).toHaveLength(2);
  });

  it("keeps offset helpers", () => {
    expect(getSkipTake(2, 20)).toEqual({ skip: 20, take: 20 });
    expect(getPaginationMeta(1, 20, 45).totalPages).toBe(3);
  });
});

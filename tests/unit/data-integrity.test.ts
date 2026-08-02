import { describe, it, expect } from "vitest";
import {
  buildApprovalContentHash,
  buildSendIdempotencyKey,
  hashContent,
  normalizeEmailAddress,
} from "@/lib/data/integrity";

describe("Phase 2 data integrity utilities", () => {
  it("normalizes email casing and whitespace", () => {
    expect(normalizeEmailAddress("  Jean.Dupont@Ecole.MA ")).toBe(
      "jean.dupont@ecole.ma",
    );
  });

  it("builds stable idempotency keys", () => {
    const a = buildSendIdempotencyKey({
      campaignId: "camp1",
      contactId: "ct1",
      sequenceStep: 0,
      sequenceVersion: 2,
    });
    const b = buildSendIdempotencyKey({
      campaignId: "camp1",
      contactId: "ct1",
      sequenceStep: 0,
      sequenceVersion: 2,
    });
    expect(a).toBe(b);
    expect(a).toBe("camp1:ct1:0:v2");
  });

  it("changes idempotency key when step or version changes", () => {
    const base = buildSendIdempotencyKey({
      campaignId: "camp1",
      contactId: "ct1",
      sequenceStep: 0,
      sequenceVersion: 1,
    });
    const step = buildSendIdempotencyKey({
      campaignId: "camp1",
      contactId: "ct1",
      sequenceStep: 1,
      sequenceVersion: 1,
    });
    const version = buildSendIdempotencyKey({
      campaignId: "camp1",
      contactId: "ct1",
      sequenceStep: 0,
      sequenceVersion: 2,
    });
    expect(base).not.toBe(step);
    expect(base).not.toBe(version);
  });

  it("produces stable content hashes for approval snapshots", () => {
    const input = {
      templateId: "t1",
      templateVersion: 1,
      templateSubject: "Hello",
      templateBodyHtml: "<p>Hi</p>",
      sequenceId: null,
      sequenceVersion: null,
      segmentId: "s1",
      segmentVersion: 3,
      segmentFilters: { status: "ELIGIBLE" },
      settings: {},
      fromEmail: "contact@botoschool.ma",
    };
    expect(buildApprovalContentHash(input)).toBe(buildApprovalContentHash(input));
    expect(
      buildApprovalContentHash({ ...input, templateVersion: 2 }),
    ).not.toBe(buildApprovalContentHash(input));
  });

  it("hashContent is deterministic", () => {
    expect(hashContent({ a: 1, b: 2 })).toBe(hashContent({ b: 2, a: 1 }));
  });
});

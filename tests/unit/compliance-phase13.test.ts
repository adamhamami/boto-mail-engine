import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import {
  ContactStatus,
  SuppressionReason,
} from "@/generated/prisma/client";

vi.mock("@/lib/db/prisma", () => {
  const tx = {
    suppressionList: { upsert: vi.fn(async () => ({})) },
    contact: { update: vi.fn(async () => ({})) },
    auditLog: { updateMany: vi.fn(async () => ({ count: 1 })) },
    event: { updateMany: vi.fn(async () => ({ count: 1 })) },
    salesTask: { updateMany: vi.fn(async () => ({ count: 1 })) },
    campaignRecipient: { updateMany: vi.fn(async () => ({ count: 1 })) },
    dataSubjectRequest: { updateMany: vi.fn(async () => ({ count: 0 })) },
  };
  return {
    prisma: {
      contact: {
        findUnique: vi.fn(),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<void>) =>
        fn(tx),
      ),
      __tx: tx,
    },
  };
});

vi.mock("@/lib/inbound/stop-sequence", () => ({
  stopContactSequence: vi.fn(async () => ({
    cancelledJobs: 0,
    stoppedRecipients: 1,
  })),
}));

vi.mock("@/modules/audit/services/audit.service", () => ({
  auditService: { log: vi.fn(async () => undefined) },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

import { prisma } from "@/lib/db/prisma";
import { anonymizeContact } from "@/modules/compliance/services/anonymize.service";
import { getCompliancePolicy } from "@/modules/compliance/services/policy.service";
import { evaluateWorkerSendReadiness } from "@/lib/compliance/send-gates";
import { CampaignStatus } from "@/generated/prisma/client";

describe("Phase 13 — conformité", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes CNDP policy shape", () => {
    const policy = getCompliancePolicy();
    expect(policy.framework).toContain("CNDP");
    expect(policy.framework).toContain("Loi 09-08");
    expect(policy.rights.length).toBeGreaterThan(3);
    expect(policy.retention).toBeDefined();
  });

  it("blocks send for anonymized contacts", () => {
    const result = evaluateWorkerSendReadiness({
      campaignStatus: CampaignStatus.RUNNING,
      isTestMode: false,
      recipientIsStopped: false,
      recipientIsSent: false,
      attemptStatus: "QUEUED",
      emailSuppressed: false,
      contact: {
        id: "c1",
        email: "anon@anonymized.invalid",
        status: ContactStatus.BLOCKED,
        source: null,
        consentBase: "ANONYMIZED",
        deletedAt: new Date(),
        anonymizedAt: new Date(),
        isDuplicate: false,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["CONTACT_ANONYMIZED", "CONTACT_DELETED", "CONTACT_BLOCKED_STATUS"]).toContain(
        result.reason,
      );
    }
  });

  it("anonymizes contact and upserts GDPR suppression", async () => {
    const contactId = "clxxxxxxxxxxxxxxxxxxxxxxxx";
    vi.mocked(prisma.contact.findUnique).mockResolvedValue({
      id: contactId,
      email: "person@school.ma",
      emailNormalized: "person@school.ma",
      anonymizedAt: null,
      legalHold: false,
      deletedAt: null,
      status: ContactStatus.ELIGIBLE,
    } as never);

    const result = await anonymizeContact(
      contactId,
      { confirm: "anonymize", reason: "Demande CNDP effacement" },
      "user1",
    );

    expect(result.contactId).toBe(contactId);
    expect(result.anonymizedAt).toBeTruthy();

    const tx = (prisma as unknown as { __tx: {
      suppressionList: { upsert: ReturnType<typeof vi.fn> };
      contact: { update: ReturnType<typeof vi.fn> };
    } }).__tx;

    expect(tx.suppressionList.upsert).toHaveBeenCalled();
    const upsertArg = tx.suppressionList.upsert.mock.calls[0]![0] as {
      create: { reason: SuppressionReason; emailNormalized: string };
    };
    expect(upsertArg.create.reason).toBe(SuppressionReason.GDPR);
    expect(upsertArg.create.emailNormalized).toBe("person@school.ma");

    const updateArg = tx.contact.update.mock.calls[0]![0] as {
      data: { email: string; anonymizedAt: Date; status: ContactStatus };
    };
    const digest = createHash("sha256")
      .update(contactId)
      .digest("hex")
      .slice(0, 16);
    expect(updateArg.data.email).toBe(`anon-${digest}@anonymized.invalid`);
    expect(updateArg.data.status).toBe(ContactStatus.BLOCKED);
    expect(updateArg.data.anonymizedAt).toBeInstanceOf(Date);
  });

  it("refuses anonymize under legal hold", async () => {
    vi.mocked(prisma.contact.findUnique).mockResolvedValue({
      id: "c1",
      email: "a@b.com",
      emailNormalized: "a@b.com",
      anonymizedAt: null,
      legalHold: true,
      deletedAt: null,
    } as never);

    await expect(
      anonymizeContact(
        "c1",
        { confirm: "anonymize", reason: "test hold" },
        "user1",
      ),
    ).rejects.toThrow(/legal hold/i);
  });
});

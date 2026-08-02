import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { normalizeEmailAddress } from "@/lib/data/integrity";
import { buildSendIdempotencyKey } from "@/lib/data/integrity";
import { salesTaskService } from "@/modules/sales-tasks/services/sales-task.service";
import { CampaignStatus } from "@/generated/prisma/client";

const runDb = process.env.PHASE2_DB_TESTS === "1";

describe.runIf(runDb)("Phase 2 database constraints", () => {
  const suffix = Date.now().toString(36);
  let userId = "";
  let contactA = "";
  let campaignId = "";

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `phase2-${suffix}@botoschool.test`,
        name: "Phase2 Tester",
        status: "ACTIVE",
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.salesTask.deleteMany({ where: { createdById: userId } });
    await prisma.sendAttempt.deleteMany({
      where: { campaignRecipient: { campaignId } },
    });
    await prisma.campaignRecipient.deleteMany({ where: { campaignId } });
    await prisma.campaign.deleteMany({ where: { id: campaignId } });
    await prisma.contact.deleteMany({
      where: { emailNormalized: { endsWith: `@phase2-${suffix}.test` } },
    });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("rejects duplicate active emailNormalized", async () => {
    const email = `Dup@Phase2-${suffix}.test`;
    const normalized = normalizeEmailAddress(email);

    const first = await prisma.contact.create({
      data: {
        email,
        emailNormalized: normalized,
        status: "IMPORTED",
        createdById: userId,
      },
    });
    contactA = first.id;

    await expect(
      prisma.contact.create({
        data: {
          email: email.toLowerCase(),
          emailNormalized: normalized,
          status: "IMPORTED",
          createdById: userId,
        },
      }),
    ).rejects.toThrow();
  });

  it("enforces campaign recipient uniqueness under concurrency", async () => {
    const campaign = await prisma.campaign.create({
      data: {
        name: `Phase2 ${suffix}`,
        status: CampaignStatus.DRAFT,
        isTestMode: true,
        createdById: userId,
      },
    });
    campaignId = campaign.id;

    const contact = await prisma.contact.findFirst({
      where: { id: contactA },
    });
    expect(contact).toBeTruthy();

    const key = buildSendIdempotencyKey({
      campaignId,
      contactId: contactA,
      sequenceStep: 0,
      sequenceVersion: 1,
    });

    const createOnce = () =>
      prisma.$transaction(async (tx) => {
        const recipient = await tx.campaignRecipient.create({
          data: {
            campaignId,
            contactId: contactA,
            sequenceStep: 0,
            sequenceVersion: 1,
          },
        });
        await tx.sendAttempt.create({
          data: {
            campaignRecipientId: recipient.id,
            idempotencyKey: key,
          },
        });
        return recipient.id;
      });

    const results = await Promise.allSettled([createOnce(), createOnce()]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
  });

  it("creates a sales task without storing full email body", async () => {
    const task = await salesTaskService.create(
      {
        contactId: contactA,
        campaignId,
        title: "Relancer après réponse",
        summary: "Demande de démo — contenu minimisé",
      },
      userId,
    );
    expect(task.id).toBeTruthy();
    expect(task.summary).not.toContain("<html");
  });
});

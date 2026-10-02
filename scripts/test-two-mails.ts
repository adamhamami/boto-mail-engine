/**
 * Test E2E — envoi test vers 2 emails allowlist (Mailpit local).
 * Usage: npx tsx scripts/test-two-mails.ts
 */
import "dotenv/config";
import { ContactStatus, SendAttemptStatus } from "../src/generated/prisma/client";
import { resetEnvCache } from "../src/lib/config/env";
import { prisma } from "../src/lib/db/prisma";
import { normalizeEmailAddress } from "../src/lib/data/integrity";
import { campaignService } from "../src/modules/campaigns/services/campaign.service";
import { segmentService } from "../src/modules/segments/services/segment.service";
import { templateService } from "../src/modules/templates/services/template.service";

const TEST_EMAILS = ["botoschool@gmail.com", "botoologia@gmail.com"] as const;
const TAG = "test-2mail";
const MAILPIT = "http://127.0.0.1:8025";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForSends(campaignId: string, expected: number, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sent = await prisma.sendAttempt.count({
      where: {
        campaignRecipient: { campaignId },
        status: SendAttemptStatus.SENT,
      },
    });
    const failed = await prisma.sendAttempt.count({
      where: {
        campaignRecipient: { campaignId },
        status: SendAttemptStatus.FAILED,
      },
    });
    if (sent >= expected) return { sent, failed };
    if (failed > 0 && sent + failed >= expected) return { sent, failed };
    await sleep(2000);
  }
  const sent = await prisma.sendAttempt.count({
    where: {
      campaignRecipient: { campaignId },
      status: SendAttemptStatus.SENT,
    },
  });
  const failed = await prisma.sendAttempt.count({
    where: {
      campaignRecipient: { campaignId },
      status: SendAttemptStatus.FAILED,
    },
  });
  return { sent, failed, timeout: true };
}

async function fetchMailpitMessages() {
  const res = await fetch(`${MAILPIT}/api/v1/messages`);
  if (!res.ok) throw new Error(`Mailpit HTTP ${res.status}`);
  const data = (await res.json()) as {
    messages?: Array<{ To?: Array<{ Address?: string }>; Subject?: string }>;
  };
  return data.messages ?? [];
}

async function main() {
  resetEnvCache();

  console.log("=== Test 2 emails allowlist ===");
  console.log("Destinataires:", TEST_EMAILS.join(", "));
  console.log("DRY_RUN:", process.env.DRY_RUN);
  console.log("ALLOW_TEST_SMTP:", process.env.ALLOW_TEST_SMTP);
  console.log("TEST_EMAIL_ALLOWLIST:", process.env.TEST_EMAIL_ALLOWLIST);
  console.log("");

  const admin = await prisma.user.findFirst({
    where: { email: "admin@botoschool.com" },
  });
  if (!admin) {
    throw new Error("Admin seed manquant — npm run db:seed");
  }

  for (const email of TEST_EMAILS) {
    const normalized = normalizeEmailAddress(email);
    const existing = await prisma.contact.findFirst({
      where: { emailNormalized: normalized, deletedAt: null },
    });
    if (existing) {
      await prisma.contact.update({
        where: { id: existing.id },
        data: {
          email,
          tags: [TAG],
          isTestRecipient: true,
          isDuplicate: false,
          status: ContactStatus.ELIGIBLE,
          source: "test-manual",
          consentBase: "test-allowlist",
        },
      });
    } else {
      await prisma.contact.create({
        data: {
          email,
          emailNormalized: normalized,
          firstName: email.split("@")[0],
          status: ContactStatus.ELIGIBLE,
          tags: [TAG],
          isTestRecipient: true,
          source: "test-manual",
          consentBase: "test-allowlist",
          createdById: admin.id,
        },
      });
    }
    console.log(`OK contact: ${email}`);
  }

  const segmentName = `Test 2 mails ${new Date().toISOString().slice(0, 10)}`;
  let segment = await prisma.segment.findFirst({
    where: { name: segmentName },
  });
  if (!segment) {
    segment = await segmentService.create(
      {
        name: segmentName,
        description: "Segment test Botoschool + Botoologia",
        filters: { tags: [TAG] },
        isDynamic: true,
      },
      admin.id,
    );
  } else {
    await segmentService.refresh(segment.id, admin.id);
  }
  console.log(`OK segment: ${segment.id} (${segment.contactCount ?? "?"} contacts)`);

  const templateName = `Template test 2 mails ${Date.now()}`;
  const template = await templateService.create(
    {
      name: templateName,
      subject: "Test BotoSchool — {{firstName}}",
      bodyHtml:
        "<p>Bonjour {{firstName}},</p><p>Ceci est un envoi test BotoSchool Emailing.</p>",
      variables: [],
    },
    admin.id,
  );
  console.log(`OK template: ${template.id}`);

  const campaign = await campaignService.create(
    {
      name: `Campagne test 2 mails ${new Date().toLocaleString("fr-FR")}`,
      description: "Test allowlist botoschool@gmail.com + botoologia@gmail.com",
      segmentId: segment.id,
      templateId: template.id,
      isTestMode: true,
      settings: {
        sendWindow: {
          startHour: 0,
          endHour: 24,
          allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
        },
      },
    },
    admin.id,
  );
  console.log(`OK campagne: ${campaign.id}`);

  const started = await campaignService.schedule(campaign.id, {}, admin.id);
  console.log(`OK schedule → status=${started.status}`);

  console.log("\nAttente worker (max 90s)...");
  const result = await waitForSends(campaign.id, TEST_EMAILS.length);
  console.log("Send attempts:", result);

  const attempts = await prisma.sendAttempt.findMany({
    where: { campaignRecipient: { campaignId: campaign.id } },
    include: {
      campaignRecipient: { include: { contact: { select: { email: true } } } },
    },
  });
  for (const a of attempts) {
    console.log(
      `  - ${a.campaignRecipient.contact.email}: ${a.status} ${a.errorMessage ? `(${a.errorMessage})` : ""}`,
    );
  }

  let mailpitOk = false;
  try {
    const messages = await fetchMailpitMessages();
    const hits = TEST_EMAILS.map((email) => {
      const found = messages.some((m) =>
        (m.To ?? []).some(
          (t) => t.Address?.toLowerCase() === email.toLowerCase(),
        ),
      );
      return { email, found };
    });
    console.log("\nMailpit (http://localhost:8025):");
    for (const h of hits) {
      console.log(`  ${h.found ? "PASS" : "FAIL"}  ${h.email}`);
    }
    mailpitOk = hits.every((h) => h.found);
  } catch (e) {
    console.warn("Mailpit indisponible:", e instanceof Error ? e.message : e);
  }

  const ok =
    result.sent >= TEST_EMAILS.length &&
    (result.failed ?? 0) === 0 &&
    mailpitOk;

  console.log("\n=== RÉSULTAT ===");
  console.log(ok ? "PASS — 2 emails test OK (voir Mailpit)" : "FAIL — voir détails ci-dessus");
  console.log(`Campagne: http://localhost:3000/campaigns/${campaign.id}`);
  console.log(`Mailpit: ${MAILPIT}`);

  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});

/**
 * Parcours 1 mail (×2 nouveaux destinataires) — MODE TEST, sans Soumettre/Valider.
 * Étapes : contact → éligible → segment → modèle → Envoi test → Mailpit
 */
import "dotenv/config";
import { ContactStatus, SendAttemptStatus } from "../src/generated/prisma/client";
import { resetEnvCache } from "../src/lib/config/env";
import { prisma } from "../src/lib/db/prisma";
import { normalizeEmailAddress } from "../src/lib/data/integrity";
import { campaignService } from "../src/modules/campaigns/services/campaign.service";
import { segmentService } from "../src/modules/segments/services/segment.service";
import { templateService } from "../src/modules/templates/services/template.service";

const TEST_EMAILS = [
  "nouveau.a.hassan@gmail.com",
  "nouveau.b.hassan@gmail.com",
] as const;
const TAG = `test-new-${Date.now()}`;
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

  console.log("=== Parcours nouveaux mails (MODE TEST, pas de validation) ===");
  console.log("Étape 1–2 Contacts éligibles:", TEST_EMAILS.join(", "));
  console.log("Tag segment:", TAG);
  console.log("ALLOWLIST:", process.env.TEST_EMAIL_ALLOWLIST);
  console.log("");

  const admin = await prisma.user.findFirst({
    where: { email: "admin@botoschool.com" },
  });
  if (!admin) throw new Error("Admin seed manquant — npm run db:seed");

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
          firstName: email.split("@")[0],
          tags: [TAG],
          isTestRecipient: true,
          isDuplicate: false,
          status: ContactStatus.ELIGIBLE,
          source: "Import manuel",
          consentBase: "Prospection B2B",
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
          source: "Import manuel",
          consentBase: "Prospection B2B",
          createdById: admin.id,
        },
      });
    }
    console.log(`OK Étape 1–2 contact éligible: ${email}`);
  }

  const segment = await segmentService.create(
    {
      name: `Test nouveaux mails ${new Date().toLocaleString("fr-FR")}`,
      description: "Segment unique pour nouveaux destinataires",
      filters: { tags: [TAG], eligibleOnly: true },
      isDynamic: true,
    },
    admin.id,
  );
  console.log(`OK Étape 3 segment: ${segment.id} (${segment.contactCount} contacts)`);

  const template = await templateService.create(
    {
      name: `Premier contact ${Date.now()}`,
      subject: "Bonjour {{firstName}}",
      bodyHtml:
        "<p>Bonjour {{firstName}},</p><p>Je vous contacte au sujet de BotoSchool.</p><p>Cordialement,<br/>L'équipe BotoSchool</p>",
      variables: [],
    },
    admin.id,
  );
  console.log(`OK Étape 4 modèle: ${template.id}`);

  const campaign = await campaignService.create(
    {
      name: `Campagne nouveaux mails ${new Date().toLocaleString("fr-FR")}`,
      description: "MODE TEST — Envoi test uniquement (pas Soumettre/Valider)",
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
  console.log(`OK Étape 5 campagne MODE TEST: ${campaign.id}`);

  const started = await campaignService.schedule(campaign.id, {}, admin.id);
  console.log(`OK Étape 5 Envoi test → status=${started.status} (pas de validation)`);

  console.log("\nÉtape 6 — attente worker...");
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
      `  - ${a.campaignRecipient.contact.email}: ${a.status}${a.errorMessage ? ` (${a.errorMessage})` : ""}`,
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
    console.log("\nMailpit:");
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
  console.log(ok ? "PASS — nouveaux mails envoyés (Mailpit)" : "FAIL");
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

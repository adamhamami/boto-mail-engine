/**
 * Détection non destructive des doublons email (Phase 2).
 * - Normalise les emails
 * - Enregistre les groupes dans email_duplicate_resolutions
 * - Marque is_duplicate / duplicate_of_id / TO_REVIEW sans supprimer
 *
 * Usage: npx tsx scripts/detect-email-duplicates.ts
 * Ne fusionne jamais automatiquement.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";
import { normalizeEmailAddress } from "../src/lib/data/integrity";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const contacts = await prisma.contact.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      email: true,
      emailNormalized: true,
      createdAt: true,
      isDuplicate: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // Backfill normalization if needed
  for (const contact of contacts) {
    const normalized = normalizeEmailAddress(contact.email);
    if (contact.emailNormalized !== normalized) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { emailNormalized: normalized },
      });
      contact.emailNormalized = normalized;
    }
  }

  const groups = new Map<string, typeof contacts>();
  for (const contact of contacts) {
    const key = contact.emailNormalized || normalizeEmailAddress(contact.email);
    const list = groups.get(key) ?? [];
    list.push(contact);
    groups.set(key, list);
  }

  const conflicts = [...groups.entries()].filter(([, list]) => list.length > 1);
  const report = {
    detectedAt: new Date().toISOString(),
    totalContacts: contacts.length,
    conflictGroups: conflicts.length,
    groups: conflicts.map(([emailNormalized, list]) => ({
      emailNormalized,
      count: list.length,
      canonicalContactId: list[0]!.id,
      contactIds: list.map((c) => c.id),
    })),
  };

  mkdirSync(join(process.cwd(), "docs/implementation"), { recursive: true });
  const reportPath = join(
    process.cwd(),
    "docs/implementation/04-duplicate-report.json",
  );
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  for (const group of report.groups) {
    await prisma.emailDuplicateResolution.create({
      data: {
        emailNormalized: group.emailNormalized,
        contactIds: group.contactIds,
        canonicalContactId: group.canonicalContactId,
        status: "DETECTED",
        notes: "Auto-detected by detect-email-duplicates.ts — no merge applied",
      },
    });

    const [, ...dupes] = group.contactIds;
    if (dupes.length > 0) {
      await prisma.contact.updateMany({
        where: { id: { in: dupes } },
        data: {
          isDuplicate: true,
          duplicateOfId: group.canonicalContactId,
          status: "TO_REVIEW",
        },
      });

      await prisma.emailDuplicateResolution.updateMany({
        where: {
          emailNormalized: group.emailNormalized,
          status: "DETECTED",
        },
        data: {
          status: "MARKED_DUPLICATE",
          notes:
            "Non-canonical contacts marked isDuplicate=true / TO_REVIEW — awaiting human merge decision",
          resolvedAt: new Date(),
        },
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        conflictGroups: report.conflictGroups,
        reportPath: "docs/implementation/04-duplicate-report.json",
        action: "Marked duplicates only — no deletes/merges",
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { createHash } from "node:crypto";
import {
  AuditAction,
  ContactStatus,
  DataSubjectRequestStatus,
  Prisma,
  SuppressionReason,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { stopContactSequence } from "@/lib/inbound/stop-sequence";
import { auditService } from "@/modules/audit/services/audit.service";
import type { AnonymizeContactInput } from "@/modules/compliance/validators/compliance.validator";

const REDACTED = { _redacted: true, reason: "CNDP_ANONYMIZE" } as const;

function anonEmail(contactId: string): string {
  const digest = createHash("sha256")
    .update(contactId)
    .digest("hex")
    .slice(0, 16);
  return `anon-${digest}@anonymized.invalid`;
}

/**
 * Anonymisation irréversible d’un contact (effacement CNDP pratique).
 * Conserve : stub contact, exclusion GDPR (email d’origine), historique
 * opérationnel non nominatif (statuts campagne).
 */
export async function anonymizeContact(
  contactId: string,
  input: AnonymizeContactInput,
  actorUserId?: string,
): Promise<{ contactId: string; anonymizedAt: string }> {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact) throw new NotFoundError("Contact introuvable");
  if (contact.anonymizedAt) {
    throw new ConflictError("Contact déjà anonymisé");
  }
  if (contact.legalHold) {
    throw new ValidationError(
      "Contact sous legal hold — lever le gel avant anonymisation",
    );
  }

  const originalEmail = contact.email;
  const originalNormalized = contact.emailNormalized;
  const replacement = anonEmail(contactId);
  const now = new Date();

  // Arrêt séquences (soft-fail si déjà stoppé)
  try {
    await stopContactSequence(contactId, "UNSUBSCRIBE");
  } catch (error) {
    logger.warn(
      {
        contactId,
        err:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : { message: "stop sequence failed" },
      },
      "Anonymize: stopContactSequence soft-failed",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.suppressionList.upsert({
      where: { emailNormalized: originalNormalized },
      create: {
        email: originalEmail,
        emailNormalized: originalNormalized,
        reason: SuppressionReason.GDPR,
        contactId,
        source: "compliance-anonymize",
        notes: input.reason,
        ...(actorUserId ? { createdById: actorUserId } : {}),
      },
      update: {
        reason: SuppressionReason.GDPR,
        contactId,
        source: "compliance-anonymize",
        notes: input.reason,
      },
    });

    await tx.contact.update({
      where: { id: contactId },
      data: {
        email: replacement,
        emailNormalized: replacement,
        firstName: null,
        lastName: null,
        phone: null,
        jobTitle: null,
        city: null,
        tags: [],
        customFields: {},
        source: null,
        consentBase: "ANONYMIZED",
        eligibilityNotes: null,
        isTestRecipient: false,
        isDuplicate: false,
        duplicateOfId: null,
        organizationId: null,
        ownerId: null,
        status: ContactStatus.BLOCKED,
        deletedAt: contact.deletedAt ?? now,
        anonymizedAt: now,
        ...(actorUserId ? { updatedById: actorUserId } : {}),
      },
    });

    // Redaction audit nominatif
    await tx.auditLog.updateMany({
      where: { entityType: "Contact", entityId: contactId },
      data: {
        oldValues: REDACTED as Prisma.InputJsonValue,
        newValues: REDACTED as Prisma.InputJsonValue,
        ipAddress: null,
        userAgent: null,
      },
    });

    // Events : IP / UA / metadata
    await tx.event.updateMany({
      where: { contactId },
      data: {
        ipAddress: null,
        userAgent: null,
        metadata: REDACTED as Prisma.InputJsonValue,
      },
    });

    await tx.salesTask.updateMany({
      where: { contactId },
      data: {
        title: "[anonymisé CNDP]",
        summary: "[anonymisé CNDP]",
      },
    });

    await tx.campaignRecipient.updateMany({
      where: { contactId },
      data: {
        isStopped: true,
        stopReason: "CNDP_ANONYMIZE",
      },
    });

    if (input.requestId) {
      await tx.dataSubjectRequest.updateMany({
        where: {
          id: input.requestId,
          status: {
            in: [
              DataSubjectRequestStatus.RECEIVED,
              DataSubjectRequestStatus.IN_PROGRESS,
            ],
          },
        },
        data: {
          status: DataSubjectRequestStatus.COMPLETED,
          completedAt: now,
          contactId,
          resultSummary: `Anonymisation effectuée le ${now.toISOString()}`,
        },
      });
    }
  });

  await auditService.log({
    action: AuditAction.ANONYMIZE,
    module: "compliance",
    entityType: "Contact",
    entityId: contactId,
    userId: actorUserId,
    newValues: {
      anonymizedAt: now.toISOString(),
      emailReplaced: true,
    },
    metadata: {
      contactId,
      reason: input.reason,
      requestId: input.requestId ?? null,
      originalEmailHash: createHash("sha256")
        .update(originalNormalized)
        .digest("hex"),
    },
  });

  logger.info(
    { contactId, actorUserId, requestId: input.requestId },
    "Contact anonymized (CNDP)",
  );

  return { contactId, anonymizedAt: now.toISOString() };
}

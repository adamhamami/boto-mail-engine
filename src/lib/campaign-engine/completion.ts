import {
  CampaignStatus,
  ContactStatus,
  RecipientStepStatus,
  SendAttemptStatus,
  type PrismaClient,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";

const TERMINAL_CONTACT: ContactStatus[] = [
  ContactStatus.RESPONDED,
  ContactStatus.UNSUBSCRIBED,
  ContactStatus.HARD_BOUNCED,
  ContactStatus.BLOCKED,
  ContactStatus.DISQUALIFIED,
];

const TERMINAL_STEP: RecipientStepStatus[] = [
  RecipientStepStatus.SENT,
  RecipientStepStatus.SKIPPED,
  RecipientStepStatus.STOPPED,
  RecipientStepStatus.FAILED,
];

/**
 * Une campagne RUNNING se termine si plus aucun recipient non-terminal actif.
 * Phase 11 : 2 requêtes batch (plus de N+1 par contact).
 */
export async function maybeCompleteCampaign(
  campaignId: string,
  opts: { db?: PrismaClient } = {},
): Promise<{ completed: boolean }> {
  const db = opts.db ?? prisma;

  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      status: true,
      sequence: {
        select: {
          steps: {
            where: { type: "EMAIL" },
            select: { stepOrder: true },
            orderBy: { stepOrder: "asc" },
          },
        },
      },
    },
  });

  if (!campaign || campaign.status !== CampaignStatus.RUNNING) {
    return { completed: false };
  }

  const emailSteps = campaign.sequence?.steps ?? [];
  if (emailSteps.length === 0) {
    return { completed: false };
  }
  const lastStepOrder = emailSteps[emailSteps.length - 1]!.stepOrder;

  const openRecipients = await db.campaignRecipient.count({
    where: {
      campaignId,
      isStopped: false,
      status: {
        in: [
          RecipientStepStatus.PENDING,
          RecipientStepStatus.SCHEDULED,
          RecipientStepStatus.QUEUED,
        ],
      },
      contact: {
        status: { notIn: TERMINAL_CONTACT },
      },
    },
  });

  if (openRecipients > 0) {
    return { completed: false };
  }

  // Une seule lecture de tous les recipients + statut contact
  const recipients = await db.campaignRecipient.findMany({
    where: { campaignId },
    select: {
      contactId: true,
      status: true,
      isStopped: true,
      isSent: true,
      sequenceStep: true,
      contact: { select: { status: true } },
    },
  });

  const byContact = new Map<string, typeof recipients>();
  for (const row of recipients) {
    const list = byContact.get(row.contactId);
    if (list) list.push(row);
    else byContact.set(row.contactId, [row]);
  }

  for (const steps of byContact.values()) {
    const contactStatus = steps[0]?.contact.status;
    if (!contactStatus) continue;
    if (TERMINAL_CONTACT.includes(contactStatus)) continue;

    const stopped = steps.some(
      (s) => s.isStopped || s.status === RecipientStepStatus.STOPPED,
    );
    if (stopped) continue;

    const last = steps.find((s) => s.sequenceStep === lastStepOrder);
    if (!last) {
      return { completed: false };
    }
    if (!TERMINAL_STEP.includes(last.status) && !last.isSent) {
      return { completed: false };
    }
  }

  const result = await db.campaign.updateMany({
    where: { id: campaignId, status: CampaignStatus.RUNNING },
    data: {
      status: CampaignStatus.COMPLETED,
      completedAt: new Date(),
    },
  });

  if (result.count > 0) {
    logger.info({ campaignId }, "Campaign auto-completed");
    return { completed: true };
  }

  return { completed: false };
}

export async function markRecipientSkipped(
  recipientId: string,
  reason: string,
  opts: { db?: PrismaClient } = {},
): Promise<void> {
  const db = opts.db ?? prisma;
  await db.campaignRecipient.update({
    where: { id: recipientId },
    data: {
      status: RecipientStepStatus.SKIPPED,
      skipReason: reason,
      isStopped: true,
      stopReason: reason,
    },
  });
  await db.sendAttempt.updateMany({
    where: {
      campaignRecipientId: recipientId,
      status: {
        in: [SendAttemptStatus.QUEUED, SendAttemptStatus.PROCESSING],
      },
    },
    data: {
      status: SendAttemptStatus.SKIPPED,
      errorMessage: reason,
      processedAt: new Date(),
    },
  });
}

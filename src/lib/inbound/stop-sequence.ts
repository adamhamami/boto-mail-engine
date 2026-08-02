import { normalizeEmailAddress } from "@/lib/data/integrity";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { getQueue, QUEUE_NAMES } from "@/lib/queue";
import {
  ContactStatus,
  SendAttemptStatus,
  SuppressionReason,
  type PrismaClient,
} from "@/generated/prisma/client";

export type StopSequenceReason =
  | "REPLY"
  | "HARD_BOUNCE"
  | "COMPLAINT"
  | "UNSUBSCRIBE"
  | "SOFT_BOUNCE_EXHAUSTED"
  | "PROVIDER_ERROR";

const STATUS_MAP: Record<StopSequenceReason, ContactStatus> = {
  REPLY: ContactStatus.RESPONDED,
  HARD_BOUNCE: ContactStatus.HARD_BOUNCED,
  COMPLAINT: ContactStatus.BLOCKED,
  UNSUBSCRIBE: ContactStatus.UNSUBSCRIBED,
  SOFT_BOUNCE_EXHAUSTED: ContactStatus.DISQUALIFIED,
  PROVIDER_ERROR: ContactStatus.IN_SEQUENCE,
};

const SUPPRESSION_MAP: Partial<
  Record<StopSequenceReason, SuppressionReason>
> = {
  HARD_BOUNCE: SuppressionReason.BOUNCE_HARD,
  COMPLAINT: SuppressionReason.COMPLAINT,
  UNSUBSCRIBE: SuppressionReason.UNSUBSCRIBE,
  SOFT_BOUNCE_EXHAUSTED: SuppressionReason.BOUNCE_SOFT,
};

/**
 * Arrêt de séquence CDC :
 * - recipients restants stoppés
 * - jobs BullMQ annulés si possible
 * - send attempts pending → SKIPPED
 * - suppression / statut contact selon raison
 *
 * Le worker email revalide toujours `isStopped` même si l’annulation queue échoue.
 */
export async function stopContactSequence(
  contactId: string,
  reason: StopSequenceReason,
  campaignId?: string,
  deps: { db?: PrismaClient } = {},
): Promise<{ cancelledJobs: number; stoppedRecipients: number }> {
  const db = deps.db ?? prisma;

  // PROVIDER_ERROR : ne change pas le statut contact global (sauf arrêt campagne locale)
  const contactStatus = STATUS_MAP[reason];
  const suppressReason = SUPPRESSION_MAP[reason] ?? null;

  const result = await db.$transaction(async (tx) => {
    if (reason !== "PROVIDER_ERROR") {
      await tx.contact.update({
        where: { id: contactId },
        data: { status: contactStatus },
      });
    }

    const recipientUpdate = await tx.campaignRecipient.updateMany({
      where: {
        contactId,
        isSent: false,
        isStopped: false,
        ...(campaignId ? { campaignId } : {}),
      },
      data: {
        isStopped: true,
        stopReason: reason,
        ...(reason === "REPLY" ? { repliedAt: new Date() } : {}),
        ...(reason === "HARD_BOUNCE" || reason === "SOFT_BOUNCE_EXHAUSTED"
          ? { bouncedAt: new Date() }
          : {}),
        ...(reason === "UNSUBSCRIBE" ? { unsubscribedAt: new Date() } : {}),
      },
    });

    // Aussi marquer le recipient déjà envoyé (réponse / bounce sur message livré)
    if (campaignId && (reason === "REPLY" || reason === "HARD_BOUNCE" || reason === "COMPLAINT" || reason === "UNSUBSCRIBE")) {
      await tx.campaignRecipient.updateMany({
        where: {
          contactId,
          campaignId,
          isStopped: false,
        },
        data: {
          isStopped: true,
          stopReason: reason,
          ...(reason === "REPLY" ? { repliedAt: new Date() } : {}),
          ...(reason === "HARD_BOUNCE" ? { bouncedAt: new Date() } : {}),
          ...(reason === "UNSUBSCRIBE" ? { unsubscribedAt: new Date() } : {}),
        },
      });
    }

    if (suppressReason) {
      const contact = await tx.contact.findUnique({
        where: { id: contactId },
        select: { email: true },
      });
      if (contact) {
        const emailNormalized = normalizeEmailAddress(contact.email);
        await tx.suppressionList.upsert({
          where: { emailNormalized },
          create: {
            email: contact.email,
            emailNormalized,
            reason: suppressReason,
            contactId,
            source: reason.toLowerCase(),
          },
          update: {
            reason: suppressReason,
            contactId,
            source: reason.toLowerCase(),
          },
        });
      }
    }

    if (campaignId && reason === "REPLY") {
      await tx.campaign.update({
        where: { id: campaignId },
        data: { replyCount: { increment: 1 } },
      });
    }

    if (
      campaignId &&
      (reason === "HARD_BOUNCE" || reason === "SOFT_BOUNCE_EXHAUSTED")
    ) {
      await tx.campaign.update({
        where: { id: campaignId },
        data: { bounceCount: { increment: 1 } },
      });
    }

    if (campaignId && reason === "UNSUBSCRIBE") {
      await tx.campaign.update({
        where: { id: campaignId },
        data: { unsubscribeCount: { increment: 1 } },
      });
    }

    return { stoppedRecipients: recipientUpdate.count };
  });

  const cancelledJobs = await cancelPendingEmailJobs(contactId, campaignId, db);

  logger.info(
    {
      contactId,
      campaignId: campaignId ?? null,
      reason,
      cancelledJobs,
      stoppedRecipients: result.stoppedRecipients,
    },
    "Contact sequence stopped",
  );

  return {
    cancelledJobs,
    stoppedRecipients: result.stoppedRecipients,
  };
}

async function cancelPendingEmailJobs(
  contactId: string,
  campaignId: string | undefined,
  db: PrismaClient,
): Promise<number> {
  const attempts = await db.sendAttempt.findMany({
    where: {
      status: { in: [SendAttemptStatus.QUEUED, SendAttemptStatus.PROCESSING] },
      campaignRecipient: {
        contactId,
        isSent: false,
        ...(campaignId ? { campaignId } : {}),
      },
    },
    select: { id: true, idempotencyKey: true },
  });

  if (attempts.length === 0) {
    return 0;
  }

  let cancelled = 0;
  try {
    const queue = getQueue(QUEUE_NAMES.EMAIL_SEND);
    for (const attempt of attempts) {
      try {
        const job = await queue.getJob(attempt.idempotencyKey);
        if (job) {
          await job.remove();
          cancelled += 1;
        }
      } catch (err) {
        logger.warn(
          {
            sendAttemptId: attempt.id,
            err: err instanceof Error ? err.message : "unknown",
          },
          "Failed to remove email job — worker will re-check isStopped",
        );
      }
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : "unknown" },
      "Email queue unavailable during sequence stop — DB stop flags still applied",
    );
  }

  await db.sendAttempt.updateMany({
    where: { id: { in: attempts.map((a) => a.id) } },
    data: {
      status: SendAttemptStatus.SKIPPED,
      errorMessage: "Sequence stopped — pending send cancelled",
      processedAt: new Date(),
    },
  });

  return cancelled;
}

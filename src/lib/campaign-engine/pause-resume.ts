import {
  CampaignStatus,
  RecipientStepStatus,
  SendAttemptStatus,
  type PrismaClient,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { getQueue, QUEUE_NAMES } from "@/lib/queue";
import { getClock } from "./clock";
import { enqueueEmailJob } from "./enqueue";
import { nextValidSendSlot } from "./send-window";
import {
  getEnvQuotaLimits,
  parseCampaignEngineSettings,
} from "./settings";

/**
 * Pause : status PAUSED — les jobs existants restent ; le worker refuse l’envoi.
 * Marque les attempts QUEUED comme deferred dans metadata (position logique conservée).
 */
export async function pauseCampaignEngine(
  campaignId: string,
  opts: { db?: PrismaClient; userId?: string } = {},
): Promise<void> {
  const db = opts.db ?? prisma;

  await db.campaign.updateMany({
    where: { id: campaignId, status: CampaignStatus.RUNNING },
    data: { status: CampaignStatus.PAUSED },
  });

  const pending = await db.sendAttempt.findMany({
    where: {
      status: { in: [SendAttemptStatus.QUEUED, SendAttemptStatus.PROCESSING] },
      campaignRecipient: { campaignId },
    },
    select: {
      id: true,
      idempotencyKey: true,
      metadata: true,
      campaignRecipient: { select: { scheduledAt: true, id: true } },
    },
  });

  for (const attempt of pending) {
    const meta =
      attempt.metadata && typeof attempt.metadata === "object"
        ? (attempt.metadata as Record<string, unknown>)
        : {};
    await db.sendAttempt.update({
      where: { id: attempt.id },
      data: {
        metadata: {
          ...meta,
          paused: true,
          pausedAt: new Date().toISOString(),
          logicalScheduledAt:
            attempt.campaignRecipient.scheduledAt?.toISOString() ?? null,
        },
      },
    });

    // Retirer le job actif pour éviter le bruit ; logique conservée en DB
    try {
      const queue = getQueue(QUEUE_NAMES.EMAIL_SEND);
      const job = await queue.getJob(attempt.idempotencyKey);
      if (job) await job.remove();
    } catch {
      // ignore — worker revalidera PAUSED
    }
  }

  logger.info(
    { campaignId, deferredAttempts: pending.length },
    "Campaign paused — jobs deferred",
  );
}

/**
 * Reprise : revalide, recalcule créneaux, ré-enqueue uniquement non-SENT.
 */
export async function resumeCampaignEngine(
  campaignId: string,
  opts: { db?: PrismaClient } = {},
): Promise<{ requeued: number }> {
  const db = opts.db ?? prisma;
  const clock = getClock();

  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    include: {
      template: { select: { version: true } },
    },
  });

  if (!campaign || campaign.status !== CampaignStatus.PAUSED) {
    return { requeued: 0 };
  }

  if (!campaign.validatedAt && !campaign.isTestMode) {
    throw new Error("Campaign must be validated before resume");
  }

  await db.campaign.update({
    where: { id: campaignId },
    data: { status: CampaignStatus.RUNNING },
  });

  const engine = parseCampaignEngineSettings(campaign.settings, {
    quotas: getEnvQuotaLimits(),
  });

  const recipients = await db.campaignRecipient.findMany({
    where: {
      campaignId,
      isSent: false,
      isStopped: false,
      status: {
        in: [
          RecipientStepStatus.SCHEDULED,
          RecipientStepStatus.QUEUED,
          RecipientStepStatus.PENDING,
        ],
      },
    },
    include: {
      contact: { select: { email: true } },
      sendAttempts: {
        orderBy: { queuedAt: "desc" },
        take: 1,
      },
    },
  });

  let requeued = 0;
  const now = clock.now();

  for (const recipient of recipients) {
    const attempt = recipient.sendAttempts[0];
    if (!attempt || attempt.status === SendAttemptStatus.SENT) continue;

    const baseAt = recipient.scheduledAt ?? now;
    const effectiveAt = nextValidSendSlot(
      baseAt.getTime() < now.getTime() ? now : baseAt,
      engine.sendWindow,
    );

    await db.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        scheduledAt: effectiveAt,
        status: RecipientStepStatus.QUEUED,
      },
    });

    await db.sendAttempt.update({
      where: { id: attempt.id },
      data: {
        status: SendAttemptStatus.QUEUED,
        metadata: {
          ...(typeof attempt.metadata === "object" && attempt.metadata
            ? (attempt.metadata as object)
            : {}),
          paused: false,
          resumedAt: now.toISOString(),
        },
      },
    });

    // Contenu doit être re-rendu par un job de préparation — on stocke un marker
    // Le worker/process utilisera metadata.subject/html s’ils existent, sinon skip + log
    const meta =
      typeof attempt.metadata === "object" && attempt.metadata
        ? (attempt.metadata as Record<string, unknown>)
        : {};

    if (typeof meta.subject === "string" && typeof meta.html === "string") {
      await enqueueEmailJob(
        {
          sendAttemptId: attempt.id,
          campaignRecipientId: recipient.id,
          contactEmail: recipient.contact.email,
          subject: meta.subject,
          html: meta.html,
          text: typeof meta.text === "string" ? meta.text : undefined,
          idempotencyKey: attempt.idempotencyKey,
        },
        effectiveAt,
        { clock, sendWindow: engine.sendWindow },
      );
      requeued += 1;
    }
  }

  logger.info({ campaignId, requeued }, "Campaign resumed");
  return { requeued };
}

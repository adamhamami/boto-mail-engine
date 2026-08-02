import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import {
  assertSendExecutionAllowed,
  evaluateWorkerSendReadiness,
  mustSimulateProviderSend,
  type WorkerSkipReason,
} from "@/lib/compliance/send-gates";
import { getMailProvider } from "@/lib/mail";
import type { MailProvider } from "@/lib/mail/types";
import type { EmailSendJobData } from "@/lib/queue";
import {
  EventType,
  RecipientStepStatus,
  SendAttemptStatus,
  type PrismaClient,
} from "@/generated/prisma/client";
import { getClock } from "@/lib/campaign-engine/clock";
import { consumeSendQuotas } from "@/lib/campaign-engine/quotas";
import {
  isWithinSendWindow,
  nextValidSendSlot,
} from "@/lib/campaign-engine/send-window";
import {
  getEnvQuotaLimits,
  parseCampaignEngineSettings,
} from "@/lib/campaign-engine/settings";
import { enqueueEmailJob } from "@/lib/campaign-engine/enqueue";
import { maybeCompleteCampaign } from "@/lib/campaign-engine/completion";
import { getEnv } from "@/lib/config/env";
import {
  acquireDistributedLock,
  type DistributedLock,
} from "@/lib/ha/distributed-lock";

export interface ProcessEmailSendDeps {
  db: PrismaClient;
  getProvider: () => MailProvider;
  /**
   * Verrou distribué anti double-envoi (multi-worker).
   * Tests : omit ou stub qui retourne toujours un lock.
   */
  acquireSendLock?: (idempotencyKey: string) => Promise<DistributedLock | null>;
}

const defaultDeps: ProcessEmailSendDeps = {
  db: prisma,
  getProvider: getMailProvider,
  acquireSendLock: (idempotencyKey) =>
    acquireDistributedLock(
      `send:${idempotencyKey}`,
      getEnv().HA_SEND_LOCK_TTL_MS,
    ),
};

export class QuotaDeferredError extends Error {
  readonly retryAfterMs: number;
  constructor(reason: string, retryAfterMs: number) {
    super(`Quota deferred: ${reason}`);
    this.name = "QuotaDeferredError";
    this.retryAfterMs = retryAfterMs;
  }
}

async function markSkipped(
  db: PrismaClient,
  params: {
    sendAttemptId: string;
    campaignRecipientId: string;
    campaignId: string;
    reason: WorkerSkipReason | string;
    message: string;
  },
): Promise<void> {
  await db.sendAttempt.update({
    where: { id: params.sendAttemptId },
    data: {
      status: SendAttemptStatus.SKIPPED,
      errorMessage: `${params.reason}: ${params.message}`,
      processedAt: new Date(),
      metadata: {
        skipped: true,
        reason: params.reason,
        kind: "SEND_POLICY_SKIP",
      },
    },
  });

  await db.campaignRecipient.update({
    where: { id: params.campaignRecipientId },
    data: {
      status: RecipientStepStatus.SKIPPED,
      skipReason: String(params.reason),
    },
  });

  logger.info(
    {
      sendAttemptId: params.sendAttemptId,
      campaignId: params.campaignId,
      reason: params.reason,
    },
    "Email send skipped by policy revalidation",
  );

  await maybeCompleteCampaign(params.campaignId, { db });
}

export async function processEmailSend(
  data: EmailSendJobData,
  deps: ProcessEmailSendDeps = defaultDeps,
): Promise<void> {
  const { sendAttemptId, campaignRecipientId, subject, html, text } = data;
  const db = deps.db;
  const clock = getClock();

  const attempt = await db.sendAttempt.findUnique({
    where: { id: sendAttemptId },
    include: {
      campaignRecipient: {
        include: {
          campaign: {
            select: {
              id: true,
              status: true,
              isTestMode: true,
              settings: true,
            },
          },
          contact: {
            select: {
              id: true,
              email: true,
              status: true,
              source: true,
              consentBase: true,
              deletedAt: true,
              anonymizedAt: true,
              isDuplicate: true,
            },
          },
        },
      },
    },
  });

  if (!attempt) {
    logger.warn({ sendAttemptId }, "Send attempt not found, skipping job");
    return;
  }

  const campaign = attempt.campaignRecipient.campaign;
  const recipient = attempt.campaignRecipient;
  const contact = attempt.campaignRecipient.contact;
  const contactEmail = contact?.email ?? data.contactEmail;

  if (attempt.status === SendAttemptStatus.SENT || recipient.isSent) {
    logger.info({ sendAttemptId }, "Email already sent, skipping");
    return;
  }

  const priorMeta =
    attempt.metadata && typeof attempt.metadata === "object"
      ? (attempt.metadata as Record<string, unknown>)
      : {};
  if (
    priorMeta.smtpAccepted === true &&
    typeof priorMeta.providerMessageId === "string"
  ) {
    await finalizeSent(db, {
      sendAttemptId,
      campaignRecipientId,
      campaignId: campaign.id,
      contactId: contact!.id,
      messageId: priorMeta.providerMessageId,
      providerName: String(priorMeta.provider ?? "unknown"),
      simulateOnly: Boolean(priorMeta.dryRun),
      isTestMode: campaign.isTestMode,
      subject,
      html,
      text,
    });
    return;
  }

  // Idempotence distribuée : un seul worker SMTP à la fois par clé.
  const acquireLock =
    deps.acquireSendLock ?? defaultDeps.acquireSendLock!;
  const sendLock = await acquireLock(data.idempotencyKey);
  if (!sendLock) {
    throw new QuotaDeferredError("concurrent_send_lock", 3_000);
  }

  try {
    // Re-check après acquisition du lock (course multi-worker).
    const fresh = await db.sendAttempt.findUnique({
      where: { id: sendAttemptId },
      select: {
        status: true,
        metadata: true,
        campaignRecipient: { select: { isSent: true } },
      },
    });
    if (
      !fresh ||
      fresh.status === SendAttemptStatus.SENT ||
      fresh.campaignRecipient.isSent
    ) {
      logger.info({ sendAttemptId }, "Email already sent after lock, skipping");
      return;
    }

    const suppressed = contactEmail
      ? await db.suppressionList.findUnique({
          where: { emailNormalized: contactEmail.toLowerCase().trim() },
          select: { id: true },
        })
      : null;

    const readiness = evaluateWorkerSendReadiness({
      campaignStatus: campaign.status,
      isTestMode: campaign.isTestMode,
      recipientIsStopped: recipient.isStopped,
      recipientIsSent: recipient.isSent,
      attemptStatus: fresh.status,
      contact: contact
        ? {
            id: contact.id,
            email: contact.email,
            status: contact.status,
            source: contact.source,
            consentBase: contact.consentBase,
            deletedAt: contact.deletedAt,
            anonymizedAt: contact.anonymizedAt,
            isDuplicate: contact.isDuplicate,
          }
        : null,
      emailSuppressed: Boolean(suppressed),
    });

    if (!readiness.ok) {
      await markSkipped(db, {
        sendAttemptId,
        campaignRecipientId,
        campaignId: campaign.id,
        reason: readiness.reason,
        message: readiness.message,
      });
      return;
    }

    const env = getEnv();
    const engine = parseCampaignEngineSettings(campaign.settings, {
      quotas: getEnvQuotaLimits(),
      sendWindow: {
        timeZone: env.CAMPAIGN_DEFAULT_TIMEZONE,
        allowedWeekdays: env.SEND_WINDOW_WEEKDAYS.split(",")
          .map((d) => Number(d.trim()))
          .filter((n) => Number.isFinite(n)),
        startHour: env.SEND_WINDOW_START_HOUR,
        endHour: env.SEND_WINDOW_END_HOUR,
        seasonalOverride: null,
      },
    });

    const now = clock.now();
    if (!isWithinSendWindow(now, engine.sendWindow)) {
      const next = nextValidSendSlot(now, engine.sendWindow);
      await enqueueEmailJob(data, next, {
        clock,
        sendWindow: engine.sendWindow,
      });
      logger.info(
        { sendAttemptId, nextAt: next.toISOString() },
        "Send deferred to next valid window",
      );
      return;
    }

    const quota = await consumeSendQuotas({
      campaignId: campaign.id,
      connector: env.MAIL_PROVIDER,
      senderDomain: (
        env.SMTP_FROM_EMAIL.split("@")[1] ?? "unknown"
      ).toLowerCase(),
      limits: engine.quotas,
    });

    if (!quota.allowed) {
      throw new QuotaDeferredError(
        quota.reason ?? "quota",
        quota.retryAfterMs ?? 5_000,
      );
    }

    const simulateOnly = mustSimulateProviderSend();

    try {
      assertSendExecutionAllowed({
        phase: "worker",
        isTestMode: campaign.isTestMode,
        intendRealSmtp: !simulateOnly,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Real SMTP denied";
      await markSkipped(db, {
        sendAttemptId,
        campaignRecipientId,
        campaignId: campaign.id,
        reason: "REAL_SMTP_DENIED",
        message,
      });
      return;
    }

    // Claim atomique DB (zero-duplicate sous concurrence).
    const claimed = await db.sendAttempt.updateMany({
      where: {
        id: sendAttemptId,
        status: {
          in: [
            SendAttemptStatus.QUEUED,
            SendAttemptStatus.FAILED,
            SendAttemptStatus.PROCESSING,
          ],
        },
      },
      data: {
        status: SendAttemptStatus.PROCESSING,
        processedAt: new Date(),
      },
    });

    if (claimed.count === 0) {
      logger.info(
        { sendAttemptId },
        "Send attempt claim lost — already terminal, skipping",
      );
      return;
    }

    try {
      let messageId = `dry-run-${sendAttemptId}`;
      let providerName = "dry-run";

      if (!simulateOnly) {
        const provider = deps.getProvider();
        const result = await provider.send({
          to: contactEmail,
          subject,
          html,
          text,
        });
        messageId = result.messageId;
        providerName = provider.name;
      }

      await db.sendAttempt.update({
        where: { id: sendAttemptId },
        data: {
          metadata: {
            ...priorMeta,
            subject,
            html,
            text: text ?? null,
            smtpAccepted: true,
            providerMessageId: messageId,
            provider: providerName,
            dryRun: simulateOnly,
          },
        },
      });

      await finalizeSent(db, {
        sendAttemptId,
        campaignRecipientId,
        campaignId: campaign.id,
        contactId: contact!.id,
        messageId,
        providerName,
        simulateOnly,
        isTestMode: campaign.isTestMode,
        subject,
        html,
        text,
      });

      logger.info(
        {
          sendAttemptId,
          campaignId: campaign.id,
          messageId,
          provider: providerName,
          dryRun: simulateOnly,
        },
        simulateOnly ? "Email simulated (DRY_RUN)" : "Email sent successfully",
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown send error";

      await db.sendAttempt.update({
        where: { id: sendAttemptId },
        data: {
          status: SendAttemptStatus.FAILED,
          errorMessage,
          processedAt: new Date(),
        },
      });

      logger.error(
        { sendAttemptId, campaignId: campaign.id, err: errorMessage },
        "Email send failed",
      );

      throw error;
    }
  } finally {
    await sendLock.release();
  }
}

async function finalizeSent(
  db: PrismaClient,
  params: {
    sendAttemptId: string;
    campaignRecipientId: string;
    campaignId: string;
    contactId: string;
    messageId: string;
    providerName: string;
    simulateOnly: boolean;
    isTestMode: boolean;
    subject: string;
    html: string;
    text?: string;
  },
): Promise<void> {
  const now = getClock().now();

  await db.$transaction([
    db.sendAttempt.update({
      where: { id: params.sendAttemptId },
      data: {
        status: SendAttemptStatus.SENT,
        sentAt: now,
        providerMessageId: params.messageId,
        metadata: {
          dryRun: params.simulateOnly,
          isTestMode: params.isTestMode,
          subject: params.subject,
          html: params.html,
          text: params.text ?? null,
          smtpAccepted: true,
          providerMessageId: params.messageId,
          provider: params.providerName,
        },
      },
    }),
    db.campaignRecipient.update({
      where: { id: params.campaignRecipientId },
      data: {
        isSent: true,
        sentAt: now,
        status: RecipientStepStatus.SENT,
      },
    }),
    db.campaign.update({
      where: { id: params.campaignId },
      data: { sentCount: { increment: 1 } },
    }),
    db.event.create({
      data: {
        type: EventType.EMAIL_SENT,
        campaignId: params.campaignId,
        contactId: params.contactId,
        metadata: {
          sendAttemptId: params.sendAttemptId,
          providerMessageId: params.messageId,
          provider: params.providerName,
          dryRun: params.simulateOnly,
          isTestMode: params.isTestMode,
        },
      },
    }),
  ]);

  await maybeCompleteCampaign(params.campaignId, { db });
}

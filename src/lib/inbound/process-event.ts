import { getEnv } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { getQueue, QUEUE_NAMES, type EmailSendJobData } from "@/lib/queue";
import {
  EventType,
  SalesTaskPriority,
  SalesTaskStatus,
  SalesTaskType,
  SendAttemptStatus,
  WebhookEventStatus,
  type Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import { maybeAutoPauseCampaign } from "./auto-pause";
import { stopContactSequence } from "./stop-sequence";
import type { MailEventType, NormalizedMailEvent } from "./types";
import { redactEmail } from "./types";

export interface ProcessWebhookDeps {
  db: PrismaClient;
  enqueueSoftRetry?: (data: EmailSendJobData, delayMs: number) => Promise<void>;
}

const defaultDeps: ProcessWebhookDeps = {
  db: prisma,
  enqueueSoftRetry: async (data, delayMs) => {
    const queue = getQueue(QUEUE_NAMES.EMAIL_SEND);
    await queue.add("send-email", data, {
      jobId: `${data.idempotencyKey}:soft-${Date.now()}`,
      delay: delayMs,
    });
  },
};

type StoredPayload = {
  type?: string;
  messageId?: string | null;
  campaignId?: string | null;
  contactId?: string | null;
  sendAttemptId?: string | null;
  campaignRecipientId?: string | null;
  sender?: string | null;
  recipient?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
};

/**
 * Traitement métier d’un WebhookEvent PENDING (worker).
 */
export async function processWebhookEvent(
  webhookEventId: string,
  deps: ProcessWebhookDeps = defaultDeps,
): Promise<{ status: "processed" | "ignored" | "duplicate" }> {
  const db = deps.db;

  const row = await db.webhookEvent.findUnique({ where: { id: webhookEventId } });
  if (!row) {
    logger.warn({ webhookEventId }, "Webhook event not found");
    return { status: "ignored" };
  }

  if (
    row.status === WebhookEventStatus.PROCESSED ||
    row.status === WebhookEventStatus.IGNORED
  ) {
    return { status: "duplicate" };
  }

  const payload = row.payload as StoredPayload;
  const type = (payload.type ?? row.eventType) as MailEventType;

  const event: NormalizedMailEvent = {
    provider: row.provider,
    providerEventId: row.providerEventId ?? row.id,
    type,
    messageId: payload.messageId ?? null,
    timestamp: payload.occurredAt ? new Date(payload.occurredAt) : row.createdAt,
    sender: null,
    recipient: null,
    campaignId: payload.campaignId ?? null,
    contactId: payload.contactId ?? null,
    sendAttemptId: payload.sendAttemptId ?? null,
    campaignRecipientId: payload.campaignRecipientId ?? null,
    rawPayloadReference: row.id,
    payloadMinimized: payload as Record<string, unknown>,
  };

  try {
    await applyMailEvent(event, deps);

    await db.webhookEvent.update({
      where: { id: webhookEventId },
      data: {
        status: WebhookEventStatus.PROCESSED,
        processedAt: new Date(),
        errorMessage: null,
      },
    });

    logger.info(
      {
        webhookEventId,
        type,
        provider: row.provider,
        campaignId: event.campaignId,
        contactId: event.contactId,
      },
      "Webhook event processed",
    );

    return { status: "processed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await db.webhookEvent.update({
      where: { id: webhookEventId },
      data: {
        status: WebhookEventStatus.FAILED,
        errorMessage: message,
        processedAt: new Date(),
      },
    });
    logger.error(
      { webhookEventId, type, err: message },
      "Webhook event processing failed",
    );
    throw error;
  }
}

async function applyMailEvent(
  event: NormalizedMailEvent,
  deps: ProcessWebhookDeps,
): Promise<void> {
  const db = deps.db;
  const resolved = await resolveTargets(event, db);

  switch (event.type) {
    case "EMAIL_DELIVERED":
      await handleDelivered(event, resolved, db);
      break;
    case "EMAIL_REPLIED":
      await handleReply(event, resolved, db);
      break;
    case "HARD_BOUNCE":
      await handleHardBounce(event, resolved, db);
      break;
    case "SOFT_BOUNCE":
      await handleSoftBounce(event, resolved, deps);
      break;
    case "COMPLAINT":
      await handleComplaint(event, resolved, db);
      break;
    case "UNSUBSCRIBED":
      await handleUnsubscribed(event, resolved, db);
      break;
    case "PROVIDER_ERROR":
      await handleProviderError(event, resolved, db);
      break;
    default:
      logger.warn(
        { type: event.type, providerEventId: event.providerEventId },
        "Unknown mail event type ignored",
      );
  }
}

interface ResolvedTargets {
  contactId: string | null;
  campaignId: string | null;
  campaignRecipientId: string | null;
  sendAttemptId: string | null;
}

async function resolveTargets(
  event: NormalizedMailEvent,
  db: PrismaClient,
): Promise<ResolvedTargets> {
  let contactId = event.contactId ?? null;
  let campaignId = event.campaignId ?? null;
  let campaignRecipientId = event.campaignRecipientId ?? null;
  let sendAttemptId = event.sendAttemptId ?? null;

  if (sendAttemptId) {
    const attempt = await db.sendAttempt.findUnique({
      where: { id: sendAttemptId },
      select: {
        id: true,
        campaignRecipientId: true,
        campaignRecipient: {
          select: { contactId: true, campaignId: true },
        },
      },
    });
    if (attempt) {
      campaignRecipientId = attempt.campaignRecipientId;
      contactId = attempt.campaignRecipient.contactId;
      campaignId = attempt.campaignRecipient.campaignId;
    }
  } else if (event.messageId) {
    const attempt = await db.sendAttempt.findFirst({
      where: { providerMessageId: event.messageId },
      select: {
        id: true,
        campaignRecipientId: true,
        campaignRecipient: {
          select: { contactId: true, campaignId: true },
        },
      },
    });
    if (attempt) {
      sendAttemptId = attempt.id;
      campaignRecipientId = attempt.campaignRecipientId;
      contactId = attempt.campaignRecipient.contactId;
      campaignId = attempt.campaignRecipient.campaignId;
    }
  } else if (campaignRecipientId) {
    const recipient = await db.campaignRecipient.findUnique({
      where: { id: campaignRecipientId },
      select: { contactId: true, campaignId: true },
    });
    if (recipient) {
      contactId = recipient.contactId;
      campaignId = recipient.campaignId;
    }
  }

  return { contactId, campaignId, campaignRecipientId, sendAttemptId };
}

async function handleDelivered(
  event: NormalizedMailEvent,
  targets: ResolvedTargets,
  db: PrismaClient,
): Promise<void> {
  if (!targets.campaignId || !targets.contactId) return;

  await db.event.create({
    data: {
      type: EventType.EMAIL_DELIVERED,
      campaignId: targets.campaignId,
      contactId: targets.contactId,
      metadata: {
        provider: event.provider,
        providerEventId: event.providerEventId,
        messageId: event.messageId,
        sendAttemptId: targets.sendAttemptId,
      },
    },
  });
}

async function handleReply(
  event: NormalizedMailEvent,
  targets: ResolvedTargets,
  db: PrismaClient,
): Promise<void> {
  if (!targets.contactId) {
    logger.warn(
      { providerEventId: event.providerEventId },
      "Reply event without contact — ignored",
    );
    return;
  }

  await stopContactSequence(targets.contactId, "REPLY", targets.campaignId ?? undefined, {
    db,
  });

  const auditEvent = await db.event.create({
    data: {
      type: EventType.EMAIL_REPLIED,
      campaignId: targets.campaignId,
      contactId: targets.contactId,
      metadata: {
        provider: event.provider,
        providerEventId: event.providerEventId,
        messageId: event.messageId,
        autoStop: true,
      },
    },
  });

  await createReplySalesTaskOnce({
    db,
    contactId: targets.contactId,
    campaignId: targets.campaignId,
    eventId: auditEvent.id,
  });
}

async function handleHardBounce(
  event: NormalizedMailEvent,
  targets: ResolvedTargets,
  db: PrismaClient,
): Promise<void> {
  if (!targets.contactId) return;

  if (targets.sendAttemptId) {
    await db.sendAttempt.update({
      where: { id: targets.sendAttemptId },
      data: {
        status: SendAttemptStatus.BOUNCED,
        errorMessage: "HARD_BOUNCE",
        processedAt: new Date(),
      },
    });
  }

  await stopContactSequence(
    targets.contactId,
    "HARD_BOUNCE",
    targets.campaignId ?? undefined,
    { db },
  );

  await db.event.create({
    data: {
      type: EventType.EMAIL_BOUNCED,
      campaignId: targets.campaignId,
      contactId: targets.contactId,
      metadata: {
        hard: true,
        provider: event.provider,
        providerEventId: event.providerEventId,
        autoStop: true,
      },
    },
  });

  if (targets.campaignId) {
    await maybeAutoPauseCampaign(targets.campaignId, { db });
  }
}

async function handleSoftBounce(
  event: NormalizedMailEvent,
  targets: ResolvedTargets,
  deps: ProcessWebhookDeps,
): Promise<void> {
  const db = deps.db;
  const maxRetries = getEnv().SOFT_BOUNCE_MAX_RETRIES;

  if (!targets.sendAttemptId) {
    await db.event.create({
      data: {
        type: EventType.EMAIL_BOUNCED,
        campaignId: targets.campaignId,
        contactId: targets.contactId,
        metadata: {
          hard: false,
          provider: event.provider,
          providerEventId: event.providerEventId,
          note: "soft_bounce_without_attempt",
        },
      },
    });
    return;
  }

  const attempt = await db.sendAttempt.findUnique({
    where: { id: targets.sendAttemptId },
    include: {
      campaignRecipient: {
        include: {
          contact: { select: { id: true, email: true } },
          campaign: { select: { id: true, isTestMode: true } },
        },
      },
    },
  });

  if (!attempt) return;

  const meta = (attempt.metadata ?? {}) as Record<string, unknown>;
  const softCount = Number(meta.softBounceCount ?? 0) + 1;

  await db.event.create({
    data: {
      type: EventType.EMAIL_BOUNCED,
      campaignId: targets.campaignId ?? attempt.campaignRecipient.campaignId,
      contactId: targets.contactId ?? attempt.campaignRecipient.contactId,
      metadata: {
        hard: false,
        softBounceCount: softCount,
        maxRetries,
        provider: event.provider,
        providerEventId: event.providerEventId,
      },
    },
  });

  if (softCount >= maxRetries) {
    await db.sendAttempt.update({
      where: { id: attempt.id },
      data: {
        status: SendAttemptStatus.BOUNCED,
        errorMessage: `SOFT_BOUNCE exhausted (${softCount})`,
        metadata: { ...meta, softBounceCount: softCount } as Prisma.InputJsonValue,
        processedAt: new Date(),
      },
    });

    await stopContactSequence(
      attempt.campaignRecipient.contactId,
      "SOFT_BOUNCE_EXHAUSTED",
      attempt.campaignRecipient.campaignId,
      { db },
    );
    return;
  }

  const storedSubject =
    typeof meta.subject === "string" ? meta.subject : null;
  const storedHtml = typeof meta.html === "string" ? meta.html : null;
  const delayMs = Math.min(60_000 * 2 ** (softCount - 1), 3_600_000);

  await db.sendAttempt.update({
    where: { id: attempt.id },
    data: {
      status: SendAttemptStatus.QUEUED,
      attemptNumber: attempt.attemptNumber + 1,
      errorMessage: `SOFT_BOUNCE retry ${softCount}/${maxRetries}`,
      metadata: {
        ...meta,
        softBounceCount: softCount,
        softBounceRetryAt: new Date(Date.now() + delayMs).toISOString(),
      } as Prisma.InputJsonValue,
    },
  });

  // Retry SMTP uniquement si le contenu a été figé dans metadata (évite un renvoi vide).
  if (storedSubject && storedHtml && deps.enqueueSoftRetry) {
    await deps.enqueueSoftRetry(
      {
        sendAttemptId: attempt.id,
        campaignRecipientId: attempt.campaignRecipientId,
        contactEmail: attempt.campaignRecipient.contact.email,
        subject: storedSubject,
        html: storedHtml,
        text: typeof meta.text === "string" ? meta.text : undefined,
        idempotencyKey: attempt.idempotencyKey,
      },
      delayMs,
    );
  }

  logger.info(
    {
      sendAttemptId: attempt.id,
      softCount,
      maxRetries,
      delayMs,
      retryEnqueued: Boolean(storedSubject && storedHtml),
      recipient: redactEmail(attempt.campaignRecipient.contact.email),
    },
    "Soft bounce recorded with bounded retry strategy",
  );
}

async function handleComplaint(
  event: NormalizedMailEvent,
  targets: ResolvedTargets,
  db: PrismaClient,
): Promise<void> {
  if (!targets.contactId) return;

  await stopContactSequence(
    targets.contactId,
    "COMPLAINT",
    targets.campaignId ?? undefined,
    { db },
  );

  await db.event.create({
    data: {
      type: EventType.EMAIL_COMPLAINED,
      campaignId: targets.campaignId,
      contactId: targets.contactId,
      metadata: {
        provider: event.provider,
        providerEventId: event.providerEventId,
        autoStop: true,
      },
    },
  });
}

async function handleUnsubscribed(
  event: NormalizedMailEvent,
  targets: ResolvedTargets,
  db: PrismaClient,
): Promise<void> {
  if (!targets.contactId) return;

  await stopContactSequence(
    targets.contactId,
    "UNSUBSCRIBE",
    targets.campaignId ?? undefined,
    { db },
  );

  await db.event.create({
    data: {
      type: EventType.EMAIL_UNSUBSCRIBED,
      campaignId: targets.campaignId,
      contactId: targets.contactId,
      metadata: {
        provider: event.provider,
        providerEventId: event.providerEventId,
        source: "inbound_event",
      },
    },
  });
}

async function handleProviderError(
  event: NormalizedMailEvent,
  targets: ResolvedTargets,
  db: PrismaClient,
): Promise<void> {
  if (targets.sendAttemptId) {
    await db.sendAttempt.update({
      where: { id: targets.sendAttemptId },
      data: {
        status: SendAttemptStatus.FAILED,
        errorMessage: "PROVIDER_ERROR",
        processedAt: new Date(),
      },
    });
  }

  await db.event.create({
    data: {
      type: EventType.EMAIL_PROVIDER_ERROR,
      campaignId: targets.campaignId,
      contactId: targets.contactId,
      metadata: {
        provider: event.provider,
        providerEventId: event.providerEventId,
        messageId: event.messageId,
      },
    },
  });
}

async function createReplySalesTaskOnce(params: {
  db: PrismaClient;
  contactId: string;
  campaignId: string | null;
  eventId: string;
}): Promise<void> {
  const existing = await params.db.salesTask.findFirst({
    where: {
      contactId: params.contactId,
      campaignId: params.campaignId,
      type: SalesTaskType.REPLY_FOLLOW_UP,
      status: { in: [SalesTaskStatus.OPEN, SalesTaskStatus.IN_PROGRESS] },
    },
    select: { id: true },
  });

  if (existing) {
    logger.info(
      { salesTaskId: existing.id, contactId: params.contactId },
      "SalesTask already exists for reply — skipped",
    );
    return;
  }

  await params.db.salesTask.create({
    data: {
      contactId: params.contactId,
      campaignId: params.campaignId,
      eventId: params.eventId,
      type: SalesTaskType.REPLY_FOLLOW_UP,
      priority: SalesTaskPriority.HIGH,
      title: "Réponse prospect — suivi commercial",
      summary: "Réponse détectée via événement entrant. Contacter le prospect.",
    },
  });
}

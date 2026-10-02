import { buildSendIdempotencyKey } from "@/lib/data/integrity";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { observabilityJobFields } from "@/lib/observability/context";
import { getQueue, QUEUE_NAMES, type EmailSendJobData } from "@/lib/queue";
import {
  RecipientStepStatus,
  SendAttemptStatus,
  type PrismaClient,
} from "@/generated/prisma/client";
import type { Clock } from "./clock";
import { getClock } from "./clock";
import {
  computeStepScheduledAt,
  type EmailStepDef,
} from "./sequence-rules";
import { nextValidSendSlot, type SendWindowConfig } from "./send-window";
import { DEFAULT_CAMPAIGN_TIMEZONE } from "./timezone";

/** BullMQ interdit ':' dans jobId — clé DB inchangée. */
function toBullMqJobId(idempotencyKey: string): string {
  return idempotencyKey.replace(/:/g, "__");
}

export interface PlannedRecipientStep {
  contactId: string;
  contactEmail: string;
  step: EmailStepDef;
  sequenceVersion: number;
  contentVersion: number;
  scheduledAt: Date;
  idempotencyKey: string;
}

/**
 * Programme toutes les étapes EMAIL pour un contact (dates UTC non ambiguës).
 */
export function planContactSteps(params: {
  campaignId: string;
  contactId: string;
  campaignStartedAt: Date;
  steps: EmailStepDef[];
  sequenceVersion: number;
  contentVersions: Record<string, number>;
  timeZone?: string;
}): PlannedRecipientStep[] {
  const timeZone = params.timeZone ?? DEFAULT_CAMPAIGN_TIMEZONE;
  return params.steps.map((step) => {
    const scheduledAt = computeStepScheduledAt(
      params.campaignStartedAt,
      step,
      timeZone,
    );
    return {
      contactId: params.contactId,
      contactEmail: "",
      step,
      sequenceVersion: params.sequenceVersion,
      contentVersion: params.contentVersions[step.templateId] ?? 1,
      scheduledAt,
      idempotencyKey: buildSendIdempotencyKey({
        campaignId: params.campaignId,
        contactId: params.contactId,
        sequenceStep: step.stepOrder,
        sequenceVersion: params.sequenceVersion,
      }),
    };
  });
}

export async function createStepRecipientAndAttempt(
  plan: PlannedRecipientStep & {
    campaignId: string;
    contactEmail: string;
  },
  opts: { db?: PrismaClient } = {},
): Promise<{
  campaignRecipientId: string;
  sendAttemptId: string;
  unsubscribeToken: string;
  created: boolean;
}> {
  const db = opts.db ?? prisma;

  const existing = await db.campaignRecipient.findUnique({
    where: {
      campaignId_contactId_sequenceStep_sequenceVersion: {
        campaignId: plan.campaignId,
        contactId: plan.contactId,
        sequenceStep: plan.step.stepOrder,
        sequenceVersion: plan.sequenceVersion,
      },
    },
    select: {
      id: true,
      unsubscribeToken: true,
      isSent: true,
      status: true,
      sendAttempts: {
        take: 1,
        orderBy: { queuedAt: "desc" },
        select: { id: true, status: true },
      },
    },
  });

  if (existing) {
    const attempt = existing.sendAttempts[0];
    return {
      campaignRecipientId: existing.id,
      sendAttemptId: attempt?.id ?? "",
      unsubscribeToken: existing.unsubscribeToken,
      created: false,
    };
  }

  const recipient = await db.campaignRecipient.create({
    data: {
      campaignId: plan.campaignId,
      contactId: plan.contactId,
      sequenceStep: plan.step.stepOrder,
      sequenceStepId: plan.step.id,
      sequenceVersion: plan.sequenceVersion,
      templateId: plan.step.templateId,
      contentVersion: plan.contentVersion,
      scheduledAt: plan.scheduledAt,
      status:
        plan.scheduledAt.getTime() > getClock().now().getTime()
          ? RecipientStepStatus.SCHEDULED
          : RecipientStepStatus.QUEUED,
    },
    select: { id: true, unsubscribeToken: true },
  });

  const attempt = await db.sendAttempt.create({
    data: {
      campaignRecipientId: recipient.id,
      idempotencyKey: plan.idempotencyKey,
      status: SendAttemptStatus.QUEUED,
      queuedAt: plan.scheduledAt,
    },
    select: { id: true },
  });

  return {
    campaignRecipientId: recipient.id,
    sendAttemptId: attempt.id,
    unsubscribeToken: recipient.unsubscribeToken,
    created: true,
  };
}

/**
 * Enfile un job email avec délai jusqu’à scheduledAt (créneau ajusté).
 * Idempotent via jobId = idempotencyKey.
 */
export async function enqueueEmailJob(
  data: EmailSendJobData,
  scheduledAt: Date,
  opts: {
    clock?: Clock;
    sendWindow?: SendWindowConfig;
    queueAdd?: (
      name: string,
      payload: EmailSendJobData,
      options: { jobId: string; delay?: number },
    ) => Promise<unknown>;
  } = {},
): Promise<{ delayMs: number; effectiveAt: Date }> {
  const clock = opts.clock ?? getClock();
  const now = clock.now();
  let effectiveAt = scheduledAt.getTime() < now.getTime() ? now : scheduledAt;

  if (opts.sendWindow) {
    effectiveAt = nextValidSendSlot(effectiveAt, opts.sendWindow);
  }

  const delayMs = Math.max(0, effectiveAt.getTime() - now.getTime());

  const add =
    opts.queueAdd ??
    (async (name, payload, options) => {
      const queue = getQueue(QUEUE_NAMES.EMAIL_SEND);
      return queue.add(name, payload, options);
    });

  const obs = observabilityJobFields();
  const payload: EmailSendJobData = {
    ...data,
    correlationId: data.correlationId ?? obs.correlationId,
    requestId: data.requestId ?? obs.requestId,
    traceId: data.traceId ?? obs.traceId,
    spanId: data.spanId ?? obs.spanId,
  };

  try {
    await add("send-email", payload, {
      jobId: toBullMqJobId(data.idempotencyKey),
      delay: delayMs > 0 ? delayMs : undefined,
    });
  } catch (error) {
    // Job déjà existant (double clic / multi-instance) — OK
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists|JobId/i.test(message)) {
      throw error;
    }
    logger.info(
      { idempotencyKey: data.idempotencyKey },
      "Email job already enqueued — idempotent skip",
    );
  }

  return { delayMs, effectiveAt };
}

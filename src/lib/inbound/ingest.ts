import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { getQueue, QUEUE_NAMES } from "@/lib/queue";
import { WebhookEventStatus } from "@/generated/prisma/client";
import { minimizeStoredPayload } from "./normalize";
import type { NormalizedMailEvent } from "./types";

export interface IngestResult {
  webhookEventId: string;
  duplicate: boolean;
  enqueued: boolean;
}

export interface WebhookProcessJobData {
  webhookEventId: string;
}

/**
 * Persistance idempotente + mise en queue.
 * La route HTTP ne doit faire que cela après auth/validation.
 */
export async function ingestNormalizedEvent(
  event: NormalizedMailEvent,
): Promise<IngestResult> {
  const storedPayload = minimizeStoredPayload(event);

  try {
    const created = await prisma.webhookEvent.create({
      data: {
        provider: event.provider,
        providerEventId: event.providerEventId,
        eventType: event.type,
        payload: storedPayload as Prisma.InputJsonValue,
        status: WebhookEventStatus.PENDING,
      },
    });

    await enqueueWebhookProcess(created.id);

    logger.info(
      {
        webhookEventId: created.id,
        provider: event.provider,
        type: event.type,
        providerEventId: event.providerEventId,
      },
      "Inbound mail event ingested",
    );

    return {
      webhookEventId: created.id,
      duplicate: false,
      enqueued: true,
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await prisma.webhookEvent.findUnique({
        where: {
          provider_providerEventId: {
            provider: event.provider,
            providerEventId: event.providerEventId,
          },
        },
      });

      if (!existing) {
        throw error;
      }

      // Ré-enqueue seulement si encore PENDING (job perdu possible)
      let enqueued = false;
      if (existing.status === WebhookEventStatus.PENDING) {
        await enqueueWebhookProcess(existing.id);
        enqueued = true;
      }

      logger.info(
        {
          webhookEventId: existing.id,
          provider: event.provider,
          providerEventId: event.providerEventId,
          status: existing.status,
          enqueued,
        },
        "Duplicate inbound event ignored",
      );

      return {
        webhookEventId: existing.id,
        duplicate: true,
        enqueued,
      };
    }
    throw error;
  }
}

async function enqueueWebhookProcess(webhookEventId: string): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.WEBHOOK_PROCESS);
  await queue.add(
    "process-webhook",
    { webhookEventId } satisfies WebhookProcessJobData,
    { jobId: `webhook:${webhookEventId}` },
  );
}

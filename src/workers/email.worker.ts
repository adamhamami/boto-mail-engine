import { DelayedError, type Job } from "bullmq";
import { logger } from "@/lib/logger";
import {
  createWorker,
  getQueue,
  QUEUE_NAMES,
  type EmailSendJobData,
} from "@/lib/queue";
import { prisma } from "@/lib/db/prisma";
import { EventType } from "@/generated/prisma/client";
import { runWithContext } from "@/lib/observability/context";
import { childSpan, resolveTraceContext } from "@/lib/observability/tracing";
import {
  processEmailSend,
  QuotaDeferredError,
} from "./process-email-send";

export function startEmailWorker() {
  const worker = createWorker<EmailSendJobData>(
    QUEUE_NAMES.EMAIL_SEND,
    async (job: Job<EmailSendJobData>) => {
      const incoming =
        job.data.traceId && job.data.spanId
          ? resolveTraceContext(
              `00-${job.data.traceId}-${job.data.spanId}-01`,
            )
          : resolveTraceContext(null);
      const span = job.data.traceId ? childSpan(incoming) : incoming;

      try {
        await runWithContext(
          {
            correlationId: job.data.correlationId,
            requestId: job.data.requestId,
            traceId: span.traceId,
            spanId: span.spanId,
            parentSpanId: span.parentSpanId,
            jobId: job.id,
          },
          () => processEmailSend(job.data),
        );
      } catch (error) {
        // Retry intelligent : reporter au moment exact du quota (pas le backoff générique).
        if (error instanceof QuotaDeferredError) {
          const delayMs = Math.max(1_000, error.retryAfterMs);
          logger.info(
            {
              jobId: job.id,
              sendAttemptId: job.data.sendAttemptId,
              delayMs,
              reason: error.message,
            },
            "Email job deferred (quota / lock) — moveToDelayed",
          );
          await job.moveToDelayed(Date.now() + delayMs, job.token);
          throw new DelayedError();
        }
        throw error;
      }
    },
  );

  worker.on("failed", async (job, error) => {
    if (!job) {
      return;
    }

    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      return;
    }

    const dlq = getQueue(QUEUE_NAMES.EMAIL_DLQ);
    await dlq.add("failed-email", job.data, {
      jobId: `dlq-${job.data.idempotencyKey}`,
    });

    const contactId = await prisma.sendAttempt.findUnique({
      where: { id: job.data.sendAttemptId },
      select: {
        campaignRecipient: {
          select: { contactId: true, campaignId: true },
        },
      },
    });

    if (contactId) {
      await prisma.event.create({
        data: {
          type: EventType.EMAIL_BOUNCED,
          campaignId: contactId.campaignRecipient.campaignId,
          contactId: contactId.campaignRecipient.contactId,
          metadata: {
            sendAttemptId: job.data.sendAttemptId,
            error: error.message,
            finalFailure: true,
          },
        },
      });
    }

    logger.error(
      {
        jobId: job.id,
        sendAttemptId: job.data.sendAttemptId,
        err: error.message,
      },
      "Email job moved to DLQ after final failure",
    );
  });

  worker.on("error", (error) => {
    logger.error({ err: error.message }, "Email worker error");
  });

  logger.info("Email send worker started");
  return worker;
}

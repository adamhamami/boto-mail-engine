import { logger } from "@/lib/logger";
import { createWorker, QUEUE_NAMES } from "@/lib/queue";
import type { WebhookProcessJobData } from "@/lib/inbound/ingest";
import { processWebhookEvent } from "@/lib/inbound/process-event";

export function startWebhookWorker() {
  const worker = createWorker<WebhookProcessJobData>(
    QUEUE_NAMES.WEBHOOK_PROCESS,
    async (job) => {
      await processWebhookEvent(job.data.webhookEventId);
    },
    5,
  );

  worker.on("failed", (job, error) => {
    logger.error(
      {
        jobId: job?.id,
        webhookEventId: job?.data?.webhookEventId,
        err: error.message,
      },
      "Webhook process job failed",
    );
  });

  worker.on("error", (error) => {
    logger.error({ err: error.message }, "Webhook worker error");
  });

  logger.info("Webhook process worker started");
  return worker;
}

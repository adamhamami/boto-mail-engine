import { logger } from "@/lib/logger";
import { createWorker, QUEUE_NAMES } from "@/lib/queue";
import {
  processImportBatch,
  type ImportProcessJobData,
} from "./process-import";
import { purgeStaleImportTempFiles } from "@/lib/imports/temp-storage";

export function startImportWorker() {
  const worker = createWorker<ImportProcessJobData>(
    QUEUE_NAMES.IMPORT_PROCESS,
    async (job) => {
      await processImportBatch(job.data);
    },
    2,
  );

  worker.on("failed", (job, error) => {
    logger.error(
      {
        jobId: job?.id,
        importBatchId: job?.data?.importBatchId,
        err: error.message,
      },
      "Import process job failed",
    );
  });

  worker.on("error", (error) => {
    logger.error({ err: error.message }, "Import worker error");
  });

  void purgeStaleImportTempFiles(24).then((n) => {
    if (n > 0) {
      logger.info({ purged: n }, "Stale import temp files purged");
    }
  });

  logger.info("Import process worker started");
  return worker;
}

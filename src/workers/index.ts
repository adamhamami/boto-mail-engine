import { logger } from "@/lib/logger";
import { env } from "@/lib/config/env";
import { startLogCompressionScheduler } from "@/lib/logger/compress-rotated";
import { writeWorkerHeartbeat } from "@/lib/monitoring/worker-heartbeat";
import { LeaderElector } from "@/lib/ha/leader-election";
import { installGracefulShutdown } from "@/lib/ha/graceful-shutdown";
import { closeQueueInfrastructure } from "@/lib/queue";
import { prisma } from "@/lib/db/prisma";
import { ensureCampaignScanRepeatable } from "@/lib/campaign-engine/scheduler";
import { startRetentionScheduler } from "@/lib/compliance/retention-scheduler";
import { startEmailWorker } from "./email.worker";
import { startWebhookWorker } from "./webhook.worker";
import { startCampaignSchedulerWorker } from "./campaign.worker";
import { startImportWorker } from "./import.worker";

const WORKER_NAMES = [
  "email-send",
  "webhook-process",
  "campaign-scheduler",
  "import-process",
] as const;

async function main() {
  if (!env.WORKER_ENABLED) {
    logger.info("Worker disabled via WORKER_ENABLED=false");
    process.exit(0);
  }

  logger.info("Starting BotoSchool email workers (HA-ready)...");
  // Compression locale des logs fichiers (par host) — pas un singleton cluster.
  startLogCompressionScheduler();

  const emailWorker = startEmailWorker();
  const webhookWorker = startWebhookWorker();
  const campaignWorker = startCampaignSchedulerWorker({
    registerScanRepeatable: false,
  });
  const importWorker = startImportWorker();

  // Leader election : un seul worker enregistre le scan répétable.
  const scanLeader = new LeaderElector("campaign-scan", env.HA_LEADER_TTL_MS);
  scanLeader.start({
    onBecomeLeader: async () => {
      await ensureCampaignScanRepeatable();
      logger.info("Campaign scan repeatable registered by leader");
    },
  });

  const retentionScheduler = startRetentionScheduler();

  const beat = async () => {
    try {
      await writeWorkerHeartbeat([...WORKER_NAMES]);
    } catch (error) {
      logger.warn(
        {
          err:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : { message: "heartbeat failed" },
        },
        "Worker heartbeat write failed",
      );
    }
  };

  await beat();
  const heartbeatTimer = setInterval(() => {
    void beat();
  }, env.WORKER_HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();

  installGracefulShutdown({
    timeoutMs: env.HA_SHUTDOWN_TIMEOUT_MS,
    hooks: [
      async () => {
        clearInterval(heartbeatTimer);
        await retentionScheduler.stop();
        await scanLeader.resign();
      },
      async () => {
        // BullMQ : stop taking jobs, wait in-flight (worker.close).
        await Promise.all([
          emailWorker.close(),
          webhookWorker.close(),
          campaignWorker.close(),
          importWorker.close(),
        ]);
      },
      async () => {
        await closeQueueInfrastructure();
      },
      async () => {
        await prisma.$disconnect();
      },
    ],
  });
}

main().catch((err) => {
  logger.error({ err }, "Worker startup failed");
  process.exit(1);
});

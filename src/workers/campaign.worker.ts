import { logger } from "@/lib/logger";
import { createWorker, QUEUE_NAMES } from "@/lib/queue";
import {
  CAMPAIGN_SCAN_JOB,
  CAMPAIGN_START_JOB,
  ensureCampaignScanRepeatable,
  type CampaignStartJobData,
} from "@/lib/campaign-engine/scheduler";
import { findDueScheduledCampaigns } from "@/lib/campaign-engine/claim-start";
import { campaignService } from "@/modules/campaigns/services/campaign.service";

/**
 * Worker scheduler campagnes — delayed + scan reprise (pas de setInterval Next.js).
 * Idempotence du démarrage : `startCampaign` (updateMany atomique).
 * En HA, l'enregistrement du scan répétable est réservé au leader
 * (`registerScanRepeatable: false` depuis workers/index).
 */
export function startCampaignSchedulerWorker(opts?: {
  registerScanRepeatable?: boolean;
}) {
  const registerScan = opts?.registerScanRepeatable !== false;

  const worker = createWorker<{
    campaignId?: string;
    scheduledAtIso?: string;
    requestedByUserId?: string;
    type?: string;
  }>(
    QUEUE_NAMES.CAMPAIGN_SCHEDULER,
    async (job) => {
      const name = job.name;
      if (job.data?.type === "scan" || name === CAMPAIGN_SCAN_JOB) {
        await processCampaignScan();
        return;
      }

      if (name === CAMPAIGN_START_JOB || job.data?.campaignId) {
        await processCampaignStart(job.data as CampaignStartJobData);
      }
    },
    2,
  );

  worker.on("failed", (job, error) => {
    logger.error(
      { jobId: job?.id, err: error.message },
      "Campaign scheduler job failed",
    );
  });

  worker.on("error", (error) => {
    logger.error({ err: error.message }, "Campaign scheduler worker error");
  });

  if (registerScan) {
    void ensureCampaignScanRepeatable().catch((err) => {
      logger.warn(
        { err: err instanceof Error ? err.message : "unknown" },
        "Could not register campaign scan repeatable",
      );
    });
  }

  logger.info("Campaign scheduler worker started");
  return worker;
}

async function processCampaignStart(data: CampaignStartJobData): Promise<void> {
  await campaignService.startCampaign(
    data.campaignId,
    data.requestedByUserId || "system-scheduler",
  );
  logger.info({ campaignId: data.campaignId }, "Scheduled campaign started");
}

async function processCampaignScan(): Promise<void> {
  const due = await findDueScheduledCampaigns({ limit: 50 });
  for (const campaign of due) {
    try {
      await campaignService.startCampaign(campaign.id, "system-scheduler-scan");
      logger.info(
        { campaignId: campaign.id },
        "Due scheduled campaign started by scan",
      );
    } catch (error) {
      logger.warn(
        {
          campaignId: campaign.id,
          err: error instanceof Error ? error.message : "unknown",
        },
        "Scan start skipped or failed",
      );
    }
  }
}

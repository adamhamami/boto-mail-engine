import { getQueue, QUEUE_NAMES } from "@/lib/queue";
import { logger } from "@/lib/logger";
import type { Clock } from "./clock";
import { getClock } from "./clock";

export const CAMPAIGN_START_JOB = "campaign-start";
export const CAMPAIGN_SCAN_JOB = "campaign-scan";

export interface CampaignStartJobData {
  campaignId: string;
  scheduledAtIso: string;
  requestedByUserId: string;
}

/**
 * Enregistre un job différé idempotent pour démarrer une campagne SCHEDULED.
 * jobId = campaign-start:{campaignId} → remplace / déduplique multi-instance.
 */
export async function scheduleCampaignStartJob(params: {
  campaignId: string;
  scheduledAt: Date;
  userId: string;
  clock?: Clock;
  queueAdd?: (
    name: string,
    data: CampaignStartJobData,
    opts: { jobId: string; delay: number },
  ) => Promise<unknown>;
}): Promise<{ jobId: string; delayMs: number }> {
  const clock = params.clock ?? getClock();
  const delayMs = Math.max(
    0,
    params.scheduledAt.getTime() - clock.now().getTime(),
  );
  const jobId = `campaign-start:${params.campaignId}`;

  const data: CampaignStartJobData = {
    campaignId: params.campaignId,
    scheduledAtIso: params.scheduledAt.toISOString(),
    requestedByUserId: params.userId,
  };

  const add =
    params.queueAdd ??
    (async (name, payload, opts) => {
      const queue = getQueue(QUEUE_NAMES.CAMPAIGN_SCHEDULER);
      const existing = await queue.getJob(opts.jobId);
      if (existing) {
        try {
          await existing.remove();
        } catch {
          /* ignore */
        }
      }
      await queue.add(name, payload, opts);
    });

  await add(CAMPAIGN_START_JOB, data, { jobId, delay: delayMs });

  logger.info(
    { campaignId: params.campaignId, jobId, delayMs },
    "Campaign start job scheduled",
  );

  return { jobId, delayMs };
}

/**
 * Job répétable de reprise : scan des SCHEDULED dues (multi-instance safe via claim).
 */
export async function ensureCampaignScanRepeatable(opts?: {
  everyMs?: number;
}): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.CAMPAIGN_SCHEDULER);
  const every = opts?.everyMs ?? 60_000;
  await queue.add(
    CAMPAIGN_SCAN_JOB,
    { type: "scan" },
    {
      repeat: { every },
      jobId: "campaign-scan-repeatable",
      removeOnComplete: { count: 100 },
    },
  );
}

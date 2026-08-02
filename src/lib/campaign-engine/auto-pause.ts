import { getEnv } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import {
  CampaignStatus,
  EventType,
  type PrismaClient,
} from "@/generated/prisma/client";

export interface AutoPauseThresholds {
  hardBounceRate: number;
  complaintRate: number;
  providerErrorRate: number;
  minEvents: number;
  volumeAnomalyMultiplier: number;
}

export function getAutoPauseThresholds(): AutoPauseThresholds {
  const env = getEnv();
  return {
    hardBounceRate: env.AUTO_PAUSE_HARD_BOUNCE_RATE,
    complaintRate: env.AUTO_PAUSE_COMPLAINT_RATE,
    providerErrorRate: env.AUTO_PAUSE_PROVIDER_ERROR_RATE,
    minEvents: env.AUTO_PAUSE_MIN_EVENTS,
    volumeAnomalyMultiplier: env.AUTO_PAUSE_VOLUME_ANOMALY_MULTIPLIER,
  };
}

export type AutoPauseReason =
  | "HARD_BOUNCE_RATE"
  | "COMPLAINT_RATE"
  | "PROVIDER_ERROR_RATE"
  | "CONNECTOR_UNAVAILABLE"
  | "VOLUME_ANOMALY";

/**
 * Évalue et applique la pause automatique multi-seuils (Phase 4).
 */
export async function evaluateAndAutoPauseCampaign(
  campaignId: string,
  opts: {
    db?: PrismaClient;
    connectorHealthy?: boolean;
    expectedHourlyVolume?: number;
    actualHourlyVolume?: number;
  } = {},
): Promise<{ paused: boolean; reason?: AutoPauseReason; rate?: number }> {
  const db = opts.db ?? prisma;
  const thresholds = getAutoPauseThresholds();

  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      status: true,
      sentCount: true,
      settings: true,
    },
  });

  if (!campaign || campaign.status !== CampaignStatus.RUNNING) {
    return { paused: false };
  }

  if (opts.connectorHealthy === false) {
    return pause(db, campaignId, campaign.settings, "CONNECTOR_UNAVAILABLE");
  }

  if (
    opts.expectedHourlyVolume &&
    opts.actualHourlyVolume !== undefined &&
    opts.expectedHourlyVolume > 0 &&
    opts.actualHourlyVolume >
      opts.expectedHourlyVolume * thresholds.volumeAnomalyMultiplier
  ) {
    return pause(db, campaignId, campaign.settings, "VOLUME_ANOMALY", {
      expected: opts.expectedHourlyVolume,
      actual: opts.actualHourlyVolume,
    });
  }

  const sent = Math.max(campaign.sentCount, 1);

  const [hardBounces, complaints, providerErrors] = await Promise.all([
    db.event.count({
      where: {
        campaignId,
        type: EventType.EMAIL_BOUNCED,
        metadata: { path: ["hard"], equals: true },
      },
    }),
    db.event.count({
      where: { campaignId, type: EventType.EMAIL_COMPLAINED },
    }),
    db.event.count({
      where: { campaignId, type: EventType.EMAIL_PROVIDER_ERROR },
    }),
  ]);

  const checks: Array<{
    count: number;
    rateLimit: number;
    reason: AutoPauseReason;
  }> = [
    {
      count: hardBounces,
      rateLimit: thresholds.hardBounceRate,
      reason: "HARD_BOUNCE_RATE",
    },
    {
      count: complaints,
      rateLimit: thresholds.complaintRate,
      reason: "COMPLAINT_RATE",
    },
    {
      count: providerErrors,
      rateLimit: thresholds.providerErrorRate,
      reason: "PROVIDER_ERROR_RATE",
    },
  ];

  for (const check of checks) {
    if (check.count < thresholds.minEvents && campaign.sentCount < thresholds.minEvents) {
      continue;
    }
    const baseline = Math.max(campaign.sentCount, check.count);
    if (baseline < thresholds.minEvents) continue;
    const rate = check.count / baseline;
    if (rate >= check.rateLimit) {
      return pause(db, campaignId, campaign.settings, check.reason, { rate });
    }
  }

  void sent;
  return { paused: false };
}

async function pause(
  db: PrismaClient,
  campaignId: string,
  settings: unknown,
  reason: AutoPauseReason,
  extra: Record<string, unknown> = {},
): Promise<{ paused: boolean; reason: AutoPauseReason; rate?: number }> {
  const prev =
    settings && typeof settings === "object"
      ? (settings as Record<string, unknown>)
      : {};

  const result = await db.campaign.updateMany({
    where: { id: campaignId, status: CampaignStatus.RUNNING },
    data: {
      status: CampaignStatus.PAUSED,
      settings: {
        ...prev,
        autoPaused: true,
        autoPauseReason: reason,
        autoPausedAt: new Date().toISOString(),
        ...extra,
      },
    },
  });

  if (result.count > 0) {
    logger.warn({ campaignId, reason, ...extra }, "Campaign auto-paused");
    return {
      paused: true,
      reason,
      rate: typeof extra.rate === "number" ? extra.rate : undefined,
    };
  }
  return { paused: false, reason };
}

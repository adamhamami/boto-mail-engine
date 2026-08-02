import {
  CampaignStatus,
  type PrismaClient,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { Clock } from "./clock";
import { getClock } from "./clock";

export interface ClaimCampaignStartResult {
  claimed: boolean;
  campaignId: string;
  previousStatus: CampaignStatus | null;
}

/**
 * Transition atomique SCHEDULED|VALIDATED → RUNNING.
 * Compatible multi-instance : une seule mise à jour gagne.
 */
export async function claimCampaignStart(
  campaignId: string,
  opts: { db?: PrismaClient; clock?: Clock } = {},
): Promise<ClaimCampaignStartResult> {
  const db = opts.db ?? prisma;
  const clock = opts.clock ?? getClock();
  const now = clock.now();

  const updated = await db.campaign.updateMany({
    where: {
      id: campaignId,
      status: { in: [CampaignStatus.SCHEDULED, CampaignStatus.VALIDATED] },
      deletedAt: null,
    },
    data: {
      status: CampaignStatus.RUNNING,
      startedAt: now,
    },
  });

  if (updated.count === 0) {
    const existing = await db.campaign.findUnique({
      where: { id: campaignId },
      select: { status: true },
    });
    return {
      claimed: false,
      campaignId,
      previousStatus: existing?.status ?? null,
    };
  }

  return {
    claimed: true,
    campaignId,
    previousStatus: CampaignStatus.SCHEDULED,
  };
}

/**
 * Récupère les campagnes SCHEDULED dont scheduledAt ≤ now (reprise après incident).
 */
export async function findDueScheduledCampaigns(
  opts: { db?: PrismaClient; clock?: Clock; limit?: number } = {},
): Promise<Array<{ id: string; scheduledAt: Date | null }>> {
  const db = opts.db ?? prisma;
  const clock = opts.clock ?? getClock();
  const now = clock.now();

  return db.campaign.findMany({
    where: {
      status: CampaignStatus.SCHEDULED,
      scheduledAt: { lte: now },
      deletedAt: null,
    },
    select: { id: true, scheduledAt: true },
    take: opts.limit ?? 50,
    orderBy: { scheduledAt: "asc" },
  });
}

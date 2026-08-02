import { evaluateAndAutoPauseCampaign } from "@/lib/campaign-engine/auto-pause";
import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Pause automatique si le taux de hard-bounce dépasse le seuil configuré.
 * Délègue au moteur Phase 4 (seuils multi-critères).
 */
export async function maybeAutoPauseCampaign(
  campaignId: string,
  deps: { db?: PrismaClient } = {},
): Promise<{ paused: boolean; rate: number }> {
  const result = await evaluateAndAutoPauseCampaign(campaignId, {
    db: deps.db,
  });
  return { paused: result.paused, rate: result.rate ?? 0 };
}

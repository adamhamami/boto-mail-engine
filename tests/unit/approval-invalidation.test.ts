import { describe, it, expect } from "vitest";
import { CampaignStatus } from "@/generated/prisma/client";

/**
 * Règle métier Phase 2 : une modification matérielle après approbation
 * invalide le snapshot (retour BROUILLON + clear snapshot).
 */
function nextStatusAfterMaterialEdit(current: CampaignStatus): {
  allowed: boolean;
  invalidateApproval: boolean;
} {
  if (current === CampaignStatus.DRAFT || current === CampaignStatus.TESTED) {
    return { allowed: true, invalidateApproval: true };
  }
  return { allowed: false, invalidateApproval: false };
}

describe("Phase 2 approval invalidation rules", () => {
  it("allows edit on DRAFT/TESTED and flags approval invalidation", () => {
    expect(nextStatusAfterMaterialEdit(CampaignStatus.DRAFT)).toEqual({
      allowed: true,
      invalidateApproval: true,
    });
    expect(nextStatusAfterMaterialEdit(CampaignStatus.TESTED)).toEqual({
      allowed: true,
      invalidateApproval: true,
    });
  });

  it("refuses edit on VALIDATED / RUNNING", () => {
    expect(nextStatusAfterMaterialEdit(CampaignStatus.VALIDATED).allowed).toBe(
      false,
    );
    expect(nextStatusAfterMaterialEdit(CampaignStatus.RUNNING).allowed).toBe(
      false,
    );
  });
});

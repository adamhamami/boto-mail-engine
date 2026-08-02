import { describe, it, expect } from "vitest";
import { CampaignValidationError } from "@/lib/errors";

describe("Campaign validation gate", () => {
  it("CampaignValidationError has status 422", () => {
    const error = new CampaignValidationError("Campaign must be validated before send");
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe("CAMPAIGN_NOT_VALIDATED");
  });

  it("message is descriptive", () => {
    const error = new CampaignValidationError("Not validated");
    expect(error.message).toContain("Not validated");
  });
});

import { describe, it, expect } from "vitest";
import {
  getCorrelationId,
  runWithContext,
} from "@/lib/observability/context";
import { logInfo } from "@/lib/observability/safe-log";

describe("Observability context", () => {
  it("propage correlationId", () => {
    runWithContext({ correlationId: "corr-test-1" }, () => {
      expect(getCorrelationId()).toBe("corr-test-1");
    });
  });

  it("safe-log n'explose pas avec champs sensibles", () => {
    expect(() =>
      runWithContext({ correlationId: "c2", campaignId: "camp1" }, () => {
        logInfo(
          {
            password: "secret",
            SMTP_PASSWORD: "x",
            token: "abcdef",
            campaignId: "camp1",
            jobId: "job-9",
          },
          "test log",
        );
      }),
    ).not.toThrow();
  });
});

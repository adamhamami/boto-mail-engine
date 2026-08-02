import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  assertContactEligibleForSend,
  assertEmailOnTestAllowlist,
  assertRealSmtpAllowed,
  assertSendExecutionAllowed,
  evaluateWorkerSendReadiness,
  isEmailOnTestAllowlist,
  mustSimulateProviderSend,
  TEST_MODE_MAX_RECIPIENTS,
} from "@/lib/compliance/send-gates";
import {
  getEnv,
  resetEnvCache,
  TEST_ONLY_AUTH_SECRET,
} from "@/lib/config/env";
import { CampaignValidationError, ValidationError } from "@/lib/errors";
import {
  CampaignStatus,
  ContactStatus,
} from "@/generated/prisma/client";

function setEnv(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetEnvCache();
}

describe("Phase 1 send safety gates", () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    setEnv({
      NODE_ENV: "test",
      DRY_RUN: "true",
      PRODUCTION_SENDING_ENABLED: "false",
      ALLOW_TEST_SMTP: "false",
      TEST_EMAIL_ALLOWLIST: "qa@botoschool.ma,internal@example.com",
      TEST_DOMAIN_ALLOWLIST: "botoschool.ma",
      SMTP_ALLOWED_NODE_ENVS: "production,test",
      AUTH_SECRET: TEST_ONLY_AUTH_SECRET,
    });
  });

  afterEach(() => {
    process.env = { ...snapshot };
    resetEnvCache();
  });

  it("DRY_RUN=true forces provider simulation", () => {
    expect(mustSimulateProviderSend()).toBe(true);
  });

  it("test campaign does not bypass DRY_RUN for real SMTP", () => {
    expect(() =>
      assertRealSmtpAllowed({ isTestMode: true }),
    ).toThrow(CampaignValidationError);

    expect(() =>
      assertSendExecutionAllowed({
        phase: "worker",
        isTestMode: true,
        intendRealSmtp: true,
      }),
    ).toThrow(/DRY_RUN/);
  });

  it("rejects email outside test allowlist even if isTestRecipient", () => {
    expect(isEmailOnTestAllowlist("prospect@ecole.ma")).toBe(false);
    expect(() =>
      assertContactEligibleForSend(
        {
          email: "prospect@ecole.ma",
          status: ContactStatus.TO_REVIEW,
          source: null,
          consentBase: null,
          isTestRecipient: true,
        },
        { isTestMode: true },
      ),
    ).toThrow(ValidationError);
  });

  it("accepts allowlisted test email without relying on isTestRecipient alone", () => {
    expect(() =>
      assertContactEligibleForSend(
        {
          email: "qa@botoschool.ma",
          status: ContactStatus.TO_REVIEW,
          source: null,
          consentBase: null,
          isTestRecipient: false,
        },
        { isTestMode: true },
      ),
    ).not.toThrow();
    expect(() => assertEmailOnTestAllowlist("QA@Botoschool.ma")).not.toThrow();
  });

  it("accepts domain allowlist", () => {
    expect(isEmailOnTestAllowlist("dev@botoschool.ma")).toBe(true);
  });

  it("requires ELIGIBLE + source + consent for production contacts", () => {
    expect(() =>
      assertContactEligibleForSend(
        {
          email: "a@ecole.ma",
          status: ContactStatus.ELIGIBLE,
          source: null,
          consentBase: "x",
        },
        { isTestMode: false },
      ),
    ).toThrow(ValidationError);

    expect(() =>
      assertContactEligibleForSend(
        {
          email: "a@ecole.ma",
          status: ContactStatus.ELIGIBLE,
          source: "Base",
          consentBase: "Intérêt légitime",
        },
        { isTestMode: false },
      ),
    ).not.toThrow();
  });

  it("worker readiness skips RESPONDED contacts", () => {
    const result = evaluateWorkerSendReadiness({
      campaignStatus: CampaignStatus.RUNNING,
      isTestMode: false,
      recipientIsStopped: false,
      recipientIsSent: false,
      attemptStatus: "QUEUED",
      emailSuppressed: false,
      contact: {
        id: "c1",
        email: "a@ecole.ma",
        status: ContactStatus.RESPONDED,
        source: "Base",
        consentBase: "OK",
        deletedAt: null,
        isDuplicate: false,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("CONTACT_BLOCKED_STATUS");
    }
  });

  it("worker readiness skips paused campaigns", () => {
    const result = evaluateWorkerSendReadiness({
      campaignStatus: CampaignStatus.PAUSED,
      isTestMode: false,
      recipientIsStopped: false,
      recipientIsSent: false,
      attemptStatus: "QUEUED",
      emailSuppressed: false,
      contact: {
        id: "c1",
        email: "a@ecole.ma",
        status: ContactStatus.ELIGIBLE,
        source: "Base",
        consentBase: "OK",
        deletedAt: null,
        isDuplicate: false,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("CAMPAIGN_NOT_SENDABLE");
    }
  });

  it("worker readiness skips suppressed emails", () => {
    const result = evaluateWorkerSendReadiness({
      campaignStatus: CampaignStatus.RUNNING,
      isTestMode: false,
      recipientIsStopped: false,
      recipientIsSent: false,
      attemptStatus: "QUEUED",
      emailSuppressed: true,
      contact: {
        id: "c1",
        email: "a@ecole.ma",
        status: ContactStatus.ELIGIBLE,
        source: "Base",
        consentBase: "OK",
        deletedAt: null,
        isDuplicate: false,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("EMAIL_SUPPRESSED");
    }
  });

  it("real SMTP for test requires ALLOW_TEST_SMTP + allowed NODE_ENV + DRY_RUN=false", () => {
    setEnv({
      NODE_ENV: "test",
      DRY_RUN: "false",
      ALLOW_TEST_SMTP: "true",
      PRODUCTION_SENDING_ENABLED: "false",
      SMTP_ALLOWED_NODE_ENVS: "test",
      AUTH_SECRET: TEST_ONLY_AUTH_SECRET,
    });
    expect(() =>
      assertRealSmtpAllowed({ isTestMode: true }),
    ).not.toThrow();
  });

  it("limits test mode to 10 recipients", () => {
    expect(TEST_MODE_MAX_RECIPIENTS).toBe(10);
  });

  it("AUTH_SECRET missing blocks production startup", () => {
    setEnv({
      NODE_ENV: "production",
      AUTH_SECRET: undefined,
      DRY_RUN: "true",
    });
    expect(() => getEnv()).toThrow(/Invalid environment configuration/);
  });

  it("AUTH_SECRET weak placeholder blocks production", () => {
    setEnv({
      NODE_ENV: "production",
      AUTH_SECRET: "generate-a-strong-secret-min-32-chars-here",
      DRY_RUN: "true",
    });
    expect(() => getEnv()).toThrow(/Invalid environment configuration/);
  });

  it("does not log secrets in gate errors", () => {
    try {
      assertRealSmtpAllowed({ isTestMode: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      expect(message).not.toContain(TEST_ONLY_AUTH_SECRET);
      expect(message.toLowerCase()).not.toContain("password");
    }
  });
});

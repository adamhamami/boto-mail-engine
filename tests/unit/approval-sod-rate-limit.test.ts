import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { assertApproverIsNotCreator } from "@/lib/compliance/approval-gates";
import { ForbiddenError } from "@/lib/errors";
import {
  consumeRateLimit,
  resetRateLimiters,
} from "@/lib/api/rate-limit";
import { resetEnvCache, TEST_ONLY_AUTH_SECRET } from "@/lib/config/env";

describe("Approval separation of duties", () => {
  it("allows a different approver", () => {
    expect(() =>
      assertApproverIsNotCreator("creator-1", "approver-2"),
    ).not.toThrow();
  });

  it("allows missing createdById", () => {
    expect(() => assertApproverIsNotCreator(null, "approver-2")).not.toThrow();
    expect(() =>
      assertApproverIsNotCreator(undefined, "approver-2"),
    ).not.toThrow();
  });

  it("forbids creator self-approval", () => {
    expect(() => assertApproverIsNotCreator("same-id", "same-id")).toThrow(
      ForbiddenError,
    );
  });
});

describe("Login rate limiting key", () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...snapshot,
      NODE_ENV: "test",
      AUTH_SECRET: TEST_ONLY_AUTH_SECRET,
      LOGIN_RATE_LIMIT_MAX: "2",
      LOGIN_RATE_LIMIT_WINDOW_MS: "60000",
      RATE_LIMIT_MAX_REQUESTS: "100",
      RATE_LIMIT_WINDOW_MS: "60000",
    };
    resetEnvCache();
    resetRateLimiters();
  });

  afterEach(() => {
    process.env = { ...snapshot };
    resetEnvCache();
    resetRateLimiters();
  });

  it("blocks after max attempts for the same login identifier", async () => {
    const id = `login-test-${Date.now()}-${Math.random()}`;
    expect((await consumeRateLimit("login", id)).allowed).toBe(true);
    expect((await consumeRateLimit("login", id)).allowed).toBe(true);
    expect((await consumeRateLimit("login", id)).allowed).toBe(false);
  });

  it("uses dedicated login limits independent of generic RATE_LIMIT_MAX", async () => {
    process.env.LOGIN_RATE_LIMIT_MAX = "1";
    resetEnvCache();
    resetRateLimiters();
    const id = `login-dedicated-${Date.now()}`;
    expect((await consumeRateLimit("login", id)).allowed).toBe(true);
    expect((await consumeRateLimit("login", id)).allowed).toBe(false);
    // Generic bucket still open
    expect((await consumeRateLimit("webhook-mail", id)).allowed).toBe(true);
  });
});

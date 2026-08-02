import { describe, it, expect, afterEach } from "vitest";
import { computeExponentialBackoffMs } from "@/lib/queue";
import { resetEnvCache, TEST_ONLY_AUTH_SECRET } from "@/lib/config/env";
import {
  installGracefulShutdown,
  resetShutdownStateForTests,
} from "@/lib/ha/graceful-shutdown";

describe("Phase 6 HA — backoff exponentiel + jitter", () => {
  const snapshot = { ...process.env };

  afterEach(() => {
    process.env = { ...snapshot };
    resetEnvCache();
  });

  it("grows exponentially without jitter", () => {
    process.env = {
      ...snapshot,
      AUTH_SECRET: TEST_ONLY_AUTH_SECRET,
      NODE_ENV: "test",
    };
    resetEnvCache();

    expect(computeExponentialBackoffMs(1, 1000, 0)).toBe(1000);
    expect(computeExponentialBackoffMs(2, 1000, 0)).toBe(2000);
    expect(computeExponentialBackoffMs(3, 1000, 0)).toBe(4000);
    expect(computeExponentialBackoffMs(4, 1000, 0)).toBe(8000);
  });

  it("adds jitter in [0, jitterMs]", () => {
    process.env = {
      ...snapshot,
      AUTH_SECRET: TEST_ONLY_AUTH_SECRET,
      NODE_ENV: "test",
    };
    resetEnvCache();

    for (let i = 0; i < 20; i++) {
      const delay = computeExponentialBackoffMs(1, 1000, 500);
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(1500);
    }
  });

  it("caps at 1 hour", () => {
    expect(computeExponentialBackoffMs(20, 60_000, 0)).toBe(3_600_000);
  });
});

describe("Phase 6 HA — graceful shutdown", () => {
  afterEach(() => {
    resetShutdownStateForTests();
  });

  it("runs hooks in order without exiting", async () => {
    const order: string[] = [];
    const run = installGracefulShutdown({
      timeoutMs: 5_000,
      exitProcess: false,
      hooks: [
        () => {
          order.push("a");
        },
        async () => {
          order.push("b");
        },
      ],
    });

    await run();
    expect(order).toEqual(["a", "b"]);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebhookEventStatus } from "@/generated/prisma/client";
import { resetEnvCache, TEST_ONLY_AUTH_SECRET } from "@/lib/config/env";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    webhookEvent: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/queue", () => ({
  QUEUE_NAMES: { WEBHOOK_PROCESS: "webhook-process" },
  getQueue: vi.fn(() => ({
    add: vi.fn().mockResolvedValue({ id: "job-1" }),
  })),
}));

import { prisma } from "@/lib/db/prisma";
import { getQueue } from "@/lib/queue";
import { ingestNormalizedEvent } from "@/lib/inbound/ingest";
import { Prisma } from "@/generated/prisma/client";

describe("ingestNormalizedEvent idempotence", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = TEST_ONLY_AUTH_SECRET;
    process.env.WEBHOOK_SECRET = "test-only-webhook-secret-do-not-use-in-prod!!";
    resetEnvCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetEnvCache();
  });

  it("stores once and enqueues", async () => {
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({
      id: "wh-new",
      provider: "test",
      providerEventId: "evt-1",
      eventType: "EMAIL_DELIVERED",
      payload: {},
      status: WebhookEventStatus.PENDING,
      processedAt: null,
      errorMessage: null,
      createdAt: new Date(),
    } as never);

    const result = await ingestNormalizedEvent({
      provider: "test",
      providerEventId: "evt-1",
      type: "EMAIL_DELIVERED",
      timestamp: new Date(),
    });

    expect(result.duplicate).toBe(false);
    expect(result.enqueued).toBe(true);
    expect(getQueue).toHaveBeenCalled();
  });

  it("treats unique constraint as replay — single logical event", async () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique", {
      code: "P2002",
      clientVersion: "test",
    });
    vi.mocked(prisma.webhookEvent.create).mockRejectedValue(err);
    vi.mocked(prisma.webhookEvent.findUnique).mockResolvedValue({
      id: "wh-existing",
      provider: "test",
      providerEventId: "evt-1",
      eventType: "EMAIL_DELIVERED",
      payload: {},
      status: WebhookEventStatus.PROCESSED,
      processedAt: new Date(),
      errorMessage: null,
      createdAt: new Date(),
    } as never);

    const add = vi.fn();
    vi.mocked(getQueue).mockReturnValue({ add } as never);

    const result = await ingestNormalizedEvent({
      provider: "test",
      providerEventId: "evt-1",
      type: "EMAIL_DELIVERED",
      timestamp: new Date(),
    });

    expect(result.duplicate).toBe(true);
    expect(result.webhookEventId).toBe("wh-existing");
    expect(result.enqueued).toBe(false);
    expect(add).not.toHaveBeenCalled();
  });
});

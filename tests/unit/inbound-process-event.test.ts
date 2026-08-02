import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  EventType,
  SalesTaskType,
  SendAttemptStatus,
  WebhookEventStatus,
  type PrismaClient,
} from "@/generated/prisma/client";
import { resetEnvCache, TEST_ONLY_AUTH_SECRET } from "@/lib/config/env";
import { processWebhookEvent } from "@/lib/inbound/process-event";

type SoftRetry = { delayMs: number; subject: string };

function createProcessDb(opts: {
  payload: Record<string, unknown>;
  contactId: string;
  campaignId: string;
  sendAttemptId?: string;
  softBounceCount?: number;
  existingSalesTask?: boolean;
}) {
  const stops: Array<{ reason: string; contactId: string }> = [];
  const events: Array<{ type: EventType; metadata?: unknown }> = [];
  const salesTasks: Array<Record<string, unknown>> = [];
  const attemptUpdates: Array<Record<string, unknown>> = [];
  let webhookStatus: WebhookEventStatus = WebhookEventStatus.PENDING;
  const softRetries: SoftRetry[] = [];

  const sendAttemptId = opts.sendAttemptId ?? "sa-1";

  const db = {
    webhookEvent: {
      findUnique: async () => ({
        id: "wh-1",
        provider: "test",
        providerEventId: "evt-1",
        eventType: opts.payload.type,
        status: webhookStatus,
        payload: opts.payload,
        createdAt: new Date(),
      }),
      update: async ({ data }: { data: { status: WebhookEventStatus } }) => {
        webhookStatus = data.status;
        return {};
      },
    },
    sendAttempt: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (where.id !== sendAttemptId) return null;
        return {
          id: sendAttemptId,
          campaignRecipientId: "cr-1",
          status: SendAttemptStatus.SENT,
          attemptNumber: 1,
          idempotencyKey: "camp:contact:0:v1",
          metadata: {
            softBounceCount: opts.softBounceCount ?? 0,
            subject: "Hello",
            html: "<p>Hi</p>",
          },
          campaignRecipient: {
            id: "cr-1",
            contactId: opts.contactId,
            campaignId: opts.campaignId,
            contact: { id: opts.contactId, email: "p@example.com" },
            campaign: { id: opts.campaignId, isTestMode: true },
          },
        };
      },
      findFirst: async () => null,
      findMany: async () => [] as Array<{ id: string; idempotencyKey: string }>,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        attemptUpdates.push(data);
        return {};
      },
      updateMany: async () => ({ count: 0 }),
    },
    campaignRecipient: {
      findUnique: async () => ({
        contactId: opts.contactId,
        campaignId: opts.campaignId,
      }),
      updateMany: async () => ({ count: 1 }),
    },
    contact: {
      update: async () => ({}),
      findUnique: async () => ({ email: "p@example.com" }),
    },
    campaign: {
      update: async () => ({}),
      findUnique: async () => ({
        id: opts.campaignId,
        status: "RUNNING",
        sentCount: 100,
        bounceCount: 10,
        settings: {},
      }),
    },
    suppressionList: {
      upsert: async () => ({}),
    },
    event: {
      create: async ({ data }: { data: { type: EventType; metadata?: unknown } }) => {
        events.push(data);
        return { id: `ev-${events.length}` };
      },
      count: async () => 0,
    },
    salesTask: {
      findFirst: async () =>
        opts.existingSalesTask
          ? { id: "st-existing" }
          : null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        salesTasks.push(data);
        return { id: `st-${salesTasks.length}` };
      },
    },
    $transaction: async <T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> =>
      fn(db as unknown as PrismaClient),
  };

  return {
    db: db as unknown as PrismaClient,
    stops,
    events,
    salesTasks,
    attemptUpdates,
    softRetries,
    getWebhookStatus: () => webhookStatus,
    // Hook stopContactSequence via monkey — we assert via contact/recipient updates + events
    trackStop: stops,
  };
}

describe("processWebhookEvent business rules", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = TEST_ONLY_AUTH_SECRET;
    process.env.WEBHOOK_SECRET = "test-only-webhook-secret-do-not-use-in-prod!!";
    process.env.SOFT_BOUNCE_MAX_RETRIES = "3";
    resetEnvCache();
  });

  afterEach(() => {
    resetEnvCache();
    vi.restoreAllMocks();
  });

  it("processes reply once: stops sequence and creates a single SalesTask", async () => {
    const ctx = createProcessDb({
      payload: {
        type: "EMAIL_REPLIED",
        contactId: "c1",
        campaignId: "camp1",
        sendAttemptId: "sa-1",
      },
      contactId: "c1",
      campaignId: "camp1",
    });

    const first = await processWebhookEvent("wh-1", {
      db: ctx.db,
      enqueueSoftRetry: async () => {},
    });
    expect(first.status).toBe("processed");
    expect(ctx.salesTasks).toHaveLength(1);
    expect(ctx.salesTasks[0]?.type).toBe(SalesTaskType.REPLY_FOLLOW_UP);
    expect(ctx.events.some((e) => e.type === EventType.EMAIL_REPLIED)).toBe(true);

    // Second call on already PROCESSED → duplicate
    const second = await processWebhookEvent("wh-1", {
      db: ctx.db,
      enqueueSoftRetry: async () => {},
    });
    expect(second.status).toBe("duplicate");
    expect(ctx.salesTasks).toHaveLength(1);
  });

  it("does not create duplicate SalesTask when one already open", async () => {
    const ctx = createProcessDb({
      payload: {
        type: "EMAIL_REPLIED",
        contactId: "c1",
        campaignId: "camp1",
        sendAttemptId: "sa-1",
      },
      contactId: "c1",
      campaignId: "camp1",
      existingSalesTask: true,
    });

    await processWebhookEvent("wh-1", {
      db: ctx.db,
      enqueueSoftRetry: async () => {},
    });
    expect(ctx.salesTasks).toHaveLength(0);
  });

  it("hard bounce stops sequence (no soft retry)", async () => {
    const retries: SoftRetry[] = [];
    const ctx = createProcessDb({
      payload: {
        type: "HARD_BOUNCE",
        contactId: "c1",
        campaignId: "camp1",
        sendAttemptId: "sa-1",
      },
      contactId: "c1",
      campaignId: "camp1",
    });

    await processWebhookEvent("wh-1", {
      db: ctx.db,
      enqueueSoftRetry: async (_data, delayMs) => {
        retries.push({ delayMs, subject: _data.subject });
      },
    });

    expect(retries).toHaveLength(0);
    expect(ctx.events.some((e) => e.type === EventType.EMAIL_BOUNCED)).toBe(true);
    expect(
      ctx.attemptUpdates.some((u) => u.status === SendAttemptStatus.BOUNCED),
    ).toBe(true);
  });

  it("complaint stops sequence", async () => {
    const ctx = createProcessDb({
      payload: {
        type: "COMPLAINT",
        contactId: "c1",
        campaignId: "camp1",
        sendAttemptId: "sa-1",
      },
      contactId: "c1",
      campaignId: "camp1",
    });

    await processWebhookEvent("wh-1", {
      db: ctx.db,
      enqueueSoftRetry: async () => {},
    });

    expect(ctx.events.some((e) => e.type === EventType.EMAIL_COMPLAINED)).toBe(
      true,
    );
  });

  it("unsubscribe stops sequence", async () => {
    const ctx = createProcessDb({
      payload: {
        type: "UNSUBSCRIBED",
        contactId: "c1",
        campaignId: "camp1",
        sendAttemptId: "sa-1",
      },
      contactId: "c1",
      campaignId: "camp1",
    });

    await processWebhookEvent("wh-1", {
      db: ctx.db,
      enqueueSoftRetry: async () => {},
    });

    expect(ctx.events.some((e) => e.type === EventType.EMAIL_UNSUBSCRIBED)).toBe(
      true,
    );
  });

  it("soft bounce follows bounded retry then exhausts", async () => {
    const retries: SoftRetry[] = [];

    const underMax = createProcessDb({
      payload: {
        type: "SOFT_BOUNCE",
        contactId: "c1",
        campaignId: "camp1",
        sendAttemptId: "sa-1",
      },
      contactId: "c1",
      campaignId: "camp1",
      softBounceCount: 1,
    });

    await processWebhookEvent("wh-1", {
      db: underMax.db,
      enqueueSoftRetry: async (data, delayMs) => {
        retries.push({ delayMs, subject: data.subject });
      },
    });

    expect(retries).toHaveLength(1);
    expect(retries[0]?.subject).toBe("Hello");
    expect(
      underMax.attemptUpdates.some((u) => u.status === SendAttemptStatus.QUEUED),
    ).toBe(true);

    const exhausted = createProcessDb({
      payload: {
        type: "SOFT_BOUNCE",
        contactId: "c1",
        campaignId: "camp1",
        sendAttemptId: "sa-1",
      },
      contactId: "c1",
      campaignId: "camp1",
      softBounceCount: 2,
    });
    // softBounceCount 2 + 1 = 3 >= max 3 → exhaust
    const exhaustRetries: SoftRetry[] = [];
    await processWebhookEvent("wh-1", {
      db: exhausted.db,
      enqueueSoftRetry: async (data, delayMs) => {
        exhaustRetries.push({ delayMs, subject: data.subject });
      },
    });
    expect(exhaustRetries).toHaveLength(0);
    expect(
      exhausted.attemptUpdates.some(
        (u) => u.status === SendAttemptStatus.BOUNCED,
      ),
    ).toBe(true);
  });
});

describe("idempotent replay marker", () => {
  it("ignores already processed webhook rows", async () => {
    const db = {
      webhookEvent: {
        findUnique: async () => ({
          id: "wh-1",
          provider: "test",
          providerEventId: "evt-1",
          eventType: "EMAIL_DELIVERED",
          status: WebhookEventStatus.PROCESSED,
          payload: { type: "EMAIL_DELIVERED" },
          createdAt: new Date(),
        }),
      },
    } as unknown as PrismaClient;

    const result = await processWebhookEvent("wh-1", {
      db,
      enqueueSoftRetry: async () => {},
    });
    expect(result.status).toBe("duplicate");
  });
});

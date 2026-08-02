import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  CampaignStatus,
  ContactStatus,
  RecipientStepStatus,
  SendAttemptStatus,
  type PrismaClient,
} from "@/generated/prisma/client";
import { resetEnvCache, TEST_ONLY_AUTH_SECRET } from "@/lib/config/env";
import { FakeMailProvider } from "@/lib/mail/fake-provider";
import { processEmailSend } from "@/workers/process-email-send";
import {
  FakeClock,
  resetClock,
  setClock,
} from "@/lib/campaign-engine/clock";
import {
  MemoryQuotaStore,
  setQuotaStore,
} from "@/lib/campaign-engine/quotas";
import { maybeCompleteCampaign } from "@/lib/campaign-engine/completion";
import { zonedCivilToUtc } from "@/lib/campaign-engine/timezone";
import type { EmailSendJobData } from "@/lib/queue";

describe("Phase 4 completion + SMTP/DB recovery", () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...snapshot,
      NODE_ENV: "test",
      DRY_RUN: "false",
      PRODUCTION_SENDING_ENABLED: "true",
      ALLOW_TEST_SMTP: "true",
      TEST_EMAIL_ALLOWLIST: "qa@botoschool.ma",
      SMTP_ALLOWED_NODE_ENVS: "test",
      AUTH_SECRET: TEST_ONLY_AUTH_SECRET,
      SEND_QUOTA_PER_HOUR: "1000",
      SEND_QUOTA_PER_DAY: "10000",
      SEND_QUOTA_PER_CONNECTOR: "1000",
      SEND_QUOTA_PER_SENDER_DOMAIN: "10000",
      SEND_QUOTA_PER_CAMPAIGN: "1000",
      CAMPAIGN_DEFAULT_TIMEZONE: "Africa/Casablanca",
      SEND_WINDOW_START_HOUR: "0",
      SEND_WINDOW_END_HOUR: "24",
      SEND_WINDOW_WEEKDAYS: "0,1,2,3,4,5,6",
    };
    resetEnvCache();
    setQuotaStore(new MemoryQuotaStore());
    setClock(
      new FakeClock(
        zonedCivilToUtc(
          { year: 2026, month: 3, day: 2, hour: 10 },
          "Africa/Casablanca",
        ),
      ),
    );
  });

  afterEach(() => {
    process.env = { ...snapshot };
    resetEnvCache();
    setQuotaStore(null);
    resetClock();
  });

  it("resumes DB finalize after SMTP accepted (no double SMTP)", async () => {
    const fake = new FakeMailProvider();
    let meta: Record<string, unknown> = {
      smtpAccepted: true,
      providerMessageId: "msg-already",
      provider: "fake",
      dryRun: false,
    };
    const updates: Array<Record<string, unknown>> = [];

    const db = {
      sendAttempt: {
        findUnique: async () => ({
          id: "att-1",
          status: SendAttemptStatus.PROCESSING,
          metadata: meta,
          campaignRecipient: {
            id: "rec-1",
            isStopped: false,
            isSent: false,
            campaign: {
              id: "camp-1",
              status: CampaignStatus.RUNNING,
              isTestMode: true,
              settings: {},
            },
            contact: {
              id: "ct-1",
              email: "qa@botoschool.ma",
              status: ContactStatus.ELIGIBLE,
              source: "internal",
              consentBase: "test",
              deletedAt: null,
              isDuplicate: false,
            },
          },
        }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          if (data.metadata) meta = data.metadata as Record<string, unknown>;
          if (typeof data.status === "string") {
            /* ignore */
          }
          return {};
        },
      },
      suppressionList: { findUnique: async () => null },
      campaignRecipient: {
        update: async () => ({}),
        count: async () => 0,
        findMany: async () => [],
      },
      campaign: {
        update: async () => ({}),
        updateMany: async () => ({ count: 0 }),
        findUnique: async () => ({
          id: "camp-1",
          status: CampaignStatus.RUNNING,
          sequence: { steps: [{ stepOrder: 0 }] },
        }),
      },
      contact: {
        findUnique: async () => ({ status: ContactStatus.ELIGIBLE }),
      },
      event: { create: async () => ({}), count: async () => 0 },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    } as unknown as PrismaClient;

    const job: EmailSendJobData = {
      sendAttemptId: "att-1",
      campaignRecipientId: "rec-1",
      contactEmail: "qa@botoschool.ma",
      subject: "Hi",
      html: "<p>Hi</p>",
      idempotencyKey: "idem-1",
    };

    await processEmailSend(job, { db, getProvider: () => fake });
    expect(fake.sent).toHaveLength(0);
    expect(updates.some((u) => u.status === SendAttemptStatus.SENT)).toBe(true);
  });

  it("auto-completes when no open recipients remain", async () => {
    let completed = false;
    const db = {
      campaign: {
        findUnique: async () => ({
          id: "camp-1",
          status: CampaignStatus.RUNNING,
          sequence: { steps: [{ stepOrder: 0 }] },
        }),
        updateMany: async () => {
          completed = true;
          return { count: 1 };
        },
      },
      campaignRecipient: {
        count: async () => 0,
        // Phase 11 : un seul findMany (recipients + contact.status)
        findMany: async () => [
          {
            contactId: "c1",
            status: RecipientStepStatus.SENT,
            isStopped: false,
            isSent: true,
            sequenceStep: 0,
            contact: { status: ContactStatus.IN_SEQUENCE },
          },
        ],
      },
    } as unknown as PrismaClient;

    const result = await maybeCompleteCampaign("camp-1", { db });
    expect(result.completed).toBe(true);
    expect(completed).toBe(true);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  CampaignStatus,
  ContactStatus,
  SendAttemptStatus,
  type PrismaClient,
} from "@/generated/prisma/client";
import { resetEnvCache, TEST_ONLY_AUTH_SECRET } from "@/lib/config/env";
import { FakeMailProvider } from "@/lib/mail/fake-provider";
import { processEmailSend } from "@/workers/process-email-send";
import type { EmailSendJobData } from "@/lib/queue";
import {
  FakeClock,
  resetClock,
  setClock,
} from "@/lib/campaign-engine/clock";
import {
  MemoryQuotaStore,
  setQuotaStore,
} from "@/lib/campaign-engine/quotas";
import { zonedCivilToUtc } from "@/lib/campaign-engine/timezone";

type AttemptState = {
  id: string;
  status: SendAttemptStatus;
  updates: Array<Record<string, unknown>>;
  campaign: {
    id: string;
    status: CampaignStatus;
    isTestMode: boolean;
    settings?: Record<string, unknown>;
  };
  recipient: {
    id: string;
    isStopped: boolean;
    isSent: boolean;
    stopReason: string | null;
  };
  contact: {
    id: string;
    email: string;
    status: ContactStatus;
    source: string | null;
    consentBase: string | null;
    deletedAt: Date | null;
    isDuplicate: boolean;
  };
  suppressed: boolean;
};

function noopSendLock() {
  return {
    acquireSendLock: async () => ({
      key: "test-lock",
      token: "test",
      release: async () => true,
    }),
  };
}

function createMockDb(state: AttemptState): PrismaClient {
  const db = {
    sendAttempt: {
      findUnique: async () => ({
        id: state.id,
        status: state.status,
        metadata: {},
        campaignRecipient: {
          id: state.recipient.id,
          isStopped: state.recipient.isStopped,
          isSent: state.recipient.isSent,
          stopReason: state.recipient.stopReason,
          campaign: {
            ...state.campaign,
            settings: state.campaign.settings ?? {},
          },
          contact: state.contact,
        },
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.updates.push(data);
        if (typeof data.status === "string") {
          state.status = data.status as SendAttemptStatus;
        }
        return {};
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id?: string; status?: { in?: SendAttemptStatus[] } };
        data: Record<string, unknown>;
      }) => {
        const allowed = where.status?.in;
        if (allowed && !allowed.includes(state.status)) {
          return { count: 0 };
        }
        state.updates.push(data);
        if (typeof data.status === "string") {
          state.status = data.status as SendAttemptStatus;
        }
        return { count: 1 };
      },
    },
    suppressionList: {
      findUnique: async () => (state.suppressed ? { id: "sup-1" } : null),
    },
    campaignRecipient: {
      update: async () => ({}),
      count: async () => 0,
      findMany: async () => [],
    },
    campaign: {
      update: async () => ({}),
      updateMany: async () => ({ count: 0 }),
      findUnique: async () => ({
        id: state.campaign.id,
        status: state.campaign.status,
        sequence: { steps: [] },
      }),
    },
    contact: {
      findUnique: async () => state.contact,
    },
    event: {
      create: async () => ({}),
      count: async () => 0,
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };

  return db as unknown as PrismaClient;
}

function jobData(attemptId: string, recipientId: string): EmailSendJobData {
  return {
    sendAttemptId: attemptId,
    campaignRecipientId: recipientId,
    contactEmail: "qa@botoschool.ma",
    subject: "Hello",
    html: "<p>Hi</p>",
    text: "Hi",
    idempotencyKey: "idem-1",
  };
}

describe("processEmailSend Phase 1", () => {
  const snapshot = { ...process.env };
  let fake: FakeMailProvider;
  let state: AttemptState;

  beforeEach(() => {
    process.env = {
      ...snapshot,
      NODE_ENV: "test",
      DRY_RUN: "true",
      PRODUCTION_SENDING_ENABLED: "false",
      ALLOW_TEST_SMTP: "false",
      TEST_EMAIL_ALLOWLIST: "qa@botoschool.ma",
      TEST_DOMAIN_ALLOWLIST: "botoschool.ma",
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

    fake = new FakeMailProvider();
    state = {
      id: "att-1",
      status: SendAttemptStatus.QUEUED,
      updates: [],
      campaign: {
        id: "camp-1",
        status: CampaignStatus.RUNNING,
        isTestMode: true,
      },
      recipient: {
        id: "rec-1",
        isStopped: false,
        isSent: false,
        stopReason: null,
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
      suppressed: false,
    };
  });

  afterEach(() => {
    process.env = { ...snapshot };
    resetEnvCache();
    setQuotaStore(null);
    resetClock();
  });

  it("DRY_RUN=true never calls the mail provider (including test campaign)", async () => {
    await processEmailSend(jobData("att-1", "rec-1"), {
      db: createMockDb(state),
      getProvider: () => fake,
      ...noopSendLock(),
    });

    expect(fake.sent).toHaveLength(0);
    expect(state.updates.some((u) => u.status === SendAttemptStatus.SENT)).toBe(
      true,
    );
  });

  it("does not send when contact became RESPONDED after enqueue", async () => {
    state.campaign.isTestMode = false;
    state.contact.status = ContactStatus.RESPONDED;
    process.env.DRY_RUN = "false";
    process.env.PRODUCTION_SENDING_ENABLED = "true";
    resetEnvCache();

    await processEmailSend(jobData("att-1", "rec-1"), {
      db: createMockDb(state),
      getProvider: () => fake,
      ...noopSendLock(),
    });

    expect(fake.sent).toHaveLength(0);
    expect(
      state.updates.some((u) => u.status === SendAttemptStatus.SKIPPED),
    ).toBe(true);
  });

  it("does not send when email was unsubscribed after enqueue", async () => {
    state.campaign.isTestMode = false;
    state.suppressed = true;
    process.env.DRY_RUN = "false";
    process.env.PRODUCTION_SENDING_ENABLED = "true";
    resetEnvCache();

    await processEmailSend(jobData("att-1", "rec-1"), {
      db: createMockDb(state),
      getProvider: () => fake,
      ...noopSendLock(),
    });

    expect(fake.sent).toHaveLength(0);
    expect(
      state.updates.some((u) => u.status === SendAttemptStatus.SKIPPED),
    ).toBe(true);
  });

  it("does not send when campaign was paused after enqueue", async () => {
    state.campaign.status = CampaignStatus.PAUSED;
    process.env.DRY_RUN = "false";
    process.env.ALLOW_TEST_SMTP = "true";
    resetEnvCache();

    await processEmailSend(jobData("att-1", "rec-1"), {
      db: createMockDb(state),
      getProvider: () => fake,
      ...noopSendLock(),
    });

    expect(fake.sent).toHaveLength(0);
    expect(
      state.updates.some((u) => u.status === SendAttemptStatus.SKIPPED),
    ).toBe(true);
  });

  it("never writes secrets into skip metadata", async () => {
    state.contact.email = "outsider@ecole.ma";
    await processEmailSend(jobData("att-1", "rec-1"), {
      db: createMockDb(state),
      getProvider: () => fake,
      ...noopSendLock(),
    });

    const payload = JSON.stringify(state.updates);
    expect(payload).not.toContain(TEST_ONLY_AUTH_SECRET);
    expect(payload.toLowerCase()).not.toContain("smtp_password");
  });
});

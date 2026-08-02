/**
 * Smoke test automatisation email (DRY_RUN) — aucun SMTP réel.
 * Usage: npx tsx scripts/smoke-email-automation.ts
 */
import "dotenv/config";
import {
  CampaignStatus,
  ContactStatus,
  SendAttemptStatus,
  type PrismaClient,
} from "../src/generated/prisma/client";
import { resetEnvCache, TEST_ONLY_AUTH_SECRET } from "../src/lib/config/env";
import { FakeMailProvider } from "../src/lib/mail/fake-provider";
import { processEmailSend } from "../src/workers/process-email-send";
import {
  FakeClock,
  resetClock,
  setClock,
} from "../src/lib/campaign-engine/clock";
import {
  MemoryQuotaStore,
  setQuotaStore,
} from "../src/lib/campaign-engine/quotas";
import { zonedCivilToUtc } from "../src/lib/campaign-engine/timezone";
import { getOpsHealthReport } from "../src/lib/observability/ops-health";
import { getQueue, QUEUE_NAMES, type EmailSendJobData } from "../src/lib/queue";
import { getRedisConnection } from "../src/lib/queue";
import { prisma } from "../src/lib/db/prisma";

type Result = { name: string; ok: boolean; detail: string };

const results: Result[] = [];

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

function createMockDb(): PrismaClient {
  const state = {
    status: SendAttemptStatus.QUEUED as SendAttemptStatus,
    updates: [] as Array<Record<string, unknown>>,
  };

  return {
    sendAttempt: {
      findUnique: async () => ({
        id: "smoke-att-1",
        status: state.status,
        metadata: {},
        campaignRecipient: {
          id: "smoke-rec-1",
          isStopped: false,
          isSent: false,
          stopReason: null,
          campaign: {
            id: "smoke-camp-1",
            status: CampaignStatus.RUNNING,
            isTestMode: true,
            settings: {},
          },
          contact: {
            id: "smoke-ct-1",
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
        state.updates.push(data);
        if (typeof data.status === "string") {
          state.status = data.status as SendAttemptStatus;
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
        id: "smoke-camp-1",
        status: CampaignStatus.RUNNING,
        sequence: { steps: [{ stepOrder: 0 }] },
      }),
    },
    contact: {
      findUnique: async () => ({ status: ContactStatus.ELIGIBLE }),
    },
    event: { create: async () => ({}), count: async () => 0 },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    get __updates() {
      return state.updates;
    },
  } as unknown as PrismaClient & { __updates: Array<Record<string, unknown>> };
}

async function main() {
  const snapshot = { ...process.env };
  process.env = {
    ...snapshot,
    NODE_ENV: "test",
    DRY_RUN: "true",
    PRODUCTION_SENDING_ENABLED: "false",
    ALLOW_TEST_SMTP: "true",
    TEST_EMAIL_ALLOWLIST: "qa@botoschool.ma",
    SMTP_ALLOWED_NODE_ENVS: "test",
    AUTH_SECRET: process.env.AUTH_SECRET || TEST_ONLY_AUTH_SECRET,
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

  // 1) Infra
  try {
    await prisma.$queryRaw`SELECT 1`;
    record("Postgres", true, "SELECT 1 OK");
  } catch (e) {
    record("Postgres", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const pong = await getRedisConnection().ping();
    record("Redis", pong === "PONG", `ping=${pong}`);
  } catch (e) {
    record("Redis", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const ops = await getOpsHealthReport("smoke-email");
    record(
      "Ops health",
      ops.checks.database && ops.checks.redis,
      `status=${ops.status} dryRun=${ops.checks.provider.dryRun} emailWaiting=${ops.queues.emailSend.waiting}`,
    );
  } catch (e) {
    record("Ops health", false, e instanceof Error ? e.message : String(e));
  }

  // 2) Worker path DRY_RUN — FakeMail ne doit PAS être appelé
  const fake = new FakeMailProvider();
  const db = createMockDb() as PrismaClient & {
    __updates: Array<Record<string, unknown>>;
  };
  const job: EmailSendJobData = {
    sendAttemptId: "smoke-att-1",
    campaignRecipientId: "smoke-rec-1",
    contactEmail: "qa@botoschool.ma",
    subject: "Smoke automation",
    html: "<p>Smoke</p>",
    idempotencyKey: `smoke-idem-${Date.now()}`,
  };

  try {
    await processEmailSend(job, { db, getProvider: () => fake });
    const sent = db.__updates.some((u) => u.status === SendAttemptStatus.SENT);
    const dryMeta = db.__updates.some((u) => {
      const meta = u.metadata as Record<string, unknown> | undefined;
      return meta?.dryRun === true || meta?.provider === "dry-run";
    });
    record(
      "processEmailSend DRY_RUN",
      sent && fake.sent.length === 0,
      `SENT=${sent} fakeSmtpCalls=${fake.sent.length} dryMeta=${dryMeta}`,
    );
  } catch (e) {
    record(
      "processEmailSend DRY_RUN",
      false,
      e instanceof Error ? e.message : String(e),
    );
  }

  // 3) Enqueue BullMQ (job éphémère, retiré après)
  const smokeJobId = `smoke-enqueue-${Date.now()}`;
  try {
    const queue = getQueue(QUEUE_NAMES.EMAIL_SEND);
    await queue.add(
      "send-email",
      {
        ...job,
        sendAttemptId: "smoke-att-noop",
        idempotencyKey: smokeJobId,
      },
      { jobId: smokeJobId, delay: 60_000 },
    );
    const found = await queue.getJob(smokeJobId);
    record(
      "BullMQ enqueue",
      Boolean(found),
      found ? `jobId=${found.id} delay=60s` : "job missing",
    );
    if (found) {
      await found.remove();
      record("BullMQ cleanup", true, "job removed");
    }
  } catch (e) {
    record("BullMQ enqueue", false, e instanceof Error ? e.message : String(e));
  }

  // Restore
  process.env = snapshot;
  resetEnvCache();
  setQuotaStore(null);
  resetClock();

  const failed = results.filter((r) => !r.ok);
  console.log("\n=== SUMMARY ===");
  console.log(
    JSON.stringify(
      {
        passed: results.filter((r) => r.ok).length,
        failed: failed.length,
        dryRunForced: true,
        smtpReal: false,
        results,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect().catch(() => undefined);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

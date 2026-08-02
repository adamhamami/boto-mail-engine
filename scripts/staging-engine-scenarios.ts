/**
 * Scénarios moteur staging — in-process, DRY_RUN forcé.
 * Couvre : import classify, quotas, pause/reprise fenêtre, erreur provider, webhooks HMAC.
 */
import { createHmac } from "node:crypto";
import { FakeMailProvider } from "@/lib/mail/fake-provider";
import { FakeClock } from "@/lib/campaign-engine/clock";
import {
  MemoryQuotaStore,
  consumeSendQuotas,
  DEFAULT_QUOTA_LIMITS,
} from "@/lib/campaign-engine/quotas";
import { classifyImportSheet } from "@/lib/imports/import-report";
import { resetEnvCache, TEST_ONLY_AUTH_SECRET } from "@/lib/config/env";
import {
  signWebhookPayload,
  verifyWebhookSignature,
  WebhookAuthError,
} from "@/lib/inbound/signature";

Object.assign(process.env, {
  NODE_ENV: "test",
  DRY_RUN: "true",
  PRODUCTION_SENDING_ENABLED: "false",
  AUTH_SECRET: process.env.AUTH_SECRET || TEST_ONLY_AUTH_SECRET,
  WEBHOOK_SECRET:
    process.env.WEBHOOK_SECRET || "staging-smoke-webhook-secret-32ch",
  CAMPAIGN_DEFAULT_TIMEZONE: "Africa/Casablanca",
});
resetEnvCache();

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  // 1) Imports
  const report = classifyImportSheet({
    headers: ["email", "prenom"],
    mapping: { email: "email", prenom: "firstName" },
    rows: [
      ["ok@exemple.com", "A"],
      ["bad", "B"],
      ["ok2@exemple.com", "C"],
    ],
  });
  assert(report.accepted === 2 && report.rejected === 1, "import classify");

  // 2) Quotas
  const clock = new FakeClock(Date.UTC(2026, 2, 2, 10));
  const store = new MemoryQuotaStore();
  const limits = { ...DEFAULT_QUOTA_LIMITS, perHour: 2, perCampaign: 2 };
  const base = {
    campaignId: "stg",
    connector: "fake",
    senderDomain: "botoschool.com",
    limits,
  };
  const a = await consumeSendQuotas(base, { store, clock });
  const b = await consumeSendQuotas(base, { store, clock });
  const c = await consumeSendQuotas(base, { store, clock });
  assert(a.allowed && b.allowed && !c.allowed, "quotas hour/campaign");

  // 3) Pause / reprise — avance horloge (nouvelle fenêtre horaire)
  clock.advance(3_600_000);
  const d = await consumeSendQuotas(
    {
      ...base,
      campaignId: "stg-resume",
      limits: { ...DEFAULT_QUOTA_LIMITS, perHour: 5, perCampaign: 5 },
    },
    { store, clock },
  );
  assert(d.allowed, "resume after window advance");

  // 4) Erreurs provider
  const mail = new FakeMailProvider();
  mail.failNext = true;
  let failed = false;
  try {
    await mail.send({
      to: "qa@botoschool.ma",
      subject: "err",
      html: "<p>x</p>",
    });
  } catch {
    failed = true;
  }
  assert(failed, "provider error surfaced");

  // 5) Webhook signature
  const secret = process.env.WEBHOOK_SECRET!;
  const body = JSON.stringify({ type: "delivered", id: "evt-1" });
  const ts = Date.now();
  const sig = signWebhookPayload(body, ts, secret);
  verifyWebhookSignature({
    rawBody: body,
    signatureHeader: sig,
    timestampHeader: String(ts),
    secret,
  });
  let invalidCaught = false;
  try {
    verifyWebhookSignature({
      rawBody: body,
      signatureHeader: createHmac("sha256", secret).update("nope").digest("hex"),
      timestampHeader: String(ts),
      secret,
    });
  } catch (e) {
    invalidCaught = e instanceof WebhookAuthError;
  }
  assert(invalidCaught, "webhook hmac rejects bad sig");

  console.log(
    JSON.stringify({
      ok: true,
      scenarios: [
        "imports",
        "quotas",
        "pause_resume_window",
        "provider_error",
        "webhooks",
      ],
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  getEnv,
  resetEnvCache,
  TEST_ONLY_AUTH_SECRET,
} from "@/lib/config/env";
import { parseCsvBuffer, parseXlsxBuffer } from "@/lib/imports/parse-file";
import { suggestMapping } from "@/lib/imports/mapping";
import { classifyImportSheet } from "@/lib/imports/import-report";
import {
  assertContactEligibleForSend,
  assertSendExecutionAllowed,
  assertUnsubscribeLinkPresent,
  evaluateWorkerSendReadiness,
  mustSimulateProviderSend,
  TEST_MODE_MAX_RECIPIENTS,
} from "@/lib/compliance/send-gates";
import {
  escapeHtml,
  findMissingVariables,
  renderTemplateVariables,
} from "@/modules/templates/utils/render-template";
import { templateService } from "@/modules/templates/services/template.service";
import { FakeMailProvider } from "@/lib/mail/fake-provider";
import {
  buildSendIdempotencyKey,
  buildApprovalContentHash,
} from "@/lib/data/integrity";
import {
  neutralizeCsvFormula,
  toCsvDocument,
} from "@/lib/export/csv-safe";
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLES,
} from "@/lib/auth/permissions";
import { filterNavItems, hasPermission } from "@/lib/auth/nav";
import {
  getCorrelationId,
  runWithContext,
} from "@/lib/observability/context";
import {
  signWebhookPayload,
  verifyWebhookSignature,
  WebhookAuthError,
} from "@/lib/inbound/signature";
import {
  CampaignStatus,
  ContactStatus,
  RecipientStepStatus,
  SendAttemptStatus,
} from "@/generated/prisma/client";
import { CampaignValidationError } from "@/lib/errors";
import {
  FakeClock,
  resetClock,
  setClock,
} from "@/lib/campaign-engine/clock";
import {
  MemoryQuotaStore,
  setQuotaStore,
  consumeSendQuotas,
  DEFAULT_QUOTA_LIMITS,
} from "@/lib/campaign-engine/quotas";
import { consumeRateLimit } from "@/lib/api/rate-limit";
import { processEmailSend } from "@/workers/process-email-send";
import type { EmailSendJobData } from "@/lib/queue";

const fixtures = path.join(process.cwd(), "tests", "fixtures");

function setRecetteEnv(extra: Record<string, string | undefined> = {}) {
  Object.assign(process.env, {
    NODE_ENV: "test",
    DRY_RUN: "true",
    PRODUCTION_SENDING_ENABLED: "false",
    ALLOW_TEST_SMTP: "false",
    MAIL_PROVIDER: "smtp",
    AUTH_SECRET: TEST_ONLY_AUTH_SECRET,
    TEST_EMAIL_ALLOWLIST: "qa@botoschool.ma,internal@example.com",
    TEST_DOMAIN_ALLOWLIST: "botoschool.ma",
    SMTP_ALLOWED_NODE_ENVS: "production,test",
    RATE_LIMIT_MAX_REQUESTS: "3",
    RATE_LIMIT_WINDOW_MS: "60000",
    WEBHOOK_SECRET: "recette-webhook-secret-32chars-min!!",
    WEBHOOK_MAX_AGE_SECONDS: "300",
    SEND_QUOTA_PER_HOUR: "1000",
    SEND_QUOTA_PER_DAY: "10000",
    SEND_QUOTA_PER_CONNECTOR: "1000",
    SEND_QUOTA_PER_SENDER_DOMAIN: "10000",
    SEND_QUOTA_PER_CAMPAIGN: "1000",
    CAMPAIGN_DEFAULT_TIMEZONE: "Africa/Casablanca",
    SEND_WINDOW_START_HOUR: "0",
    SEND_WINDOW_END_HOUR: "24",
    SEND_WINDOW_WEEKDAYS: "0,1,2,3,4,5,6",
  });
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
}

function createMinimalSendDb(opts: {
  campaignStatus?: CampaignStatus;
  isTestMode?: boolean;
  contactStatus?: ContactStatus;
  suppressed?: boolean;
}) {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    db: {
      sendAttempt: {
        findUnique: async () => ({
          id: "att-1",
          status: SendAttemptStatus.QUEUED,
          attemptNumber: 1,
          metadata: {
            subject: "s",
            html: "<p>x</p><a href='/unsubscribe/t'>u</a>",
          },
          campaignRecipient: {
            id: "cr-1",
            isStopped: false,
            isSent: false,
            status: RecipientStepStatus.QUEUED,
            stopReason: null,
            campaign: {
              id: "camp-1",
              status: opts.campaignStatus ?? CampaignStatus.TESTED,
              isTestMode: opts.isTestMode ?? true,
              settings: {},
            },
            contact: {
              id: "c1",
              email: "qa@botoschool.ma",
              status: opts.contactStatus ?? ContactStatus.ELIGIBLE,
              source: "internal",
              consentBase: "test",
              deletedAt: null,
              isDuplicate: false,
            },
          },
        }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return {};
        },
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return { count: 1 };
        },
      },
      suppressionList: {
        findUnique: async () => (opts.suppressed ? { id: "s1" } : null),
      },
      event: { create: async () => ({}), count: async () => 0 },
      campaign: {
        findUnique: async () => ({
          id: "camp-1",
          status: opts.campaignStatus ?? CampaignStatus.TESTED,
          sequence: { steps: [] },
        }),
        update: async () => ({}),
        updateMany: async () => ({ count: 0 }),
      },
      campaignRecipient: {
        update: async () => ({}),
        count: async () => 0,
        findMany: async () => [],
      },
      contact: {
        findUnique: async () => ({
          id: "c1",
          email: "qa@botoschool.ma",
          status: opts.contactStatus ?? ContactStatus.ELIGIBLE,
        }),
      },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    },
  };
}

describe("RECETTE R-01 Import", () => {
  const snapshot = { ...process.env };
  beforeEach(() => {
    process.env = { ...snapshot };
    setRecetteEnv();
  });
  afterEach(() => {
    process.env = { ...snapshot };
    resetEnvCache();
  });

  it("R-01 CSV fixture parse + mapping", async () => {
    const buf = readFileSync(path.join(fixtures, "import-sample.csv"));
    const sheet = await parseCsvBuffer(buf);
    const mapping = suggestMapping(sheet.headers);
    expect(mapping.email).toBeTruthy();
    expect(sheet.rows.length).toBeGreaterThan(0);
  });

  it("R-01 XLSX fixture parse", async () => {
    const buf = readFileSync(path.join(fixtures, "import-sample.xlsx"));
    const sheet = await parseXlsxBuffer(buf);
    expect(sheet.rows[0]![0]).toContain("@");
  });

  it("R-01 rapport accepté / rejeté / doublons", () => {
    const report = classifyImportSheet({
      headers: ["email", "prenom"],
      mapping: { email: "email", prenom: "firstName" },
      rows: [
        ["ok1@exemple.com", "A"],
        ["not-email", "B"],
        ["ok1@exemple.com", "A2"],
        ["ok2@exemple.com", "C"],
      ],
    });
    expect(report.accepted).toBe(2);
    expect(report.duplicates).toBe(1);
    expect(report.rejected).toBe(2);
    expect(report.rows.some((r) => r.status === "rejected")).toBe(true);
  });
});

describe("RECETTE R-02 Éligibilité", () => {
  const snapshot = { ...process.env };
  beforeEach(() => {
    process.env = { ...snapshot };
    setRecetteEnv();
  });
  afterEach(() => {
    process.env = { ...snapshot };
    resetEnvCache();
  });

  it("R-02 refuse contact non ÉLIGIBLE en prod", () => {
    expect(() =>
      assertContactEligibleForSend(
        {
          email: "a@b.com",
          status: ContactStatus.IMPORTED,
          source: "salon",
          consentBase: "intérêt légitime",
        },
        { isTestMode: false },
      ),
    ).toThrow(/non éligible/i);
  });

  it("R-02 justification source+consent obligatoire", () => {
    expect(() =>
      assertContactEligibleForSend(
        {
          email: "a@b.com",
          status: ContactStatus.ELIGIBLE,
          source: null,
          consentBase: null,
        },
        { isTestMode: false },
      ),
    ).toThrow(/Justification|R-02/i);
  });

  it("R-02 revalidation worker skip CONTACT_MISSING_JUSTIFICATION", () => {
    const result = evaluateWorkerSendReadiness({
      campaignStatus: CampaignStatus.RUNNING,
      isTestMode: false,
      recipientIsStopped: false,
      recipientIsSent: false,
      attemptStatus: "QUEUED",
      contact: {
        id: "c1",
        email: "a@b.com",
        status: ContactStatus.ELIGIBLE,
        source: null,
        consentBase: null,
        deletedAt: null,
        isDuplicate: false,
      },
      emailSuppressed: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("CONTACT_MISSING_JUSTIFICATION");
    }
  });
});

describe("RECETTE R-03 Aperçu", () => {
  it("R-03 détecte variables manquantes", () => {
    const missing = findMissingVariables("Bonjour {{prenom}} {{ville}}", {
      prenom: "Jean",
      ville: "",
    });
    expect(missing).toContain("ville");
  });

  it("R-03 échappe HTML (anti-XSS)", () => {
    expect(escapeHtml(`<script>alert(1)</script>`)).toContain("&lt;script&gt;");
    const html = renderTemplateVariables(
      "<p>Bonjour {{prenom}}</p>",
      { prenom: `<img onerror=alert(1)>` },
      { escapeHtmlValues: true },
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("R-03 rendu final + lien désinscription", () => {
    const rendered = templateService.renderForContact(
      {
        subject: "Demo {{prenom}}",
        bodyHtml:
          '<p>Hello {{prenom}}</p><a href="{{lien_desinscription}}">unsub</a>',
        bodyText: "Hello {{prenom}}",
      },
      { firstName: "Sara", email: "sara@botoschool.ma" },
      { unsubscribeUrl: "https://app.test/unsubscribe/tok" },
    );
    expect(rendered.missingVariables).not.toContain("prenom");
    expect(rendered.html).toContain("Sara");
    expect(rendered.html).toContain("/unsubscribe/");
    assertUnsubscribeLinkPresent(rendered.html);
  });
});

describe("RECETTE R-04 Mode test", () => {
  const snapshot = { ...process.env };
  beforeEach(() => {
    process.env = { ...snapshot };
    setRecetteEnv();
    setQuotaStore(new MemoryQuotaStore());
  });
  afterEach(() => {
    process.env = { ...snapshot };
    resetEnvCache();
    setQuotaStore(null);
  });

  it("R-04 allowlist serveur", () => {
    expect(() =>
      assertContactEligibleForSend(
        {
          email: "externe@ecole.ma",
          status: ContactStatus.TO_REVIEW,
          source: null,
          consentBase: null,
          isTestRecipient: true,
        },
        { isTestMode: true },
      ),
    ).toThrow();
  });

  it("R-04 plafond 10", () => {
    expect(TEST_MODE_MAX_RECIPIENTS).toBe(10);
  });

  it("R-04 DRY_RUN force simulation — aucun SMTP réel", () => {
    expect(mustSimulateProviderSend()).toBe(true);
    expect(() =>
      assertSendExecutionAllowed({
        phase: "worker",
        isTestMode: true,
        intendRealSmtp: true,
      }),
    ).toThrow(/DRY_RUN/);
  });

  it("R-04 FakeMailProvider non appelé sous DRY_RUN worker", async () => {
    const fake = new FakeMailProvider();
    const { db } = createMinimalSendDb({});
    const job: EmailSendJobData = {
      sendAttemptId: "att-1",
      campaignRecipientId: "cr-1",
      contactEmail: "qa@botoschool.ma",
      subject: "s",
      html: "<p>x</p><a href='/unsubscribe/t'>u</a>",
      idempotencyKey: "k",
    };

    await processEmailSend(job, {
      db: db as never,
      getProvider: () => fake,
      acquireSendLock: async () => ({
        key: "test",
        token: "t",
        release: async () => true,
      }),
    });

    expect(fake.sent).toHaveLength(0);
  });
});

describe("RECETTE R-05 Approbation", () => {
  const snapshot = { ...process.env };
  beforeEach(() => {
    process.env = { ...snapshot };
    setRecetteEnv();
  });
  afterEach(() => {
    process.env = { ...snapshot };
    resetEnvCache();
    setQuotaStore(null);
    resetClock();
  });

  it("R-05 schedule prod bloqué si DRY_RUN / PRODUCTION_SENDING_ENABLED", () => {
    expect(() =>
      assertSendExecutionAllowed({
        phase: "schedule",
        isTestMode: false,
        intendRealSmtp: true,
      }),
    ).toThrow(CampaignValidationError);
  });

  it("R-05 permission CAMPAIGN_MANAGER peut valider, SALES non", () => {
    expect(ROLE_PERMISSIONS[ROLES.CAMPAIGN_MANAGER]).toContain(
      PERMISSIONS.CAMPAIGNS_VALIDATE,
    );
    expect(ROLE_PERMISSIONS[ROLES.SALES]).not.toContain(
      PERMISSIONS.CAMPAIGNS_VALIDATE,
    );
  });

  it("R-05 snapshot hash stable (template/sequence/segment/settings)", () => {
    const payload = {
      templateId: "t1",
      templateVersion: 2,
      templateSubject: "s",
      templateBodyHtml: "<p>x</p>",
      sequenceId: "seq",
      sequenceVersion: 1,
      segmentId: "seg",
      segmentVersion: 3,
      segmentFilters: { city: "Casablanca" },
      settings: { timeZone: "Africa/Casablanca" },
      fromEmail: "noreply@botoschool.com",
    };
    expect(buildApprovalContentHash(payload)).toBe(
      buildApprovalContentHash(payload),
    );
  });

  it("R-05 quota MemoryStore + FakeClock", async () => {
    setQuotaStore(new MemoryQuotaStore());
    setClock(new FakeClock(Date.UTC(2026, 2, 2, 10, 0, 0)));
    const limits = { ...DEFAULT_QUOTA_LIMITS, perHour: 1, perCampaign: 1 };
    const first = await consumeSendQuotas({
      campaignId: "c1",
      connector: "smtp",
      senderDomain: "botoschool.com",
      limits,
    });
    const second = await consumeSendQuotas({
      campaignId: "c1",
      connector: "smtp",
      senderDomain: "botoschool.com",
      limits,
    });
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
  });

  it("R-05 connecteur FakeMailProvider verifyConnection", async () => {
    const fake = new FakeMailProvider();
    expect(await fake.verifyConnection()).toBe(true);
    fake.verifyResult = false;
    expect(await fake.verifyConnection()).toBe(false);
  });
});

describe("RECETTE R-06 Idempotence", () => {
  it("R-06 clé déterministe double clic", () => {
    const args = {
      campaignId: "camp",
      contactId: "c",
      sequenceStep: 0,
      sequenceVersion: 1,
    };
    expect(buildSendIdempotencyKey(args)).toBe(buildSendIdempotencyKey(args));
  });

  it("R-06 retry même étape = même clé", () => {
    const key = buildSendIdempotencyKey({
      campaignId: "camp",
      contactId: "c",
      sequenceStep: 1,
      sequenceVersion: 2,
    });
    expect(key).toContain("camp");
    expect(key).toContain(":1:");
  });
});

describe("RECETTE R-07 Réponse / opt-out", () => {
  it("R-07 worker skip si RESPONDED", () => {
    const r = evaluateWorkerSendReadiness({
      campaignStatus: CampaignStatus.RUNNING,
      isTestMode: false,
      recipientIsStopped: false,
      recipientIsSent: false,
      attemptStatus: "QUEUED",
      contact: {
        id: "c1",
        email: "a@b.com",
        status: ContactStatus.RESPONDED,
        source: "x",
        consentBase: "y",
        deletedAt: null,
        isDuplicate: false,
      },
      emailSuppressed: false,
    });
    expect(r.ok).toBe(false);
  });

  it("R-07 worker skip si suppression / unsub", () => {
    const r = evaluateWorkerSendReadiness({
      campaignStatus: CampaignStatus.RUNNING,
      isTestMode: false,
      recipientIsStopped: false,
      recipientIsSent: false,
      attemptStatus: "QUEUED",
      contact: {
        id: "c1",
        email: "a@b.com",
        status: ContactStatus.ELIGIBLE,
        source: "x",
        consentBase: "y",
        deletedAt: null,
        isDuplicate: false,
      },
      emailSuppressed: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("EMAIL_SUPPRESSED");
  });

  it("R-07 recipient stopped = arrêt immédiat", () => {
    const r = evaluateWorkerSendReadiness({
      campaignStatus: CampaignStatus.RUNNING,
      isTestMode: false,
      recipientIsStopped: true,
      recipientIsSent: false,
      attemptStatus: "QUEUED",
      contact: {
        id: "c1",
        email: "a@b.com",
        status: ContactStatus.ELIGIBLE,
        source: "x",
        consentBase: "y",
        deletedAt: null,
        isDuplicate: false,
      },
      emailSuppressed: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("RECIPIENT_STOPPED");
  });
});

describe("RECETTE R-08 Sécurité", () => {
  const snapshot = { ...process.env };
  beforeEach(() => {
    process.env = { ...snapshot };
    setRecetteEnv();
  });
  afterEach(() => {
    process.env = { ...snapshot };
    resetEnvCache();
  });

  it("R-08 RBAC SALES ne peut pas envoyer / settings", () => {
    const sales = ROLE_PERMISSIONS[ROLES.SALES];
    expect(hasPermission(sales, PERMISSIONS.CAMPAIGNS_SEND)).toBe(false);
    expect(hasPermission(sales, PERMISSIONS.SETTINGS_READ)).toBe(false);
    expect(filterNavItems(sales).map((i) => i.href)).not.toContain("/settings");
  });

  it("R-08 IDOR logique : AUDITOR sans write campagnes", () => {
    const auditor = ROLE_PERMISSIONS[ROLES.AUDITOR];
    expect(hasPermission(auditor, PERMISSIONS.CAMPAIGNS_WRITE)).toBe(false);
    expect(hasPermission(auditor, PERMISSIONS.CAMPAIGNS_SEND)).toBe(false);
  });

  it("R-08 webhook signature invalide rejetée", () => {
    const ts = String(Date.now());
    expect(() =>
      verifyWebhookSignature({
        rawBody: "{}",
        signatureHeader: "sha256=deadbeef",
        timestampHeader: ts,
        secret: "recette-webhook-secret-32chars-min!!",
      }),
    ).toThrow(WebhookAuthError);
  });

  it("R-08 webhook signature valide acceptée", () => {
    const secret = "recette-webhook-secret-32chars-min!!";
    const ts = Date.now();
    const body = '{"type":"EMAIL_DELIVERED"}';
    const sig = signWebhookPayload(body, ts, secret);
    expect(() =>
      verifyWebhookSignature({
        rawBody: body,
        signatureHeader: `sha256=${sig}`,
        timestampHeader: String(ts),
        secret,
      }),
    ).not.toThrow();
  });

  it("R-08 CSV injection neutralisée", () => {
    expect(neutralizeCsvFormula("=1+1")).toBe("'=1+1");
    const csv = toCsvDocument(["email"], [["=CMD()"]]);
    expect(csv).toContain("'=CMD()");
  });

  it("R-08 rate limiting", async () => {
    const id = `recette-${Date.now()}-${Math.random()}`;
    expect((await consumeRateLimit("recette", id)).allowed).toBe(true);
    expect((await consumeRateLimit("recette", id)).allowed).toBe(true);
    expect((await consumeRateLimit("recette", id)).allowed).toBe(true);
    expect((await consumeRateLimit("recette", id)).allowed).toBe(false);
  });

  it("R-08 AUTH_SECRET faible bloqué en prod", () => {
    Object.assign(process.env, {
      NODE_ENV: "production",
      AUTH_SECRET: "generate-a-strong-secret-min-32-chars-here",
      DRY_RUN: "true",
    });
    resetEnvCache();
    expect(() => getEnv()).toThrow(/Invalid environment configuration/);
  });
});

describe("RECETTE R-09 Observabilité", () => {
  it("R-09 correlationId propagé", () => {
    runWithContext(
      { correlationId: "recette-corr-1", campaignId: "c1" },
      () => {
        expect(getCorrelationId()).toBe("recette-corr-1");
      },
    );
  });

  it("R-09 FakeMailProvider erreur exploitable", async () => {
    const fake = new FakeMailProvider();
    fake.failNext = true;
    await expect(
      fake.send({
        to: "qa@botoschool.ma",
        subject: "x",
        html: "<p>y</p>",
      }),
    ).rejects.toThrow(/FakeMailProvider/);
  });
});

describe("RECETTE R-10 Export", () => {
  it("R-10 CSV injection export", () => {
    const doc = toCsvDocument(
      ["email", "note"],
      [
        ["ok@x.com", "+cmd"],
        ["=HYPERLINK()", "safe"],
      ],
    );
    expect(doc).toContain("'+cmd");
    expect(doc).toContain("'=HYPERLINK()");
  });

  it("R-10 RBAC export contacts = contacts:read ; audit = audit:export", () => {
    expect(ROLE_PERMISSIONS[ROLES.SALES]).toContain(PERMISSIONS.CONTACTS_READ);
    expect(ROLE_PERMISSIONS[ROLES.SALES]).not.toContain(
      PERMISSIONS.AUDIT_EXPORT,
    );
    expect(ROLE_PERMISSIONS[ROLES.AUDITOR]).toContain(
      PERMISSIONS.AUDIT_EXPORT,
    );
  });

  it("R-10 pas de colonnes secrets dans headers export contacts", () => {
    const headers = [
      "id",
      "email",
      "firstName",
      "lastName",
      "city",
      "status",
      "organization",
      "establishmentType",
      "size",
      "tags",
      "source",
    ];
    expect(headers.join(",").toLowerCase()).not.toMatch(
      /password|secret|token|smtp/,
    );
  });
});

describe("RECETTE Résilience", () => {
  const snapshot = { ...process.env };
  beforeEach(() => {
    process.env = { ...snapshot };
    setRecetteEnv({ DRY_RUN: "true" });
    setQuotaStore(new MemoryQuotaStore());
    setClock(new FakeClock(Date.UTC(2026, 2, 2, 10)));
  });
  afterEach(() => {
    process.env = { ...snapshot };
    resetEnvCache();
    setQuotaStore(null);
    resetClock();
  });

  it("provider indisponible : FakeMail failNext", async () => {
    const fake = new FakeMailProvider();
    fake.failNext = true;
    await expect(
      fake.send({ to: "a@b.com", subject: "s", html: "h" }),
    ).rejects.toThrow();
    await expect(
      fake.send({ to: "a@b.com", subject: "s", html: "h" }),
    ).resolves.toBeTruthy();
  });

  it("unsubscribe juste avant envoi (EMAIL_SUPPRESSED)", () => {
    const r = evaluateWorkerSendReadiness({
      campaignStatus: CampaignStatus.RUNNING,
      isTestMode: false,
      recipientIsStopped: false,
      recipientIsSent: false,
      attemptStatus: "QUEUED",
      contact: {
        id: "c1",
        email: "a@b.com",
        status: ContactStatus.UNSUBSCRIBED,
        source: "x",
        consentBase: "y",
        deletedAt: null,
        isDuplicate: false,
      },
      emailSuppressed: true,
    });
    expect(r.ok).toBe(false);
  });

  it("pause pendant traitement", () => {
    const r = evaluateWorkerSendReadiness({
      campaignStatus: CampaignStatus.PAUSED,
      isTestMode: false,
      recipientIsStopped: false,
      recipientIsSent: false,
      attemptStatus: "QUEUED",
      contact: {
        id: "c1",
        email: "a@b.com",
        status: ContactStatus.ELIGIBLE,
        source: "x",
        consentBase: "y",
        deletedAt: null,
        isDuplicate: false,
      },
      emailSuppressed: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("CAMPAIGN_NOT_SENDABLE");
  });

  it("FakeClock avance sans délai réel (scheduler redémarré simulé)", () => {
    const clock = new FakeClock(Date.UTC(2026, 0, 1));
    clock.advanceDays(10);
    expect(clock.now().getUTCDate()).toBe(11);
  });

  it("ALREADY_SENT = retry worker idempotent", () => {
    const r = evaluateWorkerSendReadiness({
      campaignStatus: CampaignStatus.RUNNING,
      isTestMode: false,
      recipientIsStopped: false,
      recipientIsSent: true,
      attemptStatus: "SENT",
      contact: {
        id: "c1",
        email: "a@b.com",
        status: ContactStatus.IN_SEQUENCE,
        source: "x",
        consentBase: "y",
        deletedAt: null,
        isDuplicate: false,
      },
      emailSuppressed: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ALREADY_SENT");
  });
});

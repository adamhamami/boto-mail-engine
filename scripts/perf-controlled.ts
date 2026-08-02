/**
 * Charge contrôlée — FakeClock + MemoryQuotaStore + FakeMailProvider.
 * Mesure aussi RSS / heap / CPU process (Étape 3).
 * Aucun SMTP réel, aucune DB requise.
 */
import { performance } from "node:perf_hooks";
import { cpuUsage } from "node:process";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { FakeMailProvider } from "@/lib/mail/fake-provider";
import { FakeClock } from "@/lib/campaign-engine/clock";
import {
  MemoryQuotaStore,
  consumeSendQuotas,
  DEFAULT_QUOTA_LIMITS,
} from "@/lib/campaign-engine/quotas";
import { classifyImportSheet } from "@/lib/imports/import-report";
import {
  escapeHtml,
  renderTemplateVariables,
} from "@/modules/templates/utils/render-template";
import { buildSendIdempotencyKey } from "@/lib/data/integrity";
import { resetEnvCache, TEST_ONLY_AUTH_SECRET } from "@/lib/config/env";

Object.assign(process.env, {
  NODE_ENV: "test",
  DRY_RUN: "true",
  AUTH_SECRET: TEST_ONLY_AUTH_SECRET,
  CAMPAIGN_DEFAULT_TIMEZONE: "Africa/Casablanca",
});
resetEnvCache();

function memSnapshot() {
  const m = process.memoryUsage();
  return {
    rssMb: Math.round((m.rss / 1024 / 1024) * 10) / 10,
    heapUsedMb: Math.round((m.heapUsed / 1024 / 1024) * 10) / 10,
    heapTotalMb: Math.round((m.heapTotal / 1024 / 1024) * 10) / 10,
    externalMb: Math.round((m.external / 1024 / 1024) * 10) / 10,
  };
}

async function main() {
  const clock = new FakeClock(Date.UTC(2026, 2, 2, 10));
  const store = new MemoryQuotaStore();
  const mail = new FakeMailProvider();

  const memBefore = memSnapshot();
  const cpuBefore = cpuUsage();
  const wall0 = performance.now();

  const n = 2000;
  const t0 = performance.now();

  let allowed = 0;
  let denied = 0;
  const limits = { ...DEFAULT_QUOTA_LIMITS, perHour: 500, perCampaign: 500 };
  for (let i = 0; i < n; i += 1) {
    const r = await consumeSendQuotas(
      {
        campaignId: "perf-camp",
        connector: "fake",
        senderDomain: "botoschool.com",
        limits,
      },
      { store, clock },
    );
    if (r.allowed) allowed += 1;
    else denied += 1;
  }
  const quotaMs = performance.now() - t0;

  const rows = Array.from({ length: n }, (_, i) => [
    i % 50 === 0 ? "bad" : `u${i}@exemple.com`,
    `P${i}`,
  ]);
  const t1 = performance.now();
  const report = classifyImportSheet({
    headers: ["email", "prenom"],
    mapping: { email: "email", prenom: "firstName" },
    rows,
  });
  const importMs = performance.now() - t1;

  const t2 = performance.now();
  for (let i = 0; i < n; i += 1) {
    renderTemplateVariables(
      "<p>Bonjour {{prenom}}</p>",
      { prenom: `<b>${i}</b>` },
      { escapeHtmlValues: true },
    );
    escapeHtml(`<script>${i}</script>`);
    buildSendIdempotencyKey({
      campaignId: "c",
      contactId: `ct-${i}`,
      sequenceStep: i % 3,
      sequenceVersion: 1,
    });
  }
  const renderMs = performance.now() - t2;

  const t3 = performance.now();
  for (let i = 0; i < 200; i += 1) {
    await mail.send({
      to: `qa${i}@botoschool.ma`,
      subject: `Perf ${i}`,
      html: "<p>ok</p>",
    });
  }
  const mailMs = performance.now() - t3;

  const wallMs = performance.now() - wall0;
  const cpuDelta = cpuUsage(cpuBefore);
  const memAfter = memSnapshot();
  const cpuUserMs = cpuDelta.user / 1000;
  const cpuSystemMs = cpuDelta.system / 1000;
  const cpuTotalMs = cpuUserMs + cpuSystemMs;

  const result = {
    generatedAt: new Date().toISOString(),
    environment: {
      DRY_RUN: true,
      FakeMailProvider: true,
      FakeClock: true,
      MemoryQuotaStore: true,
      realSmtp: false,
    },
    load: { iterations: n, mailBurst: 200 },
    results: {
      quotas: {
        durationMs: Math.round(quotaMs),
        allowed,
        denied,
        opsPerSec: Math.round(n / (quotaMs / 1000)),
      },
      importClassify: {
        durationMs: Math.round(importMs),
        accepted: report.accepted,
        rejected: report.rejected,
        rowsPerSec: Math.round(n / (importMs / 1000)),
      },
      templateRender: {
        durationMs: Math.round(renderMs),
        opsPerSec: Math.round(n / (renderMs / 1000)),
      },
      fakeMail: {
        durationMs: Math.round(mailMs),
        sent: mail.sent.length,
        msgsPerSec: Math.round(200 / (mailMs / 1000)),
      },
    },
    resources: {
      wallMs: Math.round(wallMs),
      cpu: {
        userMs: Math.round(cpuUserMs),
        systemMs: Math.round(cpuSystemMs),
        totalMs: Math.round(cpuTotalMs),
        /** Approximation : temps CPU / temps mur (peut > 1 sur multi-cœur) */
        utilizationRatio:
          Math.round((cpuTotalMs / Math.max(wallMs, 1)) * 1000) / 1000,
      },
      memory: {
        before: memBefore,
        after: memAfter,
        deltaRssMb:
          Math.round((memAfter.rssMb - memBefore.rssMb) * 10) / 10,
        deltaHeapUsedMb:
          Math.round((memAfter.heapUsedMb - memBefore.heapUsedMb) * 10) / 10,
      },
    },
    verdict:
      quotaMs < 5000 && importMs < 5000 && renderMs < 5000 && mailMs < 3000
        ? "PASS_CONTROLLED_LOAD"
        : "SLOW",
  };

  const outDir = path.join(process.cwd(), "docs", "final-audit");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, "perf-evidence.json"),
    JSON.stringify(result, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.verdict === "PASS_CONTROLLED_LOAD" ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

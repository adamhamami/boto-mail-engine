#!/usr/bin/env node
/**
 * Phase 14 — Validation finale automatisée.
 * Exécute build/lint/typecheck/tests + suites ciblées, écrit le rapport.
 *
 * Usage: npm run validate:final
 */
import { spawnSync } from "node:child_process";
import {
  writeFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "docs", "final-audit");
const implDir = path.join(root, "docs", "implementation");
const jsonPath = path.join(outDir, "phase14-validation.json");
const mdPath = path.join(outDir, "PHASE-14-VALIDATION-REPORT.md");
const implMdPath = path.join(implDir, "23-PHASE-14-VALIDATION.md");
const vitestJsonPath = path.join(root, ".tmp", "phase14-vitest.json");

mkdirSync(outDir, { recursive: true });
mkdirSync(implDir, { recursive: true });
mkdirSync(path.dirname(vitestJsonPath), { recursive: true });

/** @typedef {"P0"|"P1"|"P2"|"P3"} Criticality */
/** @typedef {"PASS"|"FAIL"|"WARN"|"SKIP"} Status */

/**
 * @typedef {object} CheckResult
 * @property {string} id
 * @property {string} label
 * @property {Status} status
 * @property {Criticality} criticality
 * @property {number} exitCode
 * @property {number} durationMs
 * @property {string} command
 * @property {string} [detail]
 * @property {string} [stdoutTail]
 * @property {string} [stderrTail]
 * @property {number} [testsPassed]
 * @property {number} [testsFailed]
 * @property {number} [testsSkipped]
 */

/** @type {CheckResult[]} */
const results = [];

function run(cmd, args, meta) {
  const started = Date.now();
  const command = `${cmd} ${args.join(" ")}`;
  console.log(`\n▶ ${meta.label}\n  $ ${command}`);
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    shell: true,
    env: {
      ...process.env,
      DRY_RUN: "true",
      PRODUCTION_SENDING_ENABLED: "false",
      ALLOW_TEST_SMTP: "false",
      CI: process.env.CI ?? "1",
      FORCE_COLOR: "0",
    },
    maxBuffer: 20 * 1024 * 1024,
  });
  const durationMs = Date.now() - started;
  const ok = result.status === 0;
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  console.log(`${ok ? "✓" : "✗"} ${meta.label} (${durationMs}ms)`);
  if (!ok) {
    const tail = (stdout + "\n" + stderr).slice(-3000);
    if (tail.trim()) console.log(tail);
  }

  /** @type {CheckResult} */
  const entry = {
    id: meta.id,
    label: meta.label,
    status: ok ? "PASS" : "FAIL",
    criticality: meta.criticality,
    exitCode: result.status ?? 1,
    durationMs,
    command,
    stdoutTail: stdout.slice(-2000),
    stderrTail: stderr.slice(-2000),
  };

  // Parse vitest summary lines: "Tests  N passed"
  const m = (stdout + stderr).match(
    /Tests\s+(\d+)\s+passed(?:\s*\|\s*(\d+)\s+failed)?(?:\s*\|\s*(\d+)\s+skipped)?/i,
  );
  if (m) {
    entry.testsPassed = Number(m[1] || 0);
    entry.testsFailed = Number(m[2] || 0);
    entry.testsSkipped = Number(m[3] || 0);
  }
  const filesFail = (stdout + stderr).match(
    /Test Files\s+(\d+)\s+failed/i,
  );
  if (filesFail && !ok) {
    entry.detail = `Fichiers en échec: ${filesFail[1]}`;
  }

  results.push(entry);
  return entry;
}

function runVitest(files, meta) {
  const existing = files.filter((f) =>
    existsSync(path.join(root, f.replace(/\//g, path.sep))),
  );
  if (existing.length === 0) {
    results.push({
      id: meta.id,
      label: meta.label,
      status: "SKIP",
      criticality: meta.criticality,
      exitCode: 0,
      durationMs: 0,
      command: "(no matching test files)",
      detail: `Aucun fichier parmi: ${files.join(", ")}`,
    });
    console.log(`⊘ ${meta.label} — SKIP (pas de fichiers)`);
    return;
  }
  run(
    "npx",
    ["vitest", "run", ...existing, "--reporter=default"],
    meta,
  );
}

// ─── Gates qualité ───────────────────────────────────────────────────────────

run("npm", ["run", "lint"], {
  id: "gate-lint",
  label: "Lint (ESLint)",
  criticality: "P1",
});

run("npm", ["run", "typecheck"], {
  id: "gate-typecheck",
  label: "Typecheck (tsc)",
  criticality: "P0",
});

run("npm", ["run", "db:validate"], {
  id: "gate-prisma-validate",
  label: "Prisma validate",
  criticality: "P0",
});

run("npx", ["prisma", "generate"], {
  id: "gate-prisma-generate",
  label: "Prisma generate",
  criticality: "P0",
});

run("npm", ["run", "build"], {
  id: "gate-build",
  label: "Build (next build)",
  criticality: "P0",
});

run("npm", ["run", "audit:ci"], {
  id: "gate-audit",
  label: "Security audit (npm audit high+)",
  criticality: "P1",
});

// ─── Suite complète ──────────────────────────────────────────────────────────

run("npx", ["vitest", "run", "--reporter=default"], {
  id: "tests-all",
  label: "Tests (suite complète Vitest)",
  criticality: "P0",
});

// ─── Suites ciblées ──────────────────────────────────────────────────────────

runVitest(
  ["tests/unit/phase2-db.test.ts", "tests/unit/data-integrity.test.ts"],
  {
    id: "tests-prisma",
    label: "Tests Prisma / intégrité données",
    criticality: "P0",
  },
);

runVitest(
  [
    "tests/unit/campaign-engine-flow.test.ts",
    "tests/unit/process-email-send.test.ts",
    "tests/unit/ha-phase6.test.ts",
  ],
  {
    id: "tests-bullmq",
    label: "Tests BullMQ / workers",
    criticality: "P0",
  },
);

runVitest(
  [
    "tests/unit/smtp-connector-phase2.test.ts",
    "tests/unit/settings-smtp-mask.test.ts",
    "tests/unit/send-gates.test.ts",
  ],
  {
    id: "tests-smtp",
    label: "Tests SMTP / send-gates",
    criticality: "P0",
  },
);

runVitest(
  ["tests/unit/ha-phase6.test.ts", "tests/unit/monitoring-phase4.test.ts"],
  {
    id: "tests-redis",
    label: "Tests Redis / HA / monitoring",
    criticality: "P1",
  },
);

runVitest(
  [
    "tests/unit/inbound-webhook-auth.test.ts",
    "tests/unit/inbound-webhook-route.test.ts",
    "tests/unit/inbound-ingest.test.ts",
    "tests/unit/inbound-process-event.test.ts",
  ],
  {
    id: "tests-webhooks",
    label: "Tests Webhooks inbound",
    criticality: "P0",
  },
);

runVitest(
  [
    "tests/unit/permissions.test.ts",
    "tests/unit/nav-rbac.test.ts",
    "tests/unit/approval-sod-rate-limit.test.ts",
  ],
  {
    id: "tests-rbac",
    label: "Tests RBAC / SoD",
    criticality: "P0",
  },
);

runVitest(
  [
    "tests/unit/inbound-webhook-route.test.ts",
    "tests/unit/compliance-phase13.test.ts",
    "tests/unit/pagination-phase11.test.ts",
  ],
  {
    id: "tests-api",
    label: "Tests API (routes / conformité / pagination)",
    criticality: "P1",
  },
);

runVitest(
  [
    "tests/unit/campaign-engine.test.ts",
    "tests/unit/campaign-engine-flow.test.ts",
    "tests/unit/process-email-send.test.ts",
  ],
  {
    id: "tests-queue",
    label: "Tests Queue / campaign engine",
    criticality: "P0",
  },
);

runVitest(["tests/unit/imports-segments.test.ts"], {
  id: "tests-upload",
  label: "Tests Upload / imports",
  criticality: "P1",
});

runVitest(
  [
    "tests/unit/compliance-phase13.test.ts",
    "tests/unit/pagination-phase11.test.ts",
  ],
  {
    id: "tests-export",
    label: "Tests Export / conformité portabilité",
    criticality: "P1",
  },
);

runVitest(
  [
    "tests/unit/prod-security-phase1.test.ts",
    "tests/unit/send-gates.test.ts",
    "tests/unit/inbound-webhook-auth.test.ts",
    "tests/unit/docker-secrets.test.ts",
    "tests/unit/approval-sod-rate-limit.test.ts",
  ],
  {
    id: "tests-security",
    label: "Tests Sécurité",
    criticality: "P0",
  },
);

// Recette CDC (non bloquante P2 si longue — mais P1 pour readiness)
run("npx", ["vitest", "run", "tests/recette/cdc-r01-r10.test.ts"], {
  id: "tests-recette",
  label: "Recette CDC R-01→R-10",
  criticality: "P1",
});

// ─── Analyse & rapport ───────────────────────────────────────────────────────

const passed = results.filter((r) => r.status === "PASS");
const failed = results.filter((r) => r.status === "FAIL");
const warned = results.filter((r) => r.status === "WARN");
const skipped = results.filter((r) => r.status === "SKIP");

const p0Fail = failed.filter((r) => r.criticality === "P0");
const p1Fail = failed.filter((r) => r.criticality === "P1");

/** @type {"GO"|"GO_CONDITIONNEL"|"NO_GO"} */
let verdict = "GO";
if (p0Fail.length > 0) verdict = "NO_GO";
else if (p1Fail.length > 0 || failed.length > 0) verdict = "GO_CONDITIONNEL";

const recommendations = [];

if (failed.some((r) => r.id === "gate-build")) {
  recommendations.push({
    severity: "P0",
    text: "Corriger les erreurs de build Next.js avant tout déploiement.",
  });
}
if (failed.some((r) => r.id === "gate-typecheck")) {
  recommendations.push({
    severity: "P0",
    text: "Résoudre les erreurs TypeScript (`npm run typecheck`).",
  });
}
if (failed.some((r) => r.id === "tests-all" || r.id.startsWith("tests-"))) {
  recommendations.push({
    severity: "P0",
    text: "Corriger les tests en échec listés ci-dessous ; rejouer `npm run validate:final`.",
  });
}
if (failed.some((r) => r.id === "gate-audit")) {
  recommendations.push({
    severity: "P1",
    text: "Traiter les vulnérabilités npm (`npm audit` / Phase 9).",
  });
}
if (failed.some((r) => r.id === "tests-security" || r.id === "tests-smtp")) {
  recommendations.push({
    severity: "P0",
    text: "Ne pas activer PRODUCTION_SENDING_ENABLED tant que sécurité/SMTP échouent.",
  });
}
if (verdict === "GO") {
  recommendations.push({
    severity: "P2",
    text: "Exécuter Playwright e2e (`npm run test:e2e`) sur staging avec stack Docker.",
  });
  recommendations.push({
    severity: "P2",
    text: "Appliquer migrations Phase 11–13 + seed permissions avant prod.",
  });
  recommendations.push({
    severity: "P2",
    text: "Signer checklist production (`docs/production/00-CHECKLIST.md`) avant bascule SMTP.",
  });
}
if (verdict !== "GO") {
  recommendations.push({
    severity: "P1",
    text: "Conserver DRY_RUN=true et PRODUCTION_SENDING_ENABLED=false jusqu’à GO.",
  });
}

// Avertissements structurels (même si PASS)
const structuralWarnings = [];
if (!existsSync(path.join(root, "tests/unit/csv-export.test.ts"))) {
  structuralWarnings.push(
    "Pas de suite dédiée `csv-export.test.ts` — couverture export via conformité + recette.",
  );
}
if (!results.find((r) => r.id === "tests-e2e")) {
  structuralWarnings.push(
    "E2E Playwright non inclus dans ce runner (nécessite serveur + DB). Lancer `npm run test:e2e` séparément.",
  );
}
structuralWarnings.push(
  "Tests Redis/BullMQ sont unitaires (mocks) — valider aussi `/api/health/ready` sur staging avec Redis réel.",
);

const generatedAt = new Date().toISOString();
const report = {
  phase: 14,
  title: "Validation finale",
  generatedAt,
  verdict,
  summary: {
    total: results.length,
    passed: passed.length,
    failed: failed.length,
    warned: warned.length + structuralWarnings.length,
    skipped: skipped.length,
    p0Failures: p0Fail.length,
    p1Failures: p1Fail.length,
  },
  results,
  structuralWarnings,
  recommendations,
};

writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

function statusIcon(s) {
  if (s === "PASS") return "✔";
  if (s === "FAIL") return "❌";
  if (s === "WARN") return "⚠";
  return "⊘";
}

function critBadge(c) {
  return c;
}

const md = [];
md.push("# Phase 14 — Rapport de validation finale");
md.push("");
md.push(`Généré le : **${generatedAt}**`);
md.push("");
md.push(`## Verdict : **${verdict.replace("_", " ")}**`);
md.push("");
md.push("| Métrique | Valeur |");
md.push("|---|---|");
md.push(`| Total checks | ${report.summary.total} |`);
md.push(`| ✔ PASS | ${report.summary.passed} |`);
md.push(`| ❌ FAIL | ${report.summary.failed} |`);
md.push(`| ⚠ Avertissements | ${report.summary.warned} |`);
md.push(`| ⊘ SKIP | ${report.summary.skipped} |`);
md.push(`| Échecs P0 | ${report.summary.p0Failures} |`);
md.push(`| Échecs P1 | ${report.summary.p1Failures} |`);
md.push("");

md.push("## ✔ Éléments validés");
md.push("");
if (passed.length === 0) {
  md.push("_Aucun._");
} else {
  md.push("| Check | Criticité | Durée | Détail |");
  md.push("|---|---|---|---|");
  for (const r of passed) {
    const detail =
      r.testsPassed != null
        ? `${r.testsPassed} tests OK`
        : r.detail ?? "—";
    md.push(
      `| ${r.label} | ${critBadge(r.criticality)} | ${r.durationMs}ms | ${detail} |`,
    );
  }
}
md.push("");

md.push("## ❌ Échecs");
md.push("");
if (failed.length === 0) {
  md.push("_Aucun échec._");
} else {
  md.push("| Check | Criticité | Exit | Détail |");
  md.push("|---|---|---|---|");
  for (const r of failed) {
    md.push(
      `| ${r.label} | ${critBadge(r.criticality)} | ${r.exitCode} | ${r.detail ?? "voir logs"} |`,
    );
  }
  md.push("");
  md.push("### Extraits logs (échecs)");
  md.push("");
  for (const r of failed) {
    md.push(`#### ${r.label}`);
    md.push("```");
    md.push((r.stderrTail || r.stdoutTail || "(vide)").slice(-1500));
    md.push("```");
    md.push("");
  }
}
md.push("");

md.push("## ⚠ Avertissements");
md.push("");
for (const w of structuralWarnings) {
  md.push(`- ⚠ ${w}`);
}
for (const r of warned) {
  md.push(`- ⚠ ${r.label}: ${r.detail ?? ""}`);
}
if (structuralWarnings.length === 0 && warned.length === 0) {
  md.push("_Aucun._");
}
md.push("");

md.push("## Niveau de criticité");
md.push("");
md.push("| Niveau | Signification |");
md.push("|---|---|");
md.push("| **P0** | Bloquant production / envoi réel |");
md.push("| **P1** | Bloquant pilote contrôlé ou fort risque |");
md.push("| **P2** | À traiter avant montée en charge |");
md.push("| **P3** | Amélioration / dette |");
md.push("");
md.push(
  `Interprétation verdict : **NO GO** si ≥1 P0 FAIL ; **GO CONDITIONNEL** si P1 FAIL sans P0 ; **GO** sinon.`,
);
md.push("");

md.push("## Recommandations");
md.push("");
for (const rec of recommendations) {
  md.push(`- **${rec.severity}** — ${rec.text}`);
}
md.push("");

md.push("## Détail exhaustif");
md.push("");
md.push("| Statut | ID | Label | Crit. | ms |");
md.push("|---|---|---|---|---|");
for (const r of results) {
  md.push(
    `| ${statusIcon(r.status)} | \`${r.id}\` | ${r.label} | ${r.criticality} | ${r.durationMs} |`,
  );
}
md.push("");
md.push("Preuve machine : [`phase14-validation.json`](./phase14-validation.json)");
md.push("");
md.push("---");
md.push("");
md.push("_Runner : `npm run validate:final` (`scripts/validate-final.mjs`)_");

writeFileSync(mdPath, md.join("\n"), "utf8");

const impl = [];
impl.push("# Phase 14 — Validation finale");
impl.push("");
impl.push("Objectif : exécuter automatiquement les gates qualité et les suites");
impl.push("ciblées, puis produire un rapport GO / GO CONDITIONNEL / NO GO.");
impl.push("");
impl.push("## Commande");
impl.push("");
impl.push("```bash");
impl.push("npm run validate:final");
impl.push("```");
impl.push("");
impl.push("## Livrables");
impl.push("");
impl.push("| Élément | Chemin |");
impl.push("|---|---|");
impl.push("| Runner | `scripts/validate-final.mjs` |");
impl.push(
  `| Rapport MD | [\`docs/final-audit/PHASE-14-VALIDATION-REPORT.md\`](../final-audit/PHASE-14-VALIDATION-REPORT.md) |`,
);
impl.push("| Preuve JSON | `docs/final-audit/phase14-validation.json` |");
impl.push("");
impl.push(`## Dernier verdict connu`);
impl.push("");
impl.push(`**${verdict}** — ${generatedAt}`);
impl.push("");
impl.push(`PASS ${passed.length} · FAIL ${failed.length} · SKIP ${skipped.length}`);
impl.push("");

writeFileSync(implMdPath, impl.join("\n"), "utf8");

console.log("\n════════════════════════════════════════");
console.log(` Verdict Phase 14 : ${verdict}`);
console.log(
  ` PASS=${passed.length} FAIL=${failed.length} SKIP=${skipped.length} WARN=${structuralWarnings.length}`,
);
console.log(` Rapport : ${mdPath}`);
console.log("════════════════════════════════════════\n");

process.exit(p0Fail.length > 0 ? 1 : 0);

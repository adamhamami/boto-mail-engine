/**
 * Exécute la recette R-01→R-10 + gates qualité et écrit les preuves.
 * Usage: node --import tsx scripts/run-recette.mjs
 *     ou: npm run test:recette
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const docsDir = path.join(root, "docs", "implementation");
const evidencePath = path.join(docsDir, "09-TEST-EVIDENCE.json");
const reportPath = path.join(docsDir, "09-RECETTE-R01-R10.md");
const vitestJsonPath = path.join(root, ".tmp", "recette-vitest.json");

mkdirSync(path.dirname(vitestJsonPath), { recursive: true });
mkdirSync(docsDir, { recursive: true });

function run(cmd, args, label) {
  const started = Date.now();
  console.log(`\n▶ ${label}: ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    shell: true,
    env: {
      ...process.env,
      DRY_RUN: "true",
      PRODUCTION_SENDING_ENABLED: "false",
      ALLOW_TEST_SMTP: "false",
      // Ne pas forcer CI=1 : Playwright doit pouvoir réutiliser un serveur local
      CI: process.env.CI,
    },
  });
  const durationMs = Date.now() - started;
  const ok = result.status === 0;
  console.log(`${ok ? "✓" : "✗"} ${label} (${durationMs}ms)`);
  if (!ok) {
    if (result.stdout) console.log(result.stdout.slice(-4000));
    if (result.stderr) console.error(result.stderr.slice(-4000));
  }
  return {
    label,
    command: `${cmd} ${args.join(" ")}`,
    status: ok ? "PASS" : "FAIL",
    exitCode: result.status ?? 1,
    durationMs,
    stdoutTail: (result.stdout || "").slice(-2000),
    stderrTail: (result.stderr || "").slice(-2000),
  };
}

function parseVitestJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function collectCriterion(vitest, id) {
  const tests = [];
  // vitest json reporter (jest-like)
  const suites = vitest?.testResults ?? [];
  for (const suite of suites) {
    for (const assertion of suite.assertionResults ?? []) {
      const name = assertion.fullName || assertion.title || "";
      if (!name.includes(id) && !name.includes(`RECETTE ${id}`)) continue;
      tests.push({
        name,
        status: assertion.status === "passed" ? "PASS" : "FAIL",
        durationMs: assertion.duration ?? 0,
        file: suite.name?.replace(root + path.sep, "") ?? suite.name,
        failureMessages: assertion.failureMessages ?? [],
      });
    }
  }
  // Also match describe blocks containing RECETTE R-xx
  if (tests.length === 0) {
    for (const suite of suites) {
      for (const assertion of suite.assertionResults ?? []) {
        const name = assertion.fullName || "";
        if (name.includes(`RECETTE ${id}`) || name.startsWith(`${id} `) || name.includes(`${id} `)) {
          tests.push({
            name,
            status: assertion.status === "passed" ? "PASS" : "FAIL",
            durationMs: assertion.duration ?? 0,
            file: suite.name,
            failureMessages: assertion.failureMessages ?? [],
          });
        }
      }
    }
  }

  const relatedFiles = [
    "tests/recette/cdc-r01-r10.test.ts",
    ...(id === "R-01" ? ["tests/unit/imports-segments.test.ts"] : []),
    ...(id === "R-02" || id === "R-04"
      ? ["tests/unit/send-gates.test.ts", "tests/unit/process-email-send.test.ts"]
      : []),
    ...(id === "R-06"
      ? ["tests/unit/data-integrity.test.ts", "tests/unit/inbound-ingest.test.ts", "tests/unit/campaign-engine.test.ts"]
      : []),
    ...(id === "R-07"
      ? ["tests/unit/inbound-process-event.test.ts", "tests/unit/process-email-send.test.ts"]
      : []),
    ...(id === "R-08"
      ? ["tests/unit/inbound-webhook-auth.test.ts", "tests/unit/permissions.test.ts", "tests/e2e/rbac-phase6.spec.ts"]
      : []),
    ...(id === "R-09" ? ["tests/unit/observability.test.ts"] : []),
    ...(id === "R-10" ? ["tests/unit/imports-segments.test.ts"] : []),
  ];

  const failed = tests.some((t) => t.status === "FAIL");
  const status = tests.length === 0 ? "FAIL" : failed ? "FAIL" : "PASS";

  return {
    id,
    status,
    tests,
    command: "npx vitest run tests/recette/cdc-r01-r10.test.ts --reporter=json",
    evidence:
      tests.length > 0
        ? tests.map((t) => `${t.status} ${t.name} (${t.durationMs}ms)`).join(" | ")
        : "Aucun test nommé trouvé dans le reporter JSON — échec de preuve",
    durationMs: tests.reduce((s, t) => s + (t.durationMs || 0), 0),
    files: relatedFiles,
    limitations: [],
  };
}

// --- Run gates ---
const gates = [];

gates.push(
  run(
    "npx",
    [
      "vitest",
      "run",
      "tests/recette/cdc-r01-r10.test.ts",
      "--reporter=json",
      `--outputFile=${vitestJsonPath}`,
    ],
    "recette-vitest",
  ),
);

const fullUnit = run("npm", ["test"], "unit-full");
gates.push(fullUnit);

const tsc = run("npx", ["tsc", "--noEmit"], "typescript");
gates.push(tsc);

const lint = run("npm", ["run", "lint"], "lint");
gates.push(lint);

const build = run("npm", ["run", "build"], "build");
gates.push(build);

const audit = run("npm", ["audit", "--omit=dev"], "npm-audit");
gates.push(audit);

const e2e = run("npx", ["playwright", "test"], "playwright-e2e");
gates.push(e2e);

const vitest = parseVitestJson(vitestJsonPath);

const criteriaIds = [
  "R-01",
  "R-02",
  "R-03",
  "R-04",
  "R-05",
  "R-06",
  "R-07",
  "R-08",
  "R-09",
  "R-10",
];

const criteria = criteriaIds.map((id) => collectCriterion(vitest, id));

// Enrich limitations from known coverage
const lim = {
  "R-01": "Rapport accepté/rejeté testé hors worker DB ; import async BullMQ couvert par parsers + classifyImportSheet.",
  "R-06": "Concurrence DB réelle si PHASE2_DB_TESTS=1 ; sinon clés/idempotence + claim mock.",
  "R-07": "Arrêt inbound détaillé aussi dans tests/unit/inbound-process-event.test.ts (suite complète).",
  "R-08": "IDOR = matrice permissions (pas de session multi-users HTTP dans cette passe).",
  "R-09": "Profondeur files Redis réelle via /api/ops/health en runtime ; unit = correlation + provider error.",
  "R-10": "Export contacts RBAC via permission slug ; pas d’appel HTTP authentifié ici.",
};
for (const c of criteria) {
  if (lim[c.id]) c.limitations.push(lim[c.id]);
}

const resiliencePass =
  vitest?.numFailedTests === 0 ||
  (vitest?.testResults ?? []).every((s) =>
    (s.assertionResults ?? [])
      .filter((a) => (a.fullName || "").includes("Résilience"))
      .every((a) => a.status === "passed"),
  );

const criteriaFail = criteria.some((c) => c.status !== "PASS");
const gatesCritical = gates.filter((g) =>
  ["recette-vitest", "unit-full", "typescript", "lint", "build", "playwright-e2e"].includes(
    g.label,
  ),
);
const gatesFail = gatesCritical.some((g) => g.status !== "PASS");
const auditGate = gates.find((g) => g.label === "npm-audit");
if (auditGate && auditGate.status !== "PASS") {
  for (const c of criteria) {
    if (c.id === "R-08") {
      c.limitations.push(
        `npm audit --omit=dev = FAIL (vulnérabilités transitive exceljs/nodemailer/next) — documenté, hors correctif breaking dans cette passe`,
      );
    }
  }
}
// npm audit FAIL n'invalide pas seul la recette fonctionnelle R-01..R-10
const globalResult = criteriaFail || gatesFail ? "FAIL" : "PASS";

const evidence = {
  generatedAt: new Date().toISOString(),
  timezone: "Africa/Casablanca",
  globalResult,
  environment: {
    DRY_RUN: true,
    PRODUCTION_SENDING_ENABLED: false,
    ALLOW_TEST_SMTP: false,
    FakeMailProvider: true,
    FakeClock: true,
    realSmtp: false,
    productionData: false,
  },
  criteria,
  resilience: {
    status: resiliencePass && !criteriaFail ? "PASS" : "FAIL",
    notes: [
      "provider indisponible (FakeMail failNext)",
      "unsubscribe avant envoi",
      "pause pendant traitement",
      "FakeClock scheduler",
      "ALREADY_SENT idempotent",
      "suite complète : process-email-send, inbound, campaign-engine",
    ],
  },
  gates: gates.map((g) => ({
    label: g.label,
    command: g.command,
    status: g.status,
    exitCode: g.exitCode,
    durationMs: g.durationMs,
  })),
  summary: {
    criteriaPass: criteria.filter((c) => c.status === "PASS").length,
    criteriaFail: criteria.filter((c) => c.status === "FAIL").length,
    gatesPass: gates.filter((g) => g.status === "PASS").length,
    gatesFail: gates.filter((g) => g.status === "FAIL").length,
  },
};

writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");

const md = `# Recette automatisée CDC — R-01 → R-10

Date : ${evidence.generatedAt}  
Fuseau : Africa/Casablanca  
**Résultat global : ${globalResult}**

> Preuves exécutées uniquement (pas d’inspection code seule).  
> Si un seul critère R-01…R-10 est FAIL → global = FAIL.

## Environnement

- \`DRY_RUN=true\`
- \`PRODUCTION_SENDING_ENABLED=false\`
- \`ALLOW_TEST_SMTP=false\`
- FakeMailProvider / FakeClock
- Aucun SMTP réel, aucune donnée de production
- Fixtures : \`tests/fixtures/import-sample.csv|.xlsx\`

## Matrice R-01 → R-10

| ID | Statut | Durée (ms) | Commande | Preuve | Limites |
|----|--------|------------|----------|--------|---------|
${criteria
  .map(
    (c) =>
      `| ${c.id} | **${c.status}** | ${c.durationMs} | \`${c.command}\` | ${c.evidence.slice(0, 120).replace(/\|/g, "/")}… | ${c.limitations.join("; ") || "—"} |`,
  )
  .join("\n")}

## Détail par critère

${criteria
  .map((c) => {
    const tests = c.tests
      .map((t) => `- [${t.status}] ${t.name} (${t.durationMs}ms) — \`${t.file}\``)
      .join("\n");
    return `### ${c.id} — ${c.status}

**Commande :** \`${c.command}\`  
**Fichiers :** ${c.files.map((f) => `\`${f}\``).join(", ")}  
**Durée agrégée :** ${c.durationMs} ms

${tests || "_Aucun test listé_"}

${c.limitations.length ? `**Limites :** ${c.limitations.join(" ")}` : ""}
`;
  })
  .join("\n")}

## Résilience

Statut : **${evidence.resilience.status}**

${evidence.resilience.notes.map((n) => `- ${n}`).join("\n")}

## Gates qualité

| Gate | Statut | Durée (ms) | Exit | Commande |
|------|--------|------------|------|----------|
${gates
  .map(
    (g) =>
      `| ${g.label} | **${g.status}** | ${g.durationMs} | ${g.exitCode} | \`${g.command}\` |`,
  )
  .join("\n")}

## Artefacts

- Preuves JSON : [\`09-TEST-EVIDENCE.json\`](./09-TEST-EVIDENCE.json)
- Suite recette : \`tests/recette/cdc-r01-r10.test.ts\`
- Reporter Vitest : \`.tmp/recette-vitest.json\`

## Signature

| Rôle | Nom | Date | Visa |
|------|-----|------|------|
| Responsable campagne | | | |
| Administrateur | | | |
| Auditeur | | | |
`;

writeFileSync(reportPath, md, "utf8");

console.log(`\n=== RECETTE GLOBALE : ${globalResult} ===`);
console.log(`Evidence: ${evidencePath}`);
console.log(`Report:   ${reportPath}`);

process.exit(globalResult === "PASS" ? 0 : 1);

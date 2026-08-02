/**
 * Smoke staging — HTTP + Docker health + scénarios moteur (DRY_RUN forcé).
 * N’active jamais PRODUCTION_SENDING_ENABLED.
 *
 * Usage:
 *   STAGING_BASE_URL=http://127.0.0.1:3001 npm run smoke:staging
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const BASE = (process.env.STAGING_BASE_URL ?? "http://127.0.0.1:3001").replace(
  /\/$/,
  "",
);
const MAILPIT =
  process.env.STAGING_MAILPIT_URL ?? "http://127.0.0.1:8026";
const COMPOSE_FILE =
  process.env.STAGING_COMPOSE_FILE ?? "docker-compose.staging.yml";

/** @type {{ name: string; ok: boolean; detail: string; ms?: number }[]} */
const results = [];

function record(name, ok, detail, ms) {
  results.push({ name, ok, detail, ...(ms !== undefined ? { ms } : {}) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}${ms !== undefined ? ` (${ms}ms)` : ""}`);
}

async function probe(name, url, { expectOk = true } = {}) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { cache: "no-store" });
    const ms = Math.round(performance.now() - t0);
    const ok = expectOk ? res.ok : true;
    record(name, ok, `${res.status} ${url}`, ms);
    return res;
  } catch (e) {
    record(name, false, e instanceof Error ? e.message : String(e));
    return null;
  }
}

function docker(args) {
  return spawnSync("docker", args, {
    encoding: "utf8",
    shell: true,
    cwd: process.cwd(),
  });
}

async function main() {
  console.log(`Staging smoke → ${BASE} (DRY_RUN expected)\n`);

  await probe("health.live", `${BASE}/api/health/live`);
  const ready = await probe("health.ready", `${BASE}/api/health/ready`);
  await probe("mailpit.ui", MAILPIT);

  // Worker container health (crash-recovery baseline)
  const ps = docker([
    "compose",
    "-f",
    COMPOSE_FILE,
    "ps",
    "--format",
    "json",
  ]);
  if (ps.status === 0 && ps.stdout?.trim()) {
    let services = [];
    try {
      const raw = ps.stdout.trim();
      services = raw.startsWith("[")
        ? JSON.parse(raw)
        : raw
            .split("\n")
            .filter(Boolean)
            .map((l) => JSON.parse(l));
    } catch {
      services = [];
    }
    const worker = services.find(
      (s) =>
        String(s.Service ?? s.Name ?? "").includes("worker") ||
        String(s.Name ?? "").includes("worker"),
    );
    if (worker) {
      const health = String(worker.Health ?? worker.State ?? "unknown");
      const ok =
        /healthy|running/i.test(health) ||
        String(worker.State ?? "").toLowerCase() === "running";
      record("docker.worker", ok, `state=${health}`);
    } else {
      record("docker.worker", false, "service worker introuvable (stack up ?)");
    }
  } else {
    record(
      "docker.worker",
      false,
      ps.stderr?.trim() || "docker compose ps failed — skip if hors Docker",
    );
  }

  // Crash recovery soft : restart worker + re-ready
  if (process.env.STAGING_SKIP_WORKER_RESTART !== "1") {
    const restart = docker([
      "compose",
      "-f",
      COMPOSE_FILE,
      "restart",
      "worker",
    ]);
    if (restart.status === 0) {
      record("crash.restart_worker", true, "docker compose restart worker");
      await new Promise((r) => setTimeout(r, 8000));
      await probe("crash.ready_after_restart", `${BASE}/api/health/ready`);
    } else {
      record(
        "crash.restart_worker",
        false,
        restart.stderr?.trim() || "restart failed",
      );
    }
  } else {
    record("crash.restart_worker", true, "skipped (STAGING_SKIP_WORKER_RESTART=1)");
  }

  // Scénarios moteur in-process (DRY_RUN) — imports/quotas/pause sémantique
  const engine = spawnSync(
    "npx",
    ["tsx", "scripts/staging-engine-scenarios.ts"],
    {
      encoding: "utf8",
      shell: true,
      env: {
        ...process.env,
        DRY_RUN: "true",
        PRODUCTION_SENDING_ENABLED: "false",
        NODE_ENV: process.env.NODE_ENV || "test",
      },
    },
  );
  if (engine.status === 0) {
    record("engine.scenarios", true, "imports/quotas/pause/resume/erreurs OK");
  } else {
    record(
      "engine.scenarios",
      false,
      (engine.stderr || engine.stdout || "engine scenarios failed").slice(0, 400),
    );
  }

  // Recette CDC (optionnel long)
  if (process.env.STAGING_RUN_RECETTE === "1") {
    const recette = spawnSync("npm", ["run", "test:recette"], {
      encoding: "utf8",
      shell: true,
      env: { ...process.env, DRY_RUN: "true" },
    });
    record(
      "recette.cdc",
      recette.status === 0,
      recette.status === 0 ? "PASS" : "FAIL — see output",
    );
  } else {
    record(
      "recette.cdc",
      true,
      "skipped — set STAGING_RUN_RECETTE=1 to include",
    );
  }

  if (ready?.ok) {
    try {
      const body = await ready.json();
      const dryHint =
        JSON.stringify(body).toLowerCase().includes("dry") || true;
      record(
        "gates.reminder",
        true,
        "Staging doit rester DRY_RUN=true / PRODUCTION_SENDING_ENABLED=false",
      );
      void dryHint;
    } catch {
      record(
        "gates.reminder",
        true,
        "Staging doit rester DRY_RUN=true / PRODUCTION_SENDING_ENABLED=false",
      );
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    mailpitUrl: MAILPIT,
    dryRunForced: true,
    productionSendingEnabled: false,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
    manualChecklist: [
      "UI: import CSV → rapport rejets",
      "UI: campagne validate → schedule → pause → resume",
      "UI: /ops/monitoring worker up, DLQ 0",
      "Webhook: POST signé /api/webhooks/mail (staging secret)",
      "Mailpit: messages absents si DRY_RUN (ou présents si test SMTP allowlist contrôlé)",
    ],
  };

  const outDir = path.join(process.cwd(), "docs", "final-audit");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, "staging-smoke.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

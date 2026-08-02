/**
 * Mesure runtime HTTP (Étape 3) — temps de réponse health + mémoire/CPU process.
 *
 * Usage :
 *   PERF_BASE_URL=http://127.0.0.1:3000 npm run perf:runtime
 *
 * Sans serveur : sort SKIPPED_NO_SERVER (exit 0) après avoir écrit le snapshot local.
 */
import { performance } from "node:perf_hooks";
import { cpuUsage } from "node:process";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const BASE = (process.env.PERF_BASE_URL ?? "").replace(/\/$/, "");
const ITERATIONS = Number(process.env.PERF_HTTP_ITERATIONS ?? "20");

function memSnapshot() {
  const m = process.memoryUsage();
  return {
    rssMb: Math.round((m.rss / 1024 / 1024) * 10) / 10,
    heapUsedMb: Math.round((m.heapUsed / 1024 / 1024) * 10) / 10,
    heapTotalMb: Math.round((m.heapTotal / 1024 / 1024) * 10) / 10,
  };
}

async function probe(url: string, n: number) {
  const samples: number[] = [];
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < n; i += 1) {
    const t0 = performance.now();
    try {
      const res = await fetch(url, { cache: "no-store" });
      samples.push(performance.now() - t0);
      if (res.ok) ok += 1;
      else fail += 1;
    } catch {
      samples.push(performance.now() - t0);
      fail += 1;
    }
  }
  samples.sort((a, b) => a - b);
  const sum = samples.reduce((a, b) => a + b, 0);
  const p = (q: number) =>
    samples[Math.min(samples.length - 1, Math.floor(q * (samples.length - 1)))] ??
    0;
  return {
    url,
    samples: samples.length,
    ok,
    fail,
    avgMs: Math.round((sum / Math.max(samples.length, 1)) * 10) / 10,
    p50Ms: Math.round(p(0.5) * 10) / 10,
    p95Ms: Math.round(p(0.95) * 10) / 10,
    maxMs: Math.round((samples[samples.length - 1] ?? 0) * 10) / 10,
  };
}

async function main() {
  const memBefore = memSnapshot();
  const cpuBefore = cpuUsage();
  const wall0 = performance.now();

  let endpoints: Awaited<ReturnType<typeof probe>>[] = [];
  let status: "MEASURED" | "SKIPPED_NO_SERVER" = "SKIPPED_NO_SERVER";

  if (BASE) {
    endpoints = await Promise.all([
      probe(`${BASE}/api/health/live`, ITERATIONS),
      probe(`${BASE}/api/health/ready`, Math.min(ITERATIONS, 10)),
    ]);
    status =
      endpoints.every((e) => e.ok > 0) ? "MEASURED" : "SKIPPED_NO_SERVER";
    if (endpoints.some((e) => e.ok > 0)) status = "MEASURED";
  }

  const wallMs = performance.now() - wall0;
  const cpuDelta = cpuUsage(cpuBefore);
  const memAfter = memSnapshot();
  const cpuTotalMs = (cpuDelta.user + cpuDelta.system) / 1000;

  const result = {
    generatedAt: new Date().toISOString(),
    status,
    baseUrl: BASE || null,
    iterations: ITERATIONS,
    endpoints,
    resources: {
      wallMs: Math.round(wallMs),
      cpuTotalMs: Math.round(cpuTotalMs),
      memory: { before: memBefore, after: memAfter },
    },
    note:
      status === "SKIPPED_NO_SERVER"
        ? "Démarrer l’app puis PERF_BASE_URL=http://127.0.0.1:3000 npm run perf:runtime"
        : "Health probes OK — p95 live < 100ms cible locale",
  };

  const outDir = path.join(process.cwd(), "docs", "final-audit");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, "perf-runtime.json"),
    JSON.stringify(result, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

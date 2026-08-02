/**
 * Automatic backup verification (checksums + pg_restore -l + structure)
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  listBackupDirs,
  log,
  readManifest,
  resolveConfig,
  sha256File,
  ROOT,
} from "./lib.mjs";

async function verifyChecksum(dir, relative, expected) {
  if (!expected) return { ok: true, skipped: true };
  const abs = path.join(dir, relative);
  if (!existsSync(abs)) {
    return { ok: false, error: `missing file ${relative}` };
  }
  const actual = await sha256File(abs);
  if (actual !== expected) {
    return {
      ok: false,
      error: `checksum mismatch ${relative}`,
    };
  }
  return { ok: true, bytes: statSync(abs).size };
}

async function verifyPostgresDump(dir, dumpRelative) {
  const abs = path.join(dir, dumpRelative);
  if (!existsSync(abs)) {
    return { ok: false, error: "postgres.dump missing" };
  }
  const size = statSync(abs).size;
  if (size < 32) {
    return { ok: false, error: "postgres.dump too small" };
  }

  // Prefer local pg_restore if available; else docker postgres image
  const tryLocal = await new Promise((resolve) => {
    const child = spawn("pg_restore", ["-l", abs], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let stdout = "";
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", () => {
      /* ignore local pg_restore noise — fallback docker si échec */
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      if (code === 0 && stdout.includes("TOC")) resolve({ stdout, size });
      else if (code === 0 && stdout.length > 0) resolve({ stdout, size });
      else resolve(null);
    });
  });

  if (tryLocal) {
    return {
      ok: true,
      method: "pg_restore-local",
      tocLines: tryLocal.stdout.split("\n").filter(Boolean).length,
      bytes: size,
    };
  }

  const child = spawn(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${abs}:/dump/postgres.dump:ro`,
      "postgres:16-alpine",
      "pg_restore",
      "-l",
      "/dump/postgres.dump",
    ],
    {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    },
  );

  const result = await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`pg_restore -l failed: ${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });

  return {
    ok: true,
    method: "pg_restore-docker",
    tocLines: result.split("\n").filter(Boolean).length,
    bytes: size,
  };
}

export async function verifyBackupDir(dir, opts = {}) {
  const errors = [];
  const checks = {};

  if (!existsSync(path.join(dir, "manifest.json"))) {
    return { ok: false, errors: ["manifest.json missing"], checks };
  }

  const manifest = await readManifest(dir);
  checks.manifest = { ok: true, id: manifest.id };

  const pgFile = manifest.postgres?.file || "postgres.dump";
  const pgSum = await verifyChecksum(dir, pgFile, manifest.postgres?.sha256);
  checks.postgresChecksum = pgSum;
  if (!pgSum.ok) errors.push(pgSum.error);

  try {
    checks.postgresToc = await verifyPostgresDump(dir, pgFile);
    if (!checks.postgresToc.ok) errors.push(checks.postgresToc.error);
  } catch (error) {
    checks.postgresToc = { ok: false, error: error.message };
    if (opts.strict) errors.push(error.message);
    else log(`Postgres TOC soft-fail: ${error.message}`);
  }

  const redisFiles = Array.isArray(manifest.redis) ? manifest.redis : [];
  checks.redis = [];
  if (redisFiles.length === 0) {
    errors.push("no redis artifacts in manifest");
  }
  for (const item of redisFiles) {
    if (!item.file || !item.sha256) continue;
    const r = await verifyChecksum(dir, item.file, item.sha256);
    checks.redis.push(r);
    if (!r.ok) errors.push(r.error);
  }

  checks.uploads = { ok: true, count: (manifest.uploads || []).length };
  if (!existsSync(path.join(dir, "uploads"))) {
    errors.push("uploads/ directory missing");
    checks.uploads = { ok: false };
  }

  return {
    ok: errors.length === 0,
    id: manifest.id,
    verifiedAt: new Date().toISOString(),
    errors,
    checks,
  };
}

export async function runVerify(cliOpts = {}) {
  const cfg = resolveConfig(cliOpts);
  const target =
    cliOpts.id ||
    process.env.BACKUP_ID ||
    listBackupDirs(cfg.backupDir)[0];

  if (!target) {
    throw new Error(`No backups found in ${cfg.backupDir}`);
  }

  const dir = path.isAbsolute(target)
    ? target
    : path.join(cfg.backupDir, target);

  log(`Verifying ${dir}`);
  const result = await verifyBackupDir(dir, { strict: true });
  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2));
    throw new Error(`Verification failed: ${result.errors.join("; ")}`);
  }
  console.log(JSON.stringify(result, null, 2));
  log("Verification OK");
  return result;
}

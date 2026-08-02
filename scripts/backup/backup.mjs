/**
 * Full backup: PostgreSQL + Redis + Uploads
 */
import { existsSync, statSync } from "node:fs";
import { writeFile, cp } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  compose,
  ensureDir,
  log,
  resolveConfig,
  sha256File,
  stamp,
  writeManifest,
  ROOT,
} from "./lib.mjs";

function dockerComposeSpawn(cfg, composeArgs) {
  const args = ["compose", "-f", cfg.composeFile];
  if (cfg.composeProject) args.push("-p", cfg.composeProject);
  args.push(...composeArgs);
  return spawn("docker", args, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    env: process.env,
  });
}

function collectBinary(child) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let stderr = "";
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => {
      stderr += c.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`command failed (${code}): ${stderr}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

async function fileMeta(relative, absPath) {
  return {
    file: relative,
    sha256: await sha256File(absPath),
    bytes: statSync(absPath).size,
  };
}

async function backupPostgres(cfg, destDir) {
  const outFile = path.join(destDir, "postgres.dump");
  log(`PostgreSQL dump → ${path.relative(ROOT, outFile)}`);

  const child = dockerComposeSpawn(cfg, [
    "exec",
    "-T",
    "-e",
    `PGPASSWORD=${cfg.postgresPassword}`,
    cfg.postgresService,
    "pg_dump",
    "-U",
    cfg.postgresUser,
    "-d",
    cfg.postgresDb,
    "-Fc",
    "--no-owner",
    "--no-acl",
  ]);

  const buf = await collectBinary(child);
  if (buf.length < 32) {
    throw new Error("pg_dump produced empty/too-small dump");
  }
  // Custom format starts with "PGDMP"
  if (buf.subarray(0, 5).toString("utf8") !== "PGDMP") {
    throw new Error("pg_dump output is not a valid custom-format dump");
  }
  await writeFile(outFile, buf);
  return fileMeta("postgres.dump", outFile);
}

async function backupRedis(cfg, destDir) {
  const redisDir = await ensureDir(path.join(destDir, "redis"));
  log("Redis BGSAVE + copy /data");

  try {
    await compose(cfg, ["exec", "-T", cfg.redisService, "redis-cli", "BGSAVE"]);
    await new Promise((r) => setTimeout(r, 1500));
  } catch (error) {
    log(`Redis BGSAVE warning: ${error.message}`);
  }

  const files = [];
  for (const name of ["dump.rdb", "appendonly.aof"]) {
    const hostFile = path.join(redisDir, name);
    try {
      await compose(cfg, [
        "cp",
        `${cfg.redisService}:/data/${name}`,
        hostFile,
      ]);
      if (existsSync(hostFile) && statSync(hostFile).size > 0) {
        files.push(await fileMeta(`redis/${name}`, hostFile));
      }
    } catch {
      /* optional */
    }
  }

  if (files.length === 0) {
    const tarPath = path.join(redisDir, "data.tar");
    const child = dockerComposeSpawn(cfg, [
      "exec",
      "-T",
      cfg.redisService,
      "sh",
      "-c",
      "cd /data && tar cf - .",
    ]);
    const buf = await collectBinary(child);
    await writeFile(tarPath, buf);
    files.push(await fileMeta("redis/data.tar", tarPath));
  }

  return files;
}

async function backupUploads(cfg, destDir) {
  const uploadsDir = await ensureDir(path.join(destDir, "uploads"));
  log("Uploads (.tmp/imports)");
  const artifacts = [];

  if (existsSync(cfg.uploadsHostPath)) {
    const target = path.join(uploadsDir, "imports");
    await cp(cfg.uploadsHostPath, target, { recursive: true, force: true });
    artifacts.push({
      file: "uploads/imports/",
      source: "host",
      path: cfg.uploadsHostPath,
    });
  }

  try {
    const containerTar = path.join(uploadsDir, "imports-container.tar");
    const child = dockerComposeSpawn(cfg, [
      "exec",
      "-T",
      cfg.appService,
      "sh",
      "-c",
      `if [ -d "${cfg.uploadsContainerPath}" ]; then cd "${cfg.uploadsContainerPath}" && tar cf - .; else exit 0; fi`,
    ]);
    const buf = await collectBinary(child).catch(() => Buffer.alloc(0));
    if (buf.length > 0) {
      await writeFile(containerTar, buf);
      artifacts.push({
        ...(await fileMeta("uploads/imports-container.tar", containerTar)),
        source: "container",
      });
    }
  } catch (error) {
    log(`Uploads container skip: ${error.message}`);
  }

  if (artifacts.length === 0) {
    const empty = path.join(uploadsDir, "EMPTY.txt");
    await writeFile(
      empty,
      "No import uploads present at backup time (ephemeral .tmp/imports).\n",
      "utf8",
    );
    artifacts.push({ file: "uploads/EMPTY.txt", empty: true });
  }

  return artifacts;
}

export async function runBackup(cliOpts = {}) {
  const cfg = resolveConfig(cliOpts);
  if (!cfg.postgresPassword) {
    throw new Error(
      "POSTGRES_PASSWORD missing — set env or secrets/postgres_password.txt",
    );
  }

  await ensureDir(cfg.backupDir);
  const id = stamp();
  const destDir = await ensureDir(path.join(cfg.backupDir, id));
  log(`Starting backup ${id}`);
  log(`Compose: ${cfg.composeFile} · DB=${cfg.postgresDb}`);

  const startedAt = new Date().toISOString();
  const postgres = await backupPostgres(cfg, destDir);
  const redis = await backupRedis(cfg, destDir);
  const uploads = await backupUploads(cfg, destDir);

  const manifest = {
    version: 1,
    id,
    startedAt,
    finishedAt: new Date().toISOString(),
    composeFile: cfg.composeFile,
    postgres: {
      database: cfg.postgresDb,
      user: cfg.postgresUser,
      ...postgres,
    },
    redis,
    uploads,
    host: {
      platform: process.platform,
      node: process.version,
    },
  };

  await writeManifest(destDir, manifest);

  const { verifyBackupDir } = await import("./verify.mjs");
  const verification = await verifyBackupDir(destDir, { strict: true });
  await writeFile(
    path.join(destDir, "VERIFY.json"),
    `${JSON.stringify(verification, null, 2)}\n`,
    "utf8",
  );

  if (!verification.ok) {
    throw new Error(
      `Backup verification failed: ${verification.errors.join("; ")}`,
    );
  }

  log(`Backup OK → ${path.relative(ROOT, destDir)}`);
  return { id, destDir, manifest, verification };
}

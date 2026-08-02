/**
 * Restore PostgreSQL (+ optional Redis / Uploads) from a backup directory
 *
 * SAFETY: requires --confirm=restore
 */
import { existsSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  compose,
  fail,
  listBackupDirs,
  log,
  readManifest,
  resolveConfig,
  ROOT,
} from "./lib.mjs";
import { verifyBackupDir } from "./verify.mjs";

async function restorePostgres(cfg, dumpPath) {
  log(`Restoring PostgreSQL from ${path.relative(ROOT, dumpPath)}`);

  await compose(
    cfg,
    [
      "exec",
      "-T",
      "-e",
      `PGPASSWORD=${cfg.postgresPassword}`,
      cfg.postgresService,
      "psql",
      "-U",
      cfg.postgresUser,
      "-d",
      cfg.postgresDb,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO PUBLIC;",
    ],
    { inherit: true },
  );

  const remote = "/tmp/restore.dump";
  await compose(cfg, ["cp", dumpPath, `${cfg.postgresService}:${remote}`]);

  // pg_restore exit 1 can mean warnings — accept 0/1 if tables exist afterwards
  try {
    await compose(
      cfg,
      [
        "exec",
        "-T",
        "-e",
        `PGPASSWORD=${cfg.postgresPassword}`,
        cfg.postgresService,
        "pg_restore",
        "-U",
        cfg.postgresUser,
        "-d",
        cfg.postgresDb,
        "--no-owner",
        "--no-acl",
        "--clean",
        "--if-exists",
        remote,
      ],
      { inherit: true },
    );
  } catch (error) {
    log(`pg_restore warnings (continuing to post-check): ${error.message}`);
  }

  await compose(cfg, [
    "exec",
    "-T",
    cfg.postgresService,
    "rm",
    "-f",
    remote,
  ]).catch(() => undefined);

  log("PostgreSQL restore command finished");
}

async function restoreRedis(cfg, backupDir, manifest) {
  const redisItems = Array.isArray(manifest.redis) ? manifest.redis : [];
  const rdb = redisItems.find((i) => i.file?.endsWith("dump.rdb"));
  const aof = redisItems.find((i) => i.file?.endsWith("appendonly.aof"));

  if (!rdb && !aof) {
    log("No dump.rdb/appendonly.aof in backup — skipping Redis restore");
    return;
  }

  log("Restoring Redis files (stop → copy → start)");
  await compose(cfg, ["stop", cfg.redisService], { inherit: true });

  try {
    if (rdb) {
      await compose(cfg, [
        "cp",
        path.join(backupDir, rdb.file),
        `${cfg.redisService}:/data/dump.rdb`,
      ]);
    }
    if (aof) {
      await compose(cfg, [
        "cp",
        path.join(backupDir, aof.file),
        `${cfg.redisService}:/data/appendonly.aof`,
      ]);
    }
  } finally {
    await compose(cfg, ["start", cfg.redisService], { inherit: true });
  }

  await new Promise((r) => setTimeout(r, 2000));
  await compose(cfg, ["exec", "-T", cfg.redisService, "redis-cli", "PING"], {
    inherit: true,
  });
  log("Redis restore complete");
}

async function restoreUploads(cfg, backupDir) {
  const hostImports = path.join(backupDir, "uploads", "imports");
  const containerTar = path.join(
    backupDir,
    "uploads",
    "imports-container.tar",
  );

  if (existsSync(hostImports)) {
    await mkdir(cfg.uploadsHostPath, { recursive: true });
    await cp(hostImports, cfg.uploadsHostPath, {
      recursive: true,
      force: true,
    });
    log(`Uploads restored to host ${cfg.uploadsHostPath}`);
  }

  if (existsSync(containerTar)) {
    try {
      await compose(cfg, [
        "cp",
        containerTar,
        `${cfg.appService}:/tmp/imports-restore.tar`,
      ]);
      await compose(cfg, [
        "exec",
        "-T",
        cfg.appService,
        "sh",
        "-c",
        `mkdir -p ${cfg.uploadsContainerPath} && tar xf /tmp/imports-restore.tar -C ${cfg.uploadsContainerPath}`,
      ]);
      log("Uploads restored into app container");
    } catch (error) {
      log(`Uploads container restore skipped: ${error.message}`);
    }
  }
}

async function postRestoreCheck(cfg) {
  const result = await compose(cfg, [
    "exec",
    "-T",
    "-e",
    `PGPASSWORD=${cfg.postgresPassword}`,
    cfg.postgresService,
    "psql",
    "-U",
    cfg.postgresUser,
    "-d",
    cfg.postgresDb,
    "-tAc",
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';",
  ]);
  const tables = Number(String(result.stdout).trim());
  if (!Number.isFinite(tables) || tables < 1) {
    throw new Error("Post-restore check failed: no public tables");
  }
  log(`Post-restore OK — public tables=${tables}`);
  return { tables };
}

export async function runRestore(cliOpts = {}) {
  const cfg = resolveConfig(cliOpts);
  if (cliOpts.confirm !== "restore") {
    fail("Refusing restore — pass --confirm=restore");
  }
  if (!cfg.postgresPassword) {
    fail("POSTGRES_PASSWORD missing");
  }

  const target =
    cliOpts.id ||
    process.env.BACKUP_ID ||
    listBackupDirs(cfg.backupDir)[0];
  if (!target) fail(`No backup found in ${cfg.backupDir}`);

  const dir = path.isAbsolute(target)
    ? target
    : path.join(cfg.backupDir, target);

  log(`Restore from ${dir}`);
  const verification = await verifyBackupDir(dir, { strict: true });
  if (!verification.ok) {
    fail(`Backup failed verification: ${verification.errors.join("; ")}`);
  }

  const manifest = await readManifest(dir);
  const dump = path.join(dir, manifest.postgres.file || "postgres.dump");
  if (!existsSync(dump)) fail("postgres.dump missing");

  const components = new Set(
    String(cliOpts.components || "postgres,redis,uploads")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  if (components.has("postgres")) await restorePostgres(cfg, dump);
  if (components.has("redis")) await restoreRedis(cfg, dir, manifest);
  if (components.has("uploads")) await restoreUploads(cfg, dir);

  const check = await postRestoreCheck(cfg);
  log("Restore finished successfully");
  return { id: manifest.id, check, verification };
}

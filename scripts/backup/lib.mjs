/**
 * Shared helpers — Phase 10 Backup
 */
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "../..");

export function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function resolveConfig(cli = {}) {
  const envFiles = [
    loadEnvFile(path.join(ROOT, ".env")),
    loadEnvFile(path.join(ROOT, ".env.staging")),
  ];
  const fileEnv = Object.assign({}, ...envFiles);

  const composeFile =
    cli.composeFile ||
    process.env.BACKUP_COMPOSE_FILE ||
    fileEnv.BACKUP_COMPOSE_FILE ||
    "docker-compose.yml";

  const backupDir = path.resolve(
    ROOT,
    cli.backupDir ||
      process.env.BACKUP_DIR ||
      fileEnv.BACKUP_DIR ||
      "backups",
  );

  const postgresPasswordFile = path.join(
    ROOT,
    "secrets",
    "postgres_password.txt",
  );
  let postgresPassword =
    process.env.POSTGRES_PASSWORD ||
    fileEnv.POSTGRES_PASSWORD ||
    process.env.PGPASSWORD ||
    "";
  if (
    (!postgresPassword || postgresPassword.includes("CHANGE_ME")) &&
    existsSync(postgresPasswordFile)
  ) {
    postgresPassword = readFileSync(postgresPasswordFile, "utf8").trim();
  }

  return {
    root: ROOT,
    composeFile,
    composeProject: process.env.COMPOSE_PROJECT_NAME || undefined,
    postgresService:
      process.env.BACKUP_POSTGRES_SERVICE ||
      fileEnv.BACKUP_POSTGRES_SERVICE ||
      "postgres",
    redisService:
      process.env.BACKUP_REDIS_SERVICE ||
      fileEnv.BACKUP_REDIS_SERVICE ||
      "redis",
    appService:
      process.env.BACKUP_APP_SERVICE || fileEnv.BACKUP_APP_SERVICE || "app",
    postgresUser:
      process.env.POSTGRES_USER || fileEnv.POSTGRES_USER || "botoschool",
    postgresDb:
      process.env.POSTGRES_DB || fileEnv.POSTGRES_DB || "botoschool_email",
    postgresPassword,
    backupDir,
    retentionDays: Number(
      process.env.BACKUP_RETENTION_DAYS || fileEnv.BACKUP_RETENTION_DAYS || 14,
    ),
    retentionCount: Number(
      process.env.BACKUP_RETENTION_COUNT ||
        fileEnv.BACKUP_RETENTION_COUNT ||
        30,
    ),
    uploadsHostPath: path.resolve(
      ROOT,
      process.env.IMPORT_TMP_DIR ||
        fileEnv.IMPORT_TMP_DIR ||
        path.join(".tmp", "imports"),
    ),
    uploadsContainerPath:
      process.env.BACKUP_UPLOADS_CONTAINER_PATH || "/app/.tmp/imports",
  };
}

export function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd || ROOT,
      env: { ...process.env, ...opts.env },
      stdio: opts.stdio || ["ignore", "pipe", "pipe"],
      shell: opts.shell ?? process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    if (child.stdout) {
      child.stdout.on("data", (d) => {
        stdout += d.toString();
        if (opts.inherit) process.stdout.write(d);
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (d) => {
        stderr += d.toString();
        if (opts.inherit) process.stderr.write(d);
      });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ code, stdout, stderr });
      else {
        const err = new Error(
          `${cmd} ${args.join(" ")} failed (${code}): ${stderr || stdout}`,
        );
        err.code = code;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

export async function compose(cfg, args, opts = {}) {
  const base = ["compose", "-f", cfg.composeFile];
  if (cfg.composeProject) {
    base.push("-p", cfg.composeProject);
  }
  return run("docker", [...base, ...args], opts);
}

export async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
  return dir;
}

export function listBackupDirs(backupDir) {
  if (!existsSync(backupDir)) return [];
  return readdirSync(backupDir)
    .filter((name) => {
      const full = path.join(backupDir, name);
      return (
        statSync(full).isDirectory() &&
        existsSync(path.join(full, "manifest.json"))
      );
    })
    .sort()
    .reverse();
}

export async function writeManifest(dir, manifest) {
  const file = path.join(dir, "manifest.json");
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return file;
}

export async function readManifest(dir) {
  const raw = await readFile(path.join(dir, "manifest.json"), "utf8");
  return JSON.parse(raw);
}

export function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[backup ${ts}] ${msg}`);
}

export function fail(msg) {
  console.error(`[backup ERROR] ${msg}`);
  process.exit(1);
}

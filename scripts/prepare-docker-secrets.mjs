#!/usr/bin/env node
/**
 * Prépare ./secrets/*.txt pour Docker Compose (Phase 7).
 * Usage:
 *   node scripts/prepare-docker-secrets.mjs
 *   node scripts/prepare-docker-secrets.mjs --force
 *
 * Lit .env / .env.staging si présents, sinon génère des valeurs aléatoires.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const secretsDir = path.join(root, "secrets");
const force = process.argv.includes("--force");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
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

function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64");
}

function writeSecret(name, value) {
  const file = path.join(secretsDir, `${name}.txt`);
  if (fs.existsSync(file) && !force) {
    console.log(`skip  ${name}.txt (exists — use --force to overwrite)`);
    return;
  }
  fs.writeFileSync(file, `${value}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(`write ${name}.txt`);
}

fs.mkdirSync(secretsDir, { recursive: true });

const env = {
  ...loadEnvFile(path.join(root, ".env.production.example")),
  ...loadEnvFile(path.join(root, ".env.staging")),
  ...loadEnvFile(path.join(root, ".env")),
};

writeSecret(
  "postgres_password",
  env.POSTGRES_PASSWORD && !env.POSTGRES_PASSWORD.includes("CHANGE_ME")
    ? env.POSTGRES_PASSWORD
    : randomSecret(24),
);
writeSecret(
  "auth_secret",
  env.AUTH_SECRET && env.AUTH_SECRET.length >= 32
    ? env.AUTH_SECRET
    : randomSecret(32),
);
writeSecret(
  "webhook_secret",
  env.WEBHOOK_SECRET && env.WEBHOOK_SECRET.length >= 16
    ? env.WEBHOOK_SECRET
    : randomSecret(24),
);
// SMTP peut être vide (Mailpit staging)
writeSecret("smtp_password", env.SMTP_PASSWORD ?? "");

const gitkeep = path.join(secretsDir, ".gitkeep");
if (!fs.existsSync(gitkeep)) fs.writeFileSync(gitkeep, "");

console.log("");
console.log("Secrets ready in ./secrets/ (gitignored).");
console.log("Next:");
console.log("  docker compose -f docker-compose.production.yml up -d --build");
console.log("  docker compose -f docker-compose.staging.yml up -d --build");

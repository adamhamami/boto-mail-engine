import fs from "node:fs";
import path from "node:path";
import pino from "pino";
import { observabilityLogFields } from "@/lib/observability/context";

const nodeEnv = process.env.NODE_ENV ?? "development";
const isDev = nodeEnv === "development";
const forceJson = parseBool(process.env.LOG_JSON, !isDev);
const logToFile = parseBool(process.env.LOG_TO_FILE, false);

/**
 * Redaction Pino — aucun secret dans les logs.
 */
const REDACT_PATHS = [
  "password",
  "smtpPassword",
  "SMTP_PASSWORD",
  "authSecret",
  "AUTH_SECRET",
  "AUTH_SECRET_PREVIOUS",
  "webhookSecret",
  "WEBHOOK_SECRET",
  "BREVO_API_KEY",
  "SES_SECRET_ACCESS_KEY",
  "SES_ACCESS_KEY_ID",
  "apiKey",
  "api-key",
  "authorization",
  "cookie",
  "token",
  "accessToken",
  "refreshToken",
  "html",
  "bodyHtml",
  "rawPayload",
  "payload",
  "err.config.auth",
  "err.config.pass",
  "*.password",
  "*.token",
  "*.authorization",
  "*.smtpPassword",
  "*.AUTH_SECRET",
  "*.WEBHOOK_SECRET",
  "*.apiKey",
];

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  const n = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(n)) return true;
  if (["false", "0", "no"].includes(n)) return false;
  return fallback;
}

function buildTransport(): pino.TransportMultiOptions | pino.TransportSingleOptions | undefined {
  // Dev lisible sauf si LOG_JSON=true (CI / recette structurée).
  if (isDev && !forceJson && !logToFile) {
    return {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    };
  }

  if (!logToFile) {
    // Production : JSON stdout (collecteur / Docker) — pas de transport = JSON natif.
    return undefined;
  }

  const logDir = process.env.LOG_DIR?.trim() || "logs";
  const absDir = path.isAbsolute(logDir)
    ? logDir
    : path.join(/* turbopackIgnore: true */ process.cwd(), logDir);
  fs.mkdirSync(absDir, { recursive: true });

  const maxSize = process.env.LOG_MAX_SIZE?.trim() || "20m";
  const maxFiles = Number(process.env.LOG_MAX_FILES ?? "14") || 14;

  // Compression gzip : `startLogCompressionScheduler` (pas supportée nativement
  // par pino-roll@4) + docker json-file compress.
  const fileTarget = {
    target: "pino-roll",
    options: {
      file: path.join(absDir, "app"),
      frequency: "daily",
      mkdir: true,
      size: maxSize,
      extension: ".log",
      symlink: true,
      limit: { count: maxFiles },
    },
  };

  // stdout JSON + fichier rotaté/compressé
  return {
    targets: [
      { target: "pino/file", options: { destination: 1 }, level: process.env.LOG_LEVEL ?? "info" },
      { ...fileTarget, level: process.env.LOG_LEVEL ?? "info" },
    ],
  };
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  // Timestamp ISO — logs JSON structurés exploitables.
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  mixin() {
    return observabilityLogFields();
  },
  redact: {
    paths: REDACT_PATHS,
    censor: "[Redacted]",
  },
  transport: buildTransport(),
  base: {
    app: process.env.APP_NAME ?? "botoschool-email",
    env: nodeEnv,
  },
  messageKey: "msg",
});

export type Logger = typeof logger;

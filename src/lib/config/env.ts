import "dotenv/config";
import { z } from "zod";
import { applyDockerSecretFiles } from "@/lib/config/docker-secrets";

const DEV_TEST_AUTH_SECRET =
  "test-only-auth-secret-do-not-use-in-production!!";

const WEAK_AUTH_SECRETS = new Set([
  DEV_TEST_AUTH_SECRET,
  "dev-secret-change-me-in-production-min-32-chars!!",
  "generate-a-strong-secret-min-32-chars-here",
  "change-me",
  "build-time-secret-not-used-in-runtime-32chars",
]);

function parseBoolean(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
  }
  return defaultValue;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    APP_NAME: z.string().default("BotoSchool Email Platform"),
    APP_URL: z.string().default("http://localhost:3000"),

    DATABASE_URL: z
      .string()
      .default(
        "postgresql://botoschool:botoschool_secret@127.0.0.1:5433/botoschool_email?schema=public",
      ),

    REDIS_URL: z.string().default("redis://localhost:6379"),

    /** Requis en production (min 32). Dev/test : secret de test explicite si absent. */
    AUTH_SECRET: z.string().optional(),
    /**
     * Secret précédent pour rotation JWT sans déconnexion forcée de tous les clients.
     * Auth.js accepte un tableau de secrets (nouveau en premier).
     */
    AUTH_SECRET_PREVIOUS: z.string().optional().default(""),
    AUTH_URL: z.string().optional(),

    /** Durée session JWT (secondes) — défaut 30 jours CDC ops */
    AUTH_SESSION_MAX_AGE_SECONDS: z.coerce
      .number()
      .default(30 * 24 * 60 * 60),

    SMTP_HOST: z.string().default("localhost"),
    SMTP_PORT: z.coerce.number().default(587),
    SMTP_SECURE: z
      .union([z.boolean(), z.string()])
      .transform((v) => parseBoolean(v, false))
      .default(false),
    SMTP_USER: z.string().optional().default(""),
    SMTP_PASSWORD: z.string().optional().default(""),
    SMTP_FROM_NAME: z.string().default("BotoSchool"),
    SMTP_FROM_EMAIL: z.string().default("noreply@botoschool.com"),
    /** CSV d’hôtes SMTP autorisés en production (vide = pas de filtre code) */
    SMTP_HOST_ALLOWLIST: z.string().default(""),
    /**
     * Refuse d'envoyer si STARTTLS n'est pas disponible.
     * Défaut : true en production, false ailleurs (Mailpit local sans TLS).
     * Toujours forcé pour les relais publics (Brevo, Mailgun, Postmark, SES…).
     */
    SMTP_REQUIRE_TLS: z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((v) => (v === undefined || v === "" ? null : parseBoolean(v, true))),

    /**
     * Connecteur d'envoi. Tous passent par le relais SMTP du fournisseur
     * (presets dans src/lib/mail/providers.ts) — un seul chemin d'envoi.
     */
    MAIL_PROVIDER: z
      .enum(["smtp", "brevo", "mailgun", "postmark", "ses", "sendgrid"])
      .default("smtp"),

    /** Région du relais SMTP Amazon SES (email-smtp.<région>.amazonaws.com) */
    SES_REGION: z.string().default("eu-west-1"),

    /**
     * Identifiants LECTURE SEULE dédiés au quota SES (ses:GetAccount).
     * Distincts des identifiants SMTP SES — laisser vide désactive la lecture.
     */
    SES_ACCESS_KEY_ID: z.string().optional().default(""),
    SES_SECRET_ACCESS_KEY: z.string().optional().default(""),

    /** Clé API Brevo v3 — lecture du quota uniquement (jamais l'envoi). */
    BREVO_API_KEY: z.string().optional().default(""),

    /** Santé SMTP : sonde réseau (handshake seul, aucun email envoyé) */
    SMTP_HEALTH_PROBE_ENABLED: z
      .union([z.boolean(), z.string()])
      .transform((v) => parseBoolean(v, true))
      .default(true),
    /** Durée de fraîcheur d'un rapport avant re-test automatique */
    SMTP_HEALTH_CACHE_TTL_MS: z.coerce.number().default(300_000),
    /** Budget temps par étape de la sonde SMTP */
    SMTP_PROBE_TIMEOUT_MS: z.coerce.number().default(8000),

    /**
     * Sélecteurs DKIM à sonder (CSV). Vide = presets selon MAIL_PROVIDER.
     * Ex. brevo : mail,brevo — postmark : pm — sendgrid : s1,s2
     */
    DKIM_SELECTORS: z.string().optional().default(""),
    /** Fraîcheur du rapport DNS avant re-test automatique */
    DNS_HEALTH_CACHE_TTL_MS: z.coerce.number().default(300_000),
    /** Budget temps par requête DNS */
    DNS_PROBE_TIMEOUT_MS: z.coerce.number().default(5000),

    /** Fenêtre glissante des métriques email (minutes) */
    MONITORING_METRICS_WINDOW_MINUTES: z.coerce.number().default(60),
    /** Alertes automatiques (Phase 4 Monitoring) */
    ALERT_DLQ_MAX: z.coerce.number().default(0),
    ALERT_QUEUE_WAITING_MAX: z.coerce.number().default(500),
    ALERT_BOUNCE_RATE_MAX: z.coerce.number().default(0.05),
    ALERT_FAILURE_RATE_MAX: z.coerce.number().default(0.1),
    ALERT_RETRIES_MAX: z.coerce.number().default(50),
    ALERT_WORKER_STALE_MS: z.coerce.number().default(60_000),
    ALERT_CPU_PERCENT_MAX: z.coerce.number().default(90),
    ALERT_RAM_PERCENT_MAX: z.coerce.number().default(90),
    /**
     * Token Bearer pour scrape Prometheus (optionnel).
     * Si défini : `Authorization: Bearer <token>` bypasse la session cookie.
     * Si vide : session ops:read uniquement.
     */
    METRICS_SCRAPE_TOKEN: z.string().optional().default(""),
    /** Webhook JSON quand le set d'alertes change (Slack/Teams/custom). */
    ALERT_WEBHOOK_URL: z.string().optional().default(""),
    /** URL Grafana affichée dans l'UI ops (lien optionnel). */
    OBSERVABILITY_GRAFANA_URL: z.string().optional().default(""),
    /** Intervalle d'écriture du heartbeat worker (ms) */
    WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().default(15_000),
    /** TTL du lock leader (ms) — renew ~ttl/3 */
    HA_LEADER_TTL_MS: z.coerce.number().default(15_000),
    /** Timeout drain workers / API avant exit forcé (ms) */
    HA_SHUTDOWN_TIMEOUT_MS: z.coerce.number().default(30_000),
    /** TTL verrou d'envoi distribué (ms) — anti double SMTP */
    HA_SEND_LOCK_TTL_MS: z.coerce.number().default(120_000),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
    /**
     * Store rate-limit multi-instance API.
     * auto = redis en production, memory sinon (tests/dev).
     */
    RATE_LIMIT_STORE: z.enum(["auto", "memory", "redis"]).default("auto"),

    /** Anti brute-force login (séparé du rate-limit API générique) */
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().default(5),
    LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900_000),

    EMAIL_QUEUE_CONCURRENCY: z.coerce.number().default(5),
    EMAIL_QUEUE_MAX_RETRIES: z.coerce.number().default(3),
    EMAIL_QUEUE_BACKOFF_MS: z.coerce.number().default(5000),
    /** Jitter ajouté au backoff exponentiel (anti-thundering herd) */
    EMAIL_QUEUE_BACKOFF_JITTER_MS: z.coerce.number().default(1000),
    /** Rétention jobs completed (BullMQ) */
    EMAIL_QUEUE_COMPLETE_RETENTION_COUNT: z.coerce.number().default(1000),
    EMAIL_QUEUE_COMPLETE_RETENTION_AGE_SEC: z.coerce
      .number()
      .default(24 * 3600),
    /** Rétention jobs failed (évite Redis infini) */
    EMAIL_QUEUE_FAIL_RETENTION_COUNT: z.coerce.number().default(5000),
    EMAIL_QUEUE_FAIL_RETENTION_AGE_SEC: z.coerce
      .number()
      .default(7 * 24 * 3600),
    /** Cache dashboard (secondes) — 0 = désactivé */
    DASHBOARD_CACHE_TTL_SECONDS: z.coerce.number().default(30),

    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace"])
      .default("info"),
    /**
     * Force les logs JSON même en development.
     * Défaut : true hors development (stdout JSON natif Pino).
     */
    LOG_JSON: z
      .union([z.boolean(), z.string()])
      .transform((v) => parseBoolean(v, process.env.NODE_ENV !== "development"))
      .default(process.env.NODE_ENV !== "development"),
    /** Active l'écriture fichier rotatée (pino-roll) en plus de stdout. */
    LOG_TO_FILE: z
      .union([z.boolean(), z.string()])
      .transform((v) => parseBoolean(v, false))
      .default(false),
    LOG_DIR: z.string().default("logs"),
    /** Taille max par fichier avant rotation (ex. 20m) */
    LOG_MAX_SIZE: z.string().default("20m"),
    /** Nombre max de fichiers rotatés conservés */
    LOG_MAX_FILES: z.coerce.number().default(14),
    /** Compression gzip des fichiers rotatés */
    LOG_COMPRESS: z
      .union([z.boolean(), z.string()])
      .transform((v) => parseBoolean(v, true))
      .default(true),

    WORKER_ENABLED: z
      .union([z.boolean(), z.string()])
      .transform((v) => parseBoolean(v, true))
      .default(true),

    /** CDC : true par défaut — aucun SMTP/API fournisseur */
    DRY_RUN: z
      .union([z.boolean(), z.string()])
      .transform((v) => parseBoolean(v, true))
      .default(true),

    /** Envoi production réel (hors mode test) */
    PRODUCTION_SENDING_ENABLED: z
      .union([z.boolean(), z.string()])
      .transform((v) => parseBoolean(v, false))
      .default(false),

    /**
     * Autorise SMTP réel pour campagnes isTestMode=true.
     * Exige aussi DRY_RUN=false, allowlist, et NODE_ENV dans SMTP_ALLOWED_NODE_ENVS.
     */
    ALLOW_TEST_SMTP: z
      .union([z.boolean(), z.string()])
      .transform((v) => parseBoolean(v, false))
      .default(false),

    /** Emails de test autorisés, séparés par des virgules */
    TEST_EMAIL_ALLOWLIST: z.string().default(""),

    /** Domaines de test autorisés (ex. botoschool.ma), séparés par des virgules */
    TEST_DOMAIN_ALLOWLIST: z.string().default(""),

    /**
     * Environnements où un SMTP réel est autorisé (CSV).
     * Défaut : production uniquement.
     */
    SMTP_ALLOWED_NODE_ENVS: z.string().default("production"),

    /** Secret HMAC webhooks entrants (requis en production) */
    WEBHOOK_SECRET: z.string().optional().default(""),
    /** Fenêtre anti-replay (secondes) */
    WEBHOOK_MAX_AGE_SECONDS: z.coerce.number().default(300),
    /** Taille max payload webhook (bytes) */
    WEBHOOK_MAX_PAYLOAD_BYTES: z.coerce.number().default(65_536),
    /** Soft bounce : retries max avant arrêt */
    SOFT_BOUNCE_MAX_RETRIES: z.coerce.number().default(3),
    /** Pause auto si taux hard-bounce (0–1) sur fenêtre récente dépasse ce seuil */
    AUTO_PAUSE_HARD_BOUNCE_RATE: z.coerce.number().min(0).max(1).default(0.05),
    /** Minimum d’événements bounce avant d’évaluer le taux */
    AUTO_PAUSE_MIN_EVENTS: z.coerce.number().default(20),
    AUTO_PAUSE_COMPLAINT_RATE: z.coerce.number().min(0).max(1).default(0.02),
    AUTO_PAUSE_PROVIDER_ERROR_RATE: z.coerce
      .number()
      .min(0)
      .max(1)
      .default(0.1),
    AUTO_PAUSE_VOLUME_ANOMALY_MULTIPLIER: z.coerce.number().default(3),

    /** Quotas d’envoi (Redis — multi-worker) */
    SEND_QUOTA_PER_HOUR: z.coerce.number().default(200),
    SEND_QUOTA_PER_DAY: z.coerce.number().default(2000),
    SEND_QUOTA_PER_CONNECTOR: z.coerce.number().default(200),
    SEND_QUOTA_PER_SENDER_DOMAIN: z.coerce.number().default(2000),
    SEND_QUOTA_PER_CAMPAIGN: z.coerce.number().default(100),

    /** Fuseau campagne par défaut CDC */
    CAMPAIGN_DEFAULT_TIMEZONE: z.string().default("Africa/Casablanca"),
    /** Créneau lun–ven start (heure civile fuseau) */
    SEND_WINDOW_START_HOUR: z.coerce.number().min(0).max(23).default(9),
    SEND_WINDOW_END_HOUR: z.coerce.number().min(1).max(24).default(18),
    /** Jours autorisés CSV 0=dim..6=sam — défaut lun–ven */
    SEND_WINDOW_WEEKDAYS: z.string().default("1,2,3,4,5"),

    /** Imports CSV/XLSX */
    IMPORT_MAX_FILE_BYTES: z.coerce.number().default(5 * 1024 * 1024),
    IMPORT_MAX_ROWS: z.coerce.number().default(10_000),
    /** Répertoire des imports temporaires (backup Phase 10) */
    IMPORT_TMP_DIR: z.string().default(".tmp/imports"),

    /** Répertoire des sauvegardes (scripts/backup) */
    BACKUP_DIR: z.string().default("backups"),
    BACKUP_RETENTION_DAYS: z.coerce.number().default(14),
    BACKUP_RETENTION_COUNT: z.coerce.number().default(30),
    BACKUP_COMPOSE_FILE: z.string().default("docker-compose.yml"),

    /** Conformité CNDP / Loi 09-08 (Phase 13) */
    COMPLIANCE_CONTROLLER_NAME: z
      .string()
      .default("BotoSchool — Plateforme Email"),
    COMPLIANCE_DPO_EMAIL: z
      .union([z.string().email(), z.literal("")])
      .default(""),
    DATA_RETENTION_ENABLED: z
      .union([z.boolean(), z.string()])
      .transform((v) => parseBoolean(v, false))
      .default(false),
    /** Soft-delete → anonymisation auto après N jours */
    DATA_RETENTION_SOFT_DELETE_DAYS: z.coerce.number().default(90),
    /** Purge events métier après N jours */
    DATA_RETENTION_EVENT_DAYS: z.coerce.number().default(365),
    /** Purge audit (hors module compliance) après N jours */
    DATA_RETENTION_AUDIT_DAYS: z.coerce.number().default(730),
    /** Intervalle job rétention worker (ms) — défaut 24h */
    DATA_RETENTION_INTERVAL_MS: z.coerce
      .number()
      .default(24 * 60 * 60 * 1000),

    /** CSP : true = header enforce ; report-only si CSP_REPORT_ONLY=true */
    CSP_ENABLED: z
      .union([z.boolean(), z.string()])
      .transform((v) => parseBoolean(v, true))
      .default(true),
    CSP_REPORT_ONLY: z
      .union([z.boolean(), z.string()])
      .transform((v) => parseBoolean(v, false))
      .default(false),
  })
  .superRefine((data, ctx) => {
    const secret = data.AUTH_SECRET?.trim() ?? "";
    const previous = data.AUTH_SECRET_PREVIOUS?.trim() ?? "";
    const webhookSecret = data.WEBHOOK_SECRET?.trim() ?? "";

    // next build force NODE_ENV=production pendant la collecte des pages —
    // ne pas appliquer les règles runtime prod (HTTPS / secrets) à ce moment.
    const isNextBuild =
      process.env.NEXT_PHASE === "phase-production-build" ||
      process.env.NEXT_PHASE === "phase-export";

    if (data.NODE_ENV === "production" && !isNextBuild) {
      if (secret.length < 32) {
        ctx.addIssue({
          code: "custom",
          path: ["AUTH_SECRET"],
          message:
            "AUTH_SECRET is required in production and must be at least 32 characters",
        });
      } else if (WEAK_AUTH_SECRETS.has(secret)) {
        ctx.addIssue({
          code: "custom",
          path: ["AUTH_SECRET"],
          message:
            "AUTH_SECRET must not use a known weak or documentation placeholder value in production",
        });
      }
      if (previous.length > 0 && previous.length < 32) {
        ctx.addIssue({
          code: "custom",
          path: ["AUTH_SECRET_PREVIOUS"],
          message:
            "AUTH_SECRET_PREVIOUS must be at least 32 characters when provided",
        });
      }
      if (webhookSecret.length < 32) {
        ctx.addIssue({
          code: "custom",
          path: ["WEBHOOK_SECRET"],
          message:
            "WEBHOOK_SECRET is required in production (min 32 characters)",
        });
      }
      if (!isHttpsUrl(data.APP_URL)) {
        ctx.addIssue({
          code: "custom",
          path: ["APP_URL"],
          message: "APP_URL must be an https:// URL in production",
        });
      }
      const authUrl = data.AUTH_URL?.trim() || data.APP_URL;
      if (!isHttpsUrl(authUrl)) {
        ctx.addIssue({
          code: "custom",
          path: ["AUTH_URL"],
          message: "AUTH_URL must be an https:// URL in production",
        });
      }
      if (
        data.PRODUCTION_SENDING_ENABLED &&
        data.DRY_RUN === false &&
        data.SMTP_HOST_ALLOWLIST.trim().length === 0
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["SMTP_HOST_ALLOWLIST"],
          message:
            "SMTP_HOST_ALLOWLIST is required when PRODUCTION_SENDING_ENABLED=true and DRY_RUN=false",
        });
      }
      return;
    }

    if (secret.length > 0 && secret.length < 32) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_SECRET"],
        message: "AUTH_SECRET must be at least 32 characters when provided",
      });
    }
  })
  .transform((data) => {
    const isProd = data.NODE_ENV === "production";
    const authSecret =
      data.AUTH_SECRET?.trim() || (isProd ? "" : DEV_TEST_AUTH_SECRET);
    const webhookSecret =
      data.WEBHOOK_SECRET?.trim() ||
      (isProd ? "" : "test-only-webhook-secret-do-not-use-in-prod!!");

    return {
      ...data,
      AUTH_SECRET: authSecret,
      AUTH_SECRET_PREVIOUS: data.AUTH_SECRET_PREVIOUS?.trim() ?? "",
      WEBHOOK_SECRET: webhookSecret,
      DRY_RUN: data.DRY_RUN,
      PRODUCTION_SENDING_ENABLED: data.PRODUCTION_SENDING_ENABLED,
      ALLOW_TEST_SMTP: data.ALLOW_TEST_SMTP,
      WORKER_ENABLED: data.WORKER_ENABLED,
      SMTP_SECURE: data.SMTP_SECURE,
      SMTP_REQUIRE_TLS: data.SMTP_REQUIRE_TLS ?? isProd,
      SMTP_HEALTH_PROBE_ENABLED: data.SMTP_HEALTH_PROBE_ENABLED,
      CSP_ENABLED: data.CSP_ENABLED,
      CSP_REPORT_ONLY: data.CSP_REPORT_ONLY,
    };
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function resetEnvCache(): void {
  cached = null;
}

export function getEnv(): Env {
  if (cached) return cached;
  applyDockerSecretFiles(process.env);
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const fieldErrors = result.error.flatten().fieldErrors;
    console.error("Invalid environment variables:", Object.keys(fieldErrors));
    throw new Error("Invalid environment configuration");
  }
  cached = result.data;
  return cached;
}

/** Secrets Auth.js (courant + précédent pour rotation). */
export function getAuthSecrets(): string[] {
  const env = getEnv();
  const secrets = [env.AUTH_SECRET];
  if (env.AUTH_SECRET_PREVIOUS) {
    secrets.push(env.AUTH_SECRET_PREVIOUS);
  }
  return secrets;
}

/** Lazy proxy — safe for Next.js edge/build imports */
export const env = new Proxy({} as Env, {
  get(_target, prop: string) {
    return getEnv()[prop as keyof Env];
  },
});

export const TEST_ONLY_AUTH_SECRET = DEV_TEST_AUTH_SECRET;

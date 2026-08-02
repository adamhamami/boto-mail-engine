import { getEnv } from "@/lib/config/env";
import { logger } from "@/lib/logger";
import { getRedisConnection } from "@/lib/queue";
import { getQuotaStore } from "@/lib/campaign-engine/quotas";
import {
  DEFAULT_CAMPAIGN_TIMEZONE,
  getZonedParts,
} from "@/lib/campaign-engine/timezone";
import { withHealthTimeout } from "@/lib/observability/health-timeout";
import {
  maskSmtpHost,
  resolveMailConnectorConfig,
  sanitizeSmtpMessage,
} from "./providers";
import type { MailConnectorConfig, MailConnectorId } from "./providers";
import { createSmtpProvider } from "./smtp-provider";
import type { SmtpAuthCheckResult } from "./smtp-provider";
import { probeSmtpConnection } from "./smtp-diagnostics";
import type {
  SmtpCertificateInfo,
  SmtpProbeError,
  SmtpProbeTimings,
  SmtpTlsInfo,
} from "./smtp-diagnostics";
import { fetchProviderQuota } from "./provider-quota";
import type { ProviderQuotaResult } from "./provider-quota";

/**
 * Rapport « Santé SMTP ».
 *
 * Aucune donnée sensible n'est exposée : hôte masqué, identifiants absents,
 * messages d'erreur expurgés. Le rapport ne déclenche jamais d'envoi d'email —
 * uniquement une poignée de main et une commande AUTH.
 */

const REDIS_CACHE_KEY = "smtp:health:last";
const REDIS_CACHE_TTL_SECONDS = 7 * 24 * 3600;
const REDIS_TIMEOUT_MS = 1500;
const QUOTA_TIMEOUT_MS = 2000;
/**
 * Seuil d'alerte sur l'expiration du certificat serveur.
 * 7 jours : les relais publics renouvellent souvent leurs certificats
 * Let's Encrypt tardivement, un seuil plus large alerterait en permanence.
 */
export const CERT_EXPIRY_WARNING_DAYS = 7;
/** Seuil de consommation des quotas locaux déclenchant un état dégradé. */
export const QUOTA_WARNING_RATIO = 0.9;

export type SmtpHealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export interface LocalQuotaUsage {
  label: string;
  used: number | null;
  limit: number;
  window: string;
}

export interface SmtpHealthReport {
  generatedAt: string;
  lastTestAt: string;
  durationMs: number;
  status: SmtpHealthStatus;
  /** Rapport servi depuis le cache (aucune connexion réseau ouverte). */
  cached: boolean;
  /** Invariant : la sonde n'envoie jamais de message. */
  probeSendsEmail: false;
  connector: {
    id: MailConnectorId;
    label: string;
    hostMasked: string;
    port: number;
    encryption: string;
    requireTls: boolean;
    hostSource: "preset" | "env";
    credentialsConfigured: boolean;
    fromName: string;
    fromEmail: string;
    docsUrl: string;
  };
  connection: {
    reachable: boolean;
    greeting: string | null;
    capabilities: string[];
    starttlsAdvertised: boolean;
    authMechanisms: string[];
    maxMessageBytes: number | null;
    tls: SmtpTlsInfo;
  };
  certificate: SmtpCertificateInfo | null;
  timings: SmtpProbeTimings & { authMs: number | null };
  authentication: SmtpAuthCheckResult;
  quota: {
    local: LocalQuotaUsage[];
    provider: ProviderQuotaResult;
  };
  gates: {
    dryRun: boolean;
    productionSendingEnabled: boolean;
    allowTestSmtp: boolean;
    nodeEnv: string;
    hostAllowlistConfigured: boolean;
  };
  errors: Array<SmtpProbeError & { at: string }>;
  warnings: string[];
}

let inFlight: Promise<SmtpHealthReport> | null = null;
let memoryCache: SmtpHealthReport | null = null;

/** Tests uniquement — vide les caches mémoire du rapport. */
export function resetSmtpHealthCache(): void {
  inFlight = null;
  memoryCache = null;
}

function emptyTls(): SmtpTlsInfo {
  return {
    negotiated: false,
    mode: "none",
    protocol: null,
    cipher: null,
    authorized: false,
    authorizationError: null,
  };
}

function senderDomain(fromEmail: string): string {
  return fromEmail.split("@")[1]?.toLowerCase() ?? "unknown";
}

async function readLocalQuotas(
  connector: MailConnectorConfig,
): Promise<LocalQuotaUsage[]> {
  const env = getEnv();
  const now = new Date();
  const zoned = getZonedParts(now, DEFAULT_CAMPAIGN_TIMEZONE);
  const day = `${zoned.year}${String(zoned.month).padStart(2, "0")}${String(zoned.day).padStart(2, "0")}`;
  const hour = `${day}${String(zoned.hour).padStart(2, "0")}`;
  const domain = senderDomain(connector.fromEmail);

  const definitions: Array<{
    label: string;
    key: string;
    limit: number;
    window: string;
  }> = [
    {
      label: "Global horaire",
      key: `quota:hour:global:${hour}`,
      limit: env.SEND_QUOTA_PER_HOUR,
      window: "heure",
    },
    {
      label: "Global journalier",
      key: `quota:day:global:${day}`,
      limit: env.SEND_QUOTA_PER_DAY,
      window: "jour",
    },
    {
      label: `Connecteur ${connector.connectorId}`,
      key: `quota:hour:connector:${env.MAIL_PROVIDER}:${hour}`,
      limit: env.SEND_QUOTA_PER_CONNECTOR,
      window: "heure",
    },
    {
      label: `Domaine ${domain}`,
      key: `quota:day:domain:${domain}:${day}`,
      limit: env.SEND_QUOTA_PER_SENDER_DOMAIN,
      window: "jour",
    },
  ];

  const store = getQuotaStore();

  return Promise.all(
    definitions.map(async (definition) => ({
      label: definition.label,
      limit: definition.limit,
      window: definition.window,
      used: await withHealthTimeout(
        `quota:${definition.key}`,
        () => store.get(definition.key),
        QUOTA_TIMEOUT_MS,
      ).catch(() => null),
    })),
  );
}

async function readCachedReport(): Promise<SmtpHealthReport | null> {
  if (memoryCache) return memoryCache;

  try {
    const raw = await withHealthTimeout(
      "smtp-health:cache-read",
      () => getRedisConnection().get(REDIS_CACHE_KEY),
      REDIS_TIMEOUT_MS,
    );
    if (!raw) return null;
    memoryCache = JSON.parse(raw) as SmtpHealthReport;
    return memoryCache;
  } catch {
    return null;
  }
}

async function persistReport(report: SmtpHealthReport): Promise<void> {
  memoryCache = report;
  try {
    await withHealthTimeout(
      "smtp-health:cache-write",
      () =>
        getRedisConnection().set(
          REDIS_CACHE_KEY,
          JSON.stringify(report),
          "EX",
          REDIS_CACHE_TTL_SECONDS,
        ),
      REDIS_TIMEOUT_MS,
    );
  } catch {
    // Cache best-effort : la mémoire du process suffit à servir la page.
  }
}

function isFresh(report: SmtpHealthReport, ttlMs: number): boolean {
  const age = Date.now() - new Date(report.generatedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < ttlMs;
}

/**
 * Règles de statut, isolées du réseau pour être testables.
 * Injoignable ou authentification refusée ⇒ hors service ; TLS absent,
 * certificat proche de l'expiration ou quota saturé ⇒ dégradé.
 */
export function evaluateSmtpHealthStatus(report: SmtpHealthReport): {
  status: SmtpHealthStatus;
  warnings: string[];
} {
  const warnings: string[] = [];

  if (!report.connection.reachable) {
    return {
      status: "unhealthy",
      warnings: ["Serveur SMTP injoignable"],
    };
  }

  if (report.authentication.status === "failed") {
    return { status: "unhealthy", warnings: ["Authentification SMTP refusée"] };
  }

  let degraded = false;

  if (report.connector.requireTls && !report.connection.tls.negotiated) {
    warnings.push("TLS exigé mais non négocié");
    degraded = true;
  }
  if (!report.connection.tls.negotiated && !report.connector.requireTls) {
    warnings.push("Connexion en clair — acceptable hors production seulement");
    degraded = true;
  }
  if (report.connection.tls.negotiated && !report.connection.tls.authorized) {
    warnings.push(
      `Certificat non validé : ${report.connection.tls.authorizationError ?? "chaîne inconnue"}`,
    );
    degraded = true;
  }

  const daysRemaining = report.certificate?.daysRemaining;
  if (typeof daysRemaining === "number" && daysRemaining < CERT_EXPIRY_WARNING_DAYS) {
    warnings.push(
      daysRemaining < 0
        ? "Certificat serveur expiré"
        : `Certificat serveur expire dans ${daysRemaining} jour(s)`,
    );
    degraded = true;
  }

  if (report.authentication.status === "skipped") {
    warnings.push("Aucun identifiant SMTP configuré");
    degraded = true;
  }

  for (const quota of report.quota.local) {
    if (quota.used !== null && quota.limit > 0) {
      if (quota.used / quota.limit >= QUOTA_WARNING_RATIO) {
        warnings.push(
          `Quota « ${quota.label} » à ${quota.used}/${quota.limit}`,
        );
        degraded = true;
      }
    }
  }

  if (report.quota.provider.status === "error") {
    warnings.push(report.quota.provider.message);
    degraded = true;
  }

  if (report.errors.length > 0) degraded = true;

  return { status: degraded ? "degraded" : "healthy", warnings };
}

function buildConfigErrorReport(
  error: unknown,
  startedAt: number,
): SmtpHealthReport {
  const now = new Date().toISOString();
  const env = getEnv();
  const message =
    error instanceof Error ? error.message : "Configuration SMTP invalide";

  return {
    generatedAt: now,
    lastTestAt: now,
    durationMs: Date.now() - startedAt,
    status: "unhealthy",
    cached: false,
    probeSendsEmail: false,
    connector: {
      id: (env.MAIL_PROVIDER ?? "smtp") as MailConnectorId,
      label: env.MAIL_PROVIDER ?? "smtp",
      hostMasked: "***",
      port: 0,
      encryption: "inconnu",
      requireTls: false,
      hostSource: "env",
      credentialsConfigured: false,
      fromName: env.SMTP_FROM_NAME,
      fromEmail: env.SMTP_FROM_EMAIL,
      docsUrl: "",
    },
    connection: {
      reachable: false,
      greeting: null,
      capabilities: [],
      starttlsAdvertised: false,
      authMechanisms: [],
      maxMessageBytes: null,
      tls: emptyTls(),
    },
    certificate: null,
    timings: {
      tcpMs: null,
      greetingMs: null,
      ehloMs: null,
      tlsHandshakeMs: null,
      totalMs: Date.now() - startedAt,
      authMs: null,
    },
    authentication: {
      status: "skipped",
      message: "Configuration invalide — test non exécuté",
      durationMs: 0,
    },
    quota: {
      local: [],
      provider: {
        status: "unsupported",
        message: "Configuration invalide",
        limit: null,
        used: null,
        remaining: null,
        ratePerSecond: null,
        window: null,
        checkedAt: now,
      },
    },
    gates: {
      dryRun: env.DRY_RUN,
      productionSendingEnabled: env.PRODUCTION_SENDING_ENABLED,
      allowTestSmtp: env.ALLOW_TEST_SMTP,
      nodeEnv: env.NODE_ENV,
      hostAllowlistConfigured: (env.SMTP_HOST_ALLOWLIST ?? "").trim().length > 0,
    },
    errors: [
      {
        stage: "tcp",
        code: "CONFIG_INVALID",
        message: sanitizeSmtpMessage(message, []),
        at: now,
      },
    ],
    warnings: ["Configuration du connecteur invalide"],
  };
}

async function runSmtpHealthCheck(): Promise<SmtpHealthReport> {
  const env = getEnv();
  const startedAt = Date.now();

  let connector: MailConnectorConfig;
  try {
    connector = resolveMailConnectorConfig();
  } catch (error) {
    return buildConfigErrorReport(error, startedAt);
  }

  const redact = [connector.user, connector.password];
  const probeEnabled = env.SMTP_HEALTH_PROBE_ENABLED !== false;

  const probe = probeEnabled
    ? await probeSmtpConnection({
        host: connector.host,
        port: connector.port,
        encryption: connector.encryption,
        requireTls: connector.requireTls,
        ehloDomain: senderDomain(connector.fromEmail),
        timeoutMs: env.SMTP_PROBE_TIMEOUT_MS,
        redact,
      })
    : null;

  const authentication: SmtpAuthCheckResult =
    probeEnabled && probe?.reachable
      ? await createSmtpProvider(connector).checkAuthentication()
      : {
          status: "skipped",
          message: probeEnabled
            ? "Serveur injoignable — authentification non testée"
            : "Sonde désactivée (SMTP_HEALTH_PROBE_ENABLED=false)",
          durationMs: 0,
        };

  const [localQuotas, providerQuota] = await Promise.all([
    readLocalQuotas(connector).catch(() => []),
    probeEnabled
      ? fetchProviderQuota(connector)
      : Promise.resolve({
          status: "not_configured" as const,
          message: "Sonde désactivée",
          limit: null,
          used: null,
          remaining: null,
          ratePerSecond: null,
          window: null,
          checkedAt: new Date().toISOString(),
        }),
  ]);

  const now = new Date().toISOString();

  const report: SmtpHealthReport = {
    generatedAt: now,
    lastTestAt: now,
    durationMs: Date.now() - startedAt,
    status: "unknown",
    cached: false,
    probeSendsEmail: false,
    connector: {
      id: connector.connectorId,
      label: connector.label,
      hostMasked: maskSmtpHost(connector.host),
      port: connector.port,
      encryption: connector.encryption,
      requireTls: connector.requireTls,
      hostSource: connector.hostSource,
      credentialsConfigured: connector.credentialsConfigured,
      fromName: connector.fromName,
      fromEmail: connector.fromEmail,
      docsUrl: connector.docsUrl,
    },
    connection: {
      reachable: probe?.reachable ?? false,
      greeting: probe?.greeting ?? null,
      capabilities: probe?.capabilities ?? [],
      starttlsAdvertised: probe?.starttlsAdvertised ?? false,
      authMechanisms: probe?.authMechanisms ?? [],
      maxMessageBytes: probe?.maxMessageBytes ?? null,
      tls: probe?.tls ?? emptyTls(),
    },
    certificate: probe?.certificate ?? null,
    timings: {
      tcpMs: probe?.timings.tcpMs ?? null,
      greetingMs: probe?.timings.greetingMs ?? null,
      ehloMs: probe?.timings.ehloMs ?? null,
      tlsHandshakeMs: probe?.timings.tlsHandshakeMs ?? null,
      totalMs: probe?.timings.totalMs ?? 0,
      authMs: authentication.status === "skipped" ? null : authentication.durationMs,
    },
    authentication,
    quota: { local: localQuotas, provider: providerQuota },
    gates: {
      dryRun: env.DRY_RUN,
      productionSendingEnabled: env.PRODUCTION_SENDING_ENABLED,
      allowTestSmtp: env.ALLOW_TEST_SMTP,
      nodeEnv: env.NODE_ENV,
      hostAllowlistConfigured: (env.SMTP_HOST_ALLOWLIST ?? "").trim().length > 0,
    },
    errors: (probe?.errors ?? []).map((error) => ({ ...error, at: now })),
    warnings: [],
  };

  if (!probeEnabled) {
    report.status = "unknown";
    report.warnings = [
      "Sonde réseau désactivée (SMTP_HEALTH_PROBE_ENABLED=false)",
    ];
    return report;
  }

  const computed = evaluateSmtpHealthStatus(report);
  report.status = computed.status;
  report.warnings = computed.warnings;

  logger.info(
    {
      provider: report.connector.id,
      status: report.status,
      reachable: report.connection.reachable,
      tls: report.connection.tls.protocol,
      durationMs: report.durationMs,
    },
    "SMTP health check executed",
  );

  return report;
}

/**
 * Rapport de santé SMTP.
 *
 * Sans `force`, un rapport encore frais est renvoyé depuis le cache : la page
 * peut donc s'auto-rafraîchir sans ouvrir une connexion à chaque requête.
 * Les tests concurrents partagent une seule exécution.
 */
export async function getSmtpHealth(
  options: { force?: boolean } = {},
): Promise<SmtpHealthReport> {
  const env = getEnv();

  if (!options.force) {
    const cached = await readCachedReport();
    if (cached && isFresh(cached, env.SMTP_HEALTH_CACHE_TTL_MS)) {
      return { ...cached, cached: true };
    }
  }

  if (inFlight) return inFlight;

  inFlight = runSmtpHealthCheck()
    .then(async (report) => {
      await persistReport(report);
      return report;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Dernier rapport connu, sans déclencher de test. */
export async function getLastSmtpHealth(): Promise<SmtpHealthReport | null> {
  const cached = await readCachedReport();
  return cached ? { ...cached, cached: true } : null;
}

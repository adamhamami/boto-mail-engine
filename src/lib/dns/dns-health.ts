import { getEnv } from "@/lib/config/env";
import { logger } from "@/lib/logger";
import { getRedisConnection } from "@/lib/queue";
import { withHealthTimeout } from "@/lib/observability/health-timeout";
import { maskSmtpHost, resolveMailConnectorConfig } from "@/lib/mail/providers";
import {
  aggregateDnsStatus,
  extractDomainFromEmail,
  isValidDnsDomain,
  resolveDkimSelectors,
  runDnsChecks,
} from "./checks";
import { NodeDnsResolver, type DnsResolver } from "./resolver";
import type { DnsHealthReport } from "./types";

const REDIS_CACHE_KEY = "dns:health:last";
const REDIS_CACHE_TTL_SECONDS = 7 * 24 * 3600;
const REDIS_TIMEOUT_MS = 1500;

let inFlight: Promise<DnsHealthReport> | null = null;
let memoryCache: DnsHealthReport | null = null;
let resolverOverride: DnsResolver | null = null;

/** Tests uniquement. */
export function setDnsResolverOverride(resolver: DnsResolver | null): void {
  resolverOverride = resolver;
}

/** Tests uniquement. */
export function resetDnsHealthCache(): void {
  inFlight = null;
  memoryCache = null;
}

function getResolver(): DnsResolver {
  if (resolverOverride) return resolverOverride;
  const env = getEnv();
  return new NodeDnsResolver(env.DNS_PROBE_TIMEOUT_MS);
}

async function readCachedReport(): Promise<DnsHealthReport | null> {
  if (memoryCache) return memoryCache;
  try {
    const raw = await withHealthTimeout(
      "dns-health:cache-read",
      () => getRedisConnection().get(REDIS_CACHE_KEY),
      REDIS_TIMEOUT_MS,
    );
    if (!raw) return null;
    memoryCache = JSON.parse(raw) as DnsHealthReport;
    return memoryCache;
  } catch {
    return null;
  }
}

async function persistReport(report: DnsHealthReport): Promise<void> {
  memoryCache = report;
  try {
    await withHealthTimeout(
      "dns-health:cache-write",
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
    // Cache best-effort.
  }
}

function isFresh(report: DnsHealthReport, ttlMs: number): boolean {
  const age = Date.now() - new Date(report.generatedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < ttlMs;
}

export interface DnsHealthOptions {
  force?: boolean;
  /** Domaine à vérifier — défaut : domaine de SMTP_FROM_EMAIL. */
  domain?: string;
}

function resolveTargetDomain(override?: string): {
  domain: string;
  fromEmail: string;
} {
  const env = getEnv();
  const fromEmail = env.SMTP_FROM_EMAIL;
  if (override?.trim()) {
    const candidate = override.trim().toLowerCase().replace(/\.$/, "");
    if (!isValidDnsDomain(candidate)) {
      throw new Error(
        `Domaine invalide « ${override} ». Attendu : exemple.com (pas d'URL ni d'IP).`,
      );
    }
    return { domain: candidate, fromEmail };
  }

  const fromDomain = extractDomainFromEmail(fromEmail);
  if (!fromDomain) {
    throw new Error(
      `Impossible d'extraire un domaine valide de SMTP_FROM_EMAIL (${fromEmail}).`,
    );
  }
  return { domain: fromDomain, fromEmail };
}

async function runDnsHealthCheck(
  options: DnsHealthOptions = {},
): Promise<DnsHealthReport> {
  const env = getEnv();
  const startedAt = Date.now();
  const { domain, fromEmail } = resolveTargetDomain(options.domain);

  let smtpHost = env.SMTP_HOST;
  let mailProvider = env.MAIL_PROVIDER;
  try {
    const connector = resolveMailConnectorConfig();
    smtpHost = connector.host;
    mailProvider = connector.connectorId;
  } catch {
    // Garder SMTP_HOST / MAIL_PROVIDER bruts si le connecteur est mal configuré.
  }

  const selectors = resolveDkimSelectors(mailProvider, env.DKIM_SELECTORS);
  const { checks, dkimSelectorsTried } = await runDnsChecks({
    domain,
    smtpHost,
    mailProvider,
    dkimSelectors: selectors,
    resolver: getResolver(),
  });

  const status = aggregateDnsStatus(checks);
  const now = new Date().toISOString();
  const warnings = checks
    .filter((c) => c.status !== "OK")
    .map((c) => `${c.label} : ${c.summary}`);

  const report: DnsHealthReport = {
    generatedAt: now,
    lastTestAt: now,
    durationMs: Date.now() - startedAt,
    cached: false,
    domain,
    fromEmail,
    mailProvider,
    smtpHostMasked: maskSmtpHost(smtpHost),
    status,
    checks,
    dkimSelectorsTried,
    warnings,
  };

  logger.info(
    {
      domain: report.domain,
      status: report.status,
      durationMs: report.durationMs,
      checks: report.checks.map((c) => ({ id: c.id, status: c.status })),
    },
    "DNS health check executed",
  );

  return report;
}

/**
 * Rapport DNS (SPF / DKIM / DMARC / MX / Reverse DNS).
 * Cache mémoire + Redis ; `force` ignore la fraîcheur.
 */
export async function getDnsHealth(
  options: DnsHealthOptions = {},
): Promise<DnsHealthReport> {
  const env = getEnv();

  // Domaine custom : jamais servi depuis le cache du domaine par défaut.
  if (!options.force && !options.domain) {
    const cached = await readCachedReport();
    if (cached && isFresh(cached, env.DNS_HEALTH_CACHE_TTL_MS)) {
      return { ...cached, cached: true };
    }
  }

  if (inFlight && !options.domain) return inFlight;

  const task = runDnsHealthCheck(options).then(async (report) => {
    // En test avec résolveur injecté : mémoire seule (évite Redis absent en CI).
    if (!options.domain) {
      if (resolverOverride) {
        memoryCache = report;
      } else {
        await persistReport(report);
      }
    }
    return report;
  });

  if (!options.domain) {
    inFlight = task.finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return task;
}

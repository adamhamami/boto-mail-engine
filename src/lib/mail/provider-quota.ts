import { createHash, createHmac } from "node:crypto";
import { env } from "@/lib/config/env";
import type { MailConnectorConfig } from "./providers";

/**
 * Lecture du quota côté fournisseur.
 *
 * Optionnel et dégradable : une clé absente ou une API indisponible ne doit
 * jamais faire échouer la page Santé SMTP ni un envoi. Les URLs sont des
 * constantes — aucune valeur fournie par l'utilisateur n'est utilisée pour
 * construire une requête sortante (garde SSRF).
 */

export type ProviderQuotaStatus =
  | "ok"
  | "not_configured"
  | "unsupported"
  | "error";

export interface ProviderQuotaResult {
  status: ProviderQuotaStatus;
  message: string;
  /** Plafond sur la fenêtre du fournisseur (crédits Brevo, 24 h SES). */
  limit: number | null;
  used: number | null;
  remaining: number | null;
  /** Débit maximal autorisé, en messages par seconde (SES). */
  ratePerSecond: number | null;
  window: string | null;
  checkedAt: string;
}

const QUOTA_FETCH_TIMEOUT_MS = 5000;

const BREVO_ACCOUNT_URL = "https://api.brevo.com/v3/account";
const SES_SERVICE = "ses";

function result(
  status: ProviderQuotaStatus,
  message: string,
  extra: Partial<ProviderQuotaResult> = {},
): ProviderQuotaResult {
  return {
    status,
    message,
    limit: null,
    used: null,
    remaining: null,
    ratePerSecond: null,
    window: null,
    checkedAt: new Date().toISOString(),
    ...extra,
  };
}

function sha256Hex(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

export interface Sigv4Input {
  method: string;
  host: string;
  path: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  payload: string;
  amzDate: string;
}

/** Requête canonique AWS SigV4 — extrait pour être testable isolément. */
export function buildSigv4CanonicalRequest(input: Sigv4Input): string {
  const payloadHash = sha256Hex(input.payload);
  const canonicalHeaders = [
    `host:${input.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${input.amzDate}`,
  ].join("\n");

  return [
    input.method,
    input.path,
    "",
    `${canonicalHeaders}\n`,
    "host;x-amz-content-sha256;x-amz-date",
    payloadHash,
  ].join("\n");
}

/** En-têtes signés SigV4 (AWS4-HMAC-SHA256). */
export function buildSigv4Headers(input: Sigv4Input): Record<string, string> {
  const dateStamp = input.amzDate.slice(0, 8);
  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const payloadHash = sha256Hex(input.payload);

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    input.amzDate,
    scope,
    sha256Hex(buildSigv4CanonicalRequest(input)),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, dateStamp), input.region), input.service),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  return {
    host: input.host,
    "x-amz-date": input.amzDate,
    "x-amz-content-sha256": payloadHash,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, ` +
      `SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
  };
}

/** Horodatage AWS compact : 20260801T053000Z */
export function toAmzDate(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(QUOTA_FETCH_TIMEOUT_MS),
    cache: "no-store",
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  return { ok: response.ok, status: response.status, body };
}

async function fetchBrevoQuota(): Promise<ProviderQuotaResult> {
  const apiKey = env.BREVO_API_KEY?.trim() ?? "";
  if (!apiKey) {
    return result(
      "not_configured",
      "BREVO_API_KEY non renseignée — quota fournisseur non interrogé",
    );
  }

  const response = await fetchJson(BREVO_ACCOUNT_URL, { "api-key": apiKey });
  if (!response.ok) {
    return result(
      "error",
      `API Brevo indisponible (HTTP ${response.status})`,
    );
  }

  const plans = (response.body as { plan?: Array<Record<string, unknown>> })
    ?.plan;
  const sendPlan = Array.isArray(plans)
    ? (plans.find(
        (plan) =>
          String(plan.creditsType ?? "").toLowerCase() === "sendlimit",
      ) ??
      plans.find((plan) => String(plan.type ?? "").toLowerCase() !== "sms"))
    : undefined;

  const credits = Number(sendPlan?.credits);
  if (!Number.isFinite(credits)) {
    return result("ok", "Compte Brevo joignable — crédits non exposés par le plan");
  }

  return result("ok", "Crédits d'envoi restants sur le plan Brevo", {
    remaining: credits,
    window: "plan",
  });
}

async function fetchSesQuota(): Promise<ProviderQuotaResult> {
  const accessKeyId = env.SES_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = env.SES_SECRET_ACCESS_KEY?.trim() ?? "";

  if (!accessKeyId || !secretAccessKey) {
    return result(
      "not_configured",
      "SES_ACCESS_KEY_ID / SES_SECRET_ACCESS_KEY absents — quota SES non interrogé",
    );
  }

  const region = env.SES_REGION?.trim() || "eu-west-1";
  const host = `email.${region}.amazonaws.com`;
  const path = "/v2/email/account";

  const headers = buildSigv4Headers({
    method: "GET",
    host,
    path,
    region,
    service: SES_SERVICE,
    accessKeyId,
    secretAccessKey,
    payload: "",
    amzDate: toAmzDate(new Date()),
  });

  const response = await fetchJson(`https://${host}${path}`, headers);
  if (!response.ok) {
    return result("error", `API SES indisponible (HTTP ${response.status})`);
  }

  const quota = (
    response.body as {
      SendQuota?: {
        Max24HourSend?: number;
        MaxSendRate?: number;
        SentLast24Hours?: number;
      };
    }
  )?.SendQuota;

  if (!quota) {
    return result("ok", "Compte SES joignable — quota non exposé");
  }

  const limit = Number(quota.Max24HourSend);
  const used = Number(quota.SentLast24Hours);

  return result("ok", "Quota SES sur 24 heures glissantes", {
    limit: Number.isFinite(limit) ? limit : null,
    used: Number.isFinite(used) ? used : null,
    remaining:
      Number.isFinite(limit) && Number.isFinite(used)
        ? Math.max(0, limit - used)
        : null,
    ratePerSecond: Number.isFinite(Number(quota.MaxSendRate))
      ? Number(quota.MaxSendRate)
      : null,
    window: "24h",
  });
}

/**
 * Interroge le quota du fournisseur courant. Ne lève jamais.
 */
export async function fetchProviderQuota(
  connector: Pick<MailConnectorConfig, "remoteQuota" | "label">,
): Promise<ProviderQuotaResult> {
  try {
    switch (connector.remoteQuota) {
      case "brevo":
        return await fetchBrevoQuota();
      case "ses":
        return await fetchSesQuota();
      default:
        return result(
          "unsupported",
          `${connector.label} n'expose pas de quota interrogeable — les quotas locaux font foi`,
        );
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur inconnue";
    return result("error", `Lecture du quota impossible : ${message}`);
  }
}

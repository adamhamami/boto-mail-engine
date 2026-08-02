import { env } from "@/lib/config/env";
import type { MailProviderConfig } from "./types";

/**
 * Presets de connecteurs SMTP réels.
 *
 * Choix d'architecture : Brevo, Mailgun, Postmark, Amazon SES et SendGrid
 * exposent tous un relais SMTP authentifié. On garde donc un seul chemin
 * d'envoi (nodemailer) au lieu d'un SDK HTTP par fournisseur :
 * - aucune nouvelle dépendance runtime,
 * - un seul code d'envoi déjà couvert par les recettes R-01..R-10,
 * - les quotas / gates / DRY_RUN existants s'appliquent sans modification.
 *
 * Les presets ne fournissent que des valeurs publiques (hôte, port, chiffrement).
 * Les identifiants restent exclusivement dans SMTP_USER / SMTP_PASSWORD.
 */

export type MailConnectorId =
  | "smtp"
  | "brevo"
  | "mailgun"
  | "postmark"
  | "ses"
  | "sendgrid";

/** Mode de chiffrement du transport SMTP. */
export type SmtpEncryption = "tls" | "starttls" | "none";

export interface MailConnectorPreset {
  id: MailConnectorId;
  label: string;
  /** null ⇒ hôte fourni par SMTP_HOST (SMTP classique). */
  host: string | null;
  port: number;
  encryption: SmtpEncryption;
  /** Documentation de l'identifiant attendu — jamais la valeur. */
  userHint: string;
  passwordHint: string;
  docsUrl: string;
  /** Fournisseur exposant un quota interrogeable par API. */
  remoteQuota: "brevo" | "ses" | "none";
}

const SES_REGION_PLACEHOLDER = "{region}";

export const MAIL_CONNECTOR_PRESETS: Record<
  MailConnectorId,
  MailConnectorPreset
> = {
  smtp: {
    id: "smtp",
    label: "SMTP classique",
    host: null,
    port: 587,
    encryption: "starttls",
    userHint: "Identifiant SMTP du serveur",
    passwordHint: "Mot de passe SMTP du serveur",
    docsUrl: "https://nodemailer.com/smtp/",
    remoteQuota: "none",
  },
  brevo: {
    id: "brevo",
    label: "Brevo",
    host: "smtp-relay.brevo.com",
    port: 587,
    encryption: "starttls",
    userHint: "Login Brevo (adresse email du compte)",
    passwordHint: "Clé SMTP Brevo (SMTP key, pas la clé API v3)",
    docsUrl: "https://developers.brevo.com/docs/send-a-transactional-email",
    remoteQuota: "brevo",
  },
  mailgun: {
    id: "mailgun",
    label: "Mailgun",
    host: "smtp.mailgun.org",
    port: 587,
    encryption: "starttls",
    userHint: "postmaster@votre-domaine (SMTP credential Mailgun)",
    passwordHint: "Mot de passe SMTP Mailgun du domaine",
    docsUrl: "https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/",
    remoteQuota: "none",
  },
  postmark: {
    id: "postmark",
    label: "Postmark",
    host: "smtp.postmarkapp.com",
    port: 587,
    encryption: "starttls",
    userHint: "Server API Token Postmark (identique au mot de passe)",
    passwordHint: "Server API Token Postmark",
    docsUrl: "https://postmarkapp.com/developer/user-guide/send-email-with-smtp",
    remoteQuota: "none",
  },
  ses: {
    id: "ses",
    label: "Amazon SES",
    host: `email-smtp.${SES_REGION_PLACEHOLDER}.amazonaws.com`,
    port: 587,
    encryption: "starttls",
    userHint: "SMTP username SES (dérivé IAM — pas l'AWS access key ID)",
    passwordHint: "SMTP password SES (dérivé IAM)",
    docsUrl: "https://docs.aws.amazon.com/ses/latest/dg/send-email-smtp.html",
    remoteQuota: "ses",
  },
  sendgrid: {
    id: "sendgrid",
    label: "SendGrid",
    host: "smtp.sendgrid.net",
    port: 587,
    encryption: "starttls",
    userHint: "Littéralement « apikey »",
    passwordHint: "Clé API SendGrid",
    docsUrl: "https://www.twilio.com/docs/sendgrid/for-developers/sending-email/integrating-with-the-smtp-api",
    remoteQuota: "none",
  },
};

export interface MailConnectorConfig extends MailProviderConfig {
  connectorId: MailConnectorId;
  label: string;
  encryption: SmtpEncryption;
  /** Interdit l'envoi en clair si STARTTLS n'est pas disponible. */
  requireTls: boolean;
  docsUrl: string;
  remoteQuota: MailConnectorPreset["remoteQuota"];
  /** Provenance de l'hôte effectif — utile en diagnostic. */
  hostSource: "preset" | "env";
  credentialsConfigured: boolean;
}

/** Vrai si la variable est réellement définie dans l'environnement du process. */
function isEnvExplicit(name: string): boolean {
  const raw = process.env[name];
  return raw !== undefined && raw.trim() !== "";
}

/**
 * Masque un hôte SMTP tout en gardant sa lisibilité opérationnelle.
 * `smtp-relay.brevo.com` → `sm***.brevo.com`
 *
 * Cohérent avec buildMaskedSmtpPublicView : aucun hôte complet n'est renvoyé
 * aux clients HTTP, même pour un porteur de ops:read.
 */
export function maskSmtpHost(host: string): string {
  const trimmed = host.trim();
  if (!trimmed) return "";

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(trimmed);
  if (ipv4) {
    return `${ipv4[1]}.***.***.${ipv4[4]}`;
  }

  const labels = trimmed.split(".");
  if (labels.length <= 2) {
    const head = labels[0] ?? "";
    const masked = head.length <= 2 ? "***" : `${head.slice(0, 2)}***`;
    return labels.length === 2 ? `${masked}.${labels[1]}` : masked;
  }

  const [first, ...rest] = labels;
  const head = first.length <= 2 ? "***" : `${first.slice(0, 2)}***`;
  return [head, ...rest.slice(-2)].join(".");
}

/**
 * Retire toute occurrence des identifiants d'un message d'erreur fournisseur.
 * Certains serveurs renvoient « 535 Authentication failed for user@domain ».
 */
export function sanitizeSmtpMessage(
  message: string,
  secrets: Array<string | undefined>,
): string {
  let output = message;
  for (const secret of secrets) {
    const value = secret?.trim();
    if (!value || value.length < 3) continue;
    output = output.split(value).join("[redacted]");
  }
  return output.slice(0, 500);
}

function resolveSesHost(): string {
  const region = env.SES_REGION?.trim() || "eu-west-1";
  return `email-smtp.${region}.amazonaws.com`;
}

function assertHostAllowed(host: string): void {
  const allowlistRaw = env.SMTP_HOST_ALLOWLIST?.trim() ?? "";
  if (allowlistRaw.length === 0) return;

  const allowed = allowlistRaw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  if (!allowed.includes(host.trim().toLowerCase())) {
    throw new Error(
      `SMTP_HOST "${host}" is not in SMTP_HOST_ALLOWLIST (SSRF / egress guard)`,
    );
  }
}

/**
 * Configuration effective du connecteur courant.
 *
 * Précédence : variable d'environnement explicite > preset fournisseur.
 * L'allowlist SSRF s'applique à l'hôte **résolu** (preset inclus).
 */
export function resolveMailConnectorConfig(): MailConnectorConfig {
  const connectorId = (env.MAIL_PROVIDER ?? "smtp") as MailConnectorId;
  const preset = MAIL_CONNECTOR_PRESETS[connectorId] ?? MAIL_CONNECTOR_PRESETS.smtp;

  const presetHost =
    preset.id === "ses" ? resolveSesHost() : (preset.host ?? null);

  const hostFromEnv = isEnvExplicit("SMTP_HOST") || presetHost === null;
  const host = hostFromEnv ? env.SMTP_HOST : presetHost;

  const port = isEnvExplicit("SMTP_PORT") ? env.SMTP_PORT : preset.port;

  const encryption: SmtpEncryption = isEnvExplicit("SMTP_SECURE")
    ? env.SMTP_SECURE
      ? "tls"
      : "starttls"
    : preset.encryption;

  assertHostAllowed(host);

  const user = env.SMTP_USER?.trim() ?? "";
  const password = env.SMTP_PASSWORD?.trim() ?? "";

  // Les relais publics imposent TLS ; seul le SMTP classique suit le flag env
  // (Mailpit local n'expose pas STARTTLS).
  const requireTls =
    preset.id === "smtp" ? env.SMTP_REQUIRE_TLS === true : true;

  return {
    connectorId: preset.id,
    label: preset.label,
    host,
    port,
    secure: encryption === "tls",
    encryption,
    requireTls,
    user,
    password,
    fromName: env.SMTP_FROM_NAME,
    fromEmail: env.SMTP_FROM_EMAIL,
    docsUrl: preset.docsUrl,
    remoteQuota: preset.remoteQuota,
    hostSource: hostFromEnv ? "env" : "preset",
    credentialsConfigured: user.length > 0 && password.length > 0,
  };
}

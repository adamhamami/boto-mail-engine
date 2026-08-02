import { getEnv } from "@/lib/config/env";
import { CampaignValidationError, ValidationError } from "@/lib/errors";
import {
  CampaignStatus,
  ContactStatus,
} from "@/generated/prisma/client";
import { normalizeEmailAddress } from "@/lib/data/integrity";

/** Statuts qui bloquent toute relance automatique (CDC §3.1 / §8.2) */
export const BLOCKED_SEND_STATUSES: ContactStatus[] = [
  ContactStatus.IMPORTED,
  ContactStatus.TO_REVIEW,
  ContactStatus.DISQUALIFIED,
  ContactStatus.RESPONDED,
  ContactStatus.UNSUBSCRIBED,
  ContactStatus.HARD_BOUNCED,
  ContactStatus.BLOCKED,
];

export const SENDABLE_CONTACT_STATUSES: ContactStatus[] = [
  ContactStatus.ELIGIBLE,
  ContactStatus.IN_SEQUENCE,
];

/** Statuts campagne autorisant le worker à tenter un envoi (réel ou simulé) */
export const WORKER_SENDABLE_CAMPAIGN_STATUSES: CampaignStatus[] = [
  CampaignStatus.RUNNING,
  CampaignStatus.TESTED,
];

export const TEST_MODE_MAX_RECIPIENTS = 10;

export interface ContactEligibilityInput {
  email?: string | null;
  status: ContactStatus;
  source: string | null | undefined;
  consentBase: string | null | undefined;
  deletedAt?: Date | null;
  /** Phase 13 — contact anonymisé CNDP */
  anonymizedAt?: Date | null;
  isDuplicate?: boolean;
  /** Hint UI seulement — insuffisant sans allowlist serveur */
  isTestRecipient?: boolean;
}

export type SendExecutionPhase = "schedule" | "enqueue" | "worker";

export interface SendExecutionContext {
  phase: SendExecutionPhase;
  isTestMode: boolean;
  /**
   * true lorsque le code s’apprête à appeler le fournisseur SMTP/API.
   * Si omis en phase worker, déduit de !DRY_RUN.
   */
  intendRealSmtp?: boolean;
}

export function parseCsvAllowlist(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

export function getTestEmailAllowlist(): string[] {
  return parseCsvAllowlist(getEnv().TEST_EMAIL_ALLOWLIST);
}

export function getTestDomainAllowlist(): string[] {
  return parseCsvAllowlist(getEnv().TEST_DOMAIN_ALLOWLIST);
}

export function getSmtpAllowedNodeEnvs(): string[] {
  const list = parseCsvAllowlist(getEnv().SMTP_ALLOWED_NODE_ENVS);
  return list.length > 0 ? list : ["production"];
}

/**
 * Allowlist serveur — seule preuve acceptable pour un destinataire de test.
 * `isTestRecipient` n’est jamais suffisant.
 */
export function isEmailOnTestAllowlist(email: string): boolean {
  const normalized = normalizeEmailAddress(email);
  if (!normalized.includes("@")) return false;

  const emails = getTestEmailAllowlist();
  if (emails.includes(normalized)) return true;

  const domain = normalized.split("@")[1];
  if (!domain) return false;

  const domains = getTestDomainAllowlist();
  return domains.includes(domain);
}

export function assertEmailOnTestAllowlist(email: string): void {
  if (!isEmailOnTestAllowlist(email)) {
    throw new ValidationError(
      "Destinataire hors allowlist de test (TEST_EMAIL_ALLOWLIST / TEST_DOMAIN_ALLOWLIST)",
    );
  }
}

/** DRY_RUN=true ⇒ aucun appel fournisseur, y compris mode test. */
export function mustSimulateProviderSend(): boolean {
  return getEnv().DRY_RUN === true;
}

export function assertNodeEnvAllowsRealSmtp(): void {
  const env = getEnv();
  const allowed = getSmtpAllowedNodeEnvs();
  if (!allowed.includes(env.NODE_ENV)) {
    throw new CampaignValidationError(
      `SMTP réel interdit pour NODE_ENV=${env.NODE_ENV}. Autorisés: ${allowed.join(", ")}`,
    );
  }
}

/**
 * Conditions pour un appel fournisseur réel (après que DRY_RUN soit false).
 */
export function assertRealSmtpAllowed(options: { isTestMode: boolean }): void {
  const env = getEnv();

  if (env.DRY_RUN) {
    throw new CampaignValidationError(
      "DRY_RUN=true : aucun appel SMTP/API fournisseur n'est autorisé",
    );
  }

  assertNodeEnvAllowsRealSmtp();

  if (options.isTestMode) {
    if (!env.ALLOW_TEST_SMTP) {
      throw new CampaignValidationError(
        "ALLOW_TEST_SMTP=false : activez ce flag pour un SMTP de test après recette",
      );
    }
    return;
  }

  if (!env.PRODUCTION_SENDING_ENABLED) {
    throw new CampaignValidationError(
      "PRODUCTION_SENDING_ENABLED=false : activez uniquement après validation connecteur, conformité et recette",
    );
  }
}

/**
 * Point d’entrée unique — schedule, enqueue, worker.
 * Ne duplique pas les règles DRY_RUN / production / test SMTP.
 */
export function assertSendExecutionAllowed(context: SendExecutionContext): void {
  const env = getEnv();
  const intendRealSmtp =
    context.intendRealSmtp ??
    (context.phase === "worker" ? !env.DRY_RUN : false);

  if (intendRealSmtp) {
    assertRealSmtpAllowed({ isTestMode: context.isTestMode });
  }

  // Phase schedule/enqueue : la mise en file reste possible sous DRY_RUN (simulation).
  // La production réelle reste bloquée au moment intendRealSmtp.
  if (
    !context.isTestMode &&
    !env.DRY_RUN &&
    context.phase !== "worker" &&
    !env.PRODUCTION_SENDING_ENABLED &&
    intendRealSmtp
  ) {
    assertRealSmtpAllowed({ isTestMode: false });
  }
}

export function assertContactEligibleForSend(
  contact: ContactEligibilityInput,
  options: { isTestMode: boolean },
): void {
  if (contact.deletedAt || contact.anonymizedAt || contact.isDuplicate) {
    throw new ValidationError(
      "Contact inéligible (supprimé, anonymisé ou doublon)",
    );
  }

  if (options.isTestMode) {
    const email = contact.email;
    if (!email?.trim()) {
      throw new ValidationError("Email contact requis pour le mode test");
    }
    assertEmailOnTestAllowlist(email);
    return;
  }

  if (
    contact.status !== ContactStatus.ELIGIBLE &&
    contact.status !== ContactStatus.IN_SEQUENCE
  ) {
    throw new ValidationError(
      `Contact non éligible (statut ${contact.status}). Seuls ÉLIGIBLE / EN_SÉQUENCE peuvent recevoir un email.`,
    );
  }

  if (!contact.source?.trim() || !contact.consentBase?.trim()) {
    throw new ValidationError(
      "Justification de prospection manquante (source + base légale / consentement) — exigence CDC R-02",
    );
  }
}

export function isContactSendable(
  contact: ContactEligibilityInput,
  options: { isTestMode: boolean },
): boolean {
  try {
    assertContactEligibleForSend(contact, options);
    return true;
  } catch {
    return false;
  }
}

export function assertUnsubscribeLinkPresent(html: string): void {
  if (
    !html.includes("/unsubscribe/") &&
    !html.includes("{{lien_desinscription}}")
  ) {
    throw new ValidationError(
      "Chaque message doit inclure un lien de désinscription ({{lien_desinscription}} ou /unsubscribe/)",
    );
  }
}

export type WorkerSkipReason =
  | "ATTEMPT_NOT_FOUND"
  | "ALREADY_SENT"
  | "RECIPIENT_STOPPED"
  | "CAMPAIGN_NOT_SENDABLE"
  | "CONTACT_MISSING"
  | "CONTACT_DELETED"
  | "CONTACT_DUPLICATE"
  | "CONTACT_NOT_ELIGIBLE"
  | "CONTACT_MISSING_JUSTIFICATION"
  | "CONTACT_ANONYMIZED"
  | "CONTACT_BLOCKED_STATUS"
  | "EMAIL_SUPPRESSED"
  | "TEST_ALLOWLIST_DENIED"
  | "REAL_SMTP_DENIED";

export interface WorkerFreshSendState {
  campaignStatus: CampaignStatus;
  isTestMode: boolean;
  recipientIsStopped: boolean;
  recipientIsSent: boolean;
  attemptStatus: string;
  contact: {
    id: string;
    email: string;
    status: ContactStatus;
    source: string | null;
    consentBase: string | null;
    deletedAt: Date | null;
    anonymizedAt?: Date | null;
    isDuplicate: boolean;
  } | null;
  emailSuppressed: boolean;
}

/**
 * Revalidation atomique (lecture fraîche) avant tout appel fournisseur.
 */
export function evaluateWorkerSendReadiness(
  state: WorkerFreshSendState,
): { ok: true } | { ok: false; reason: WorkerSkipReason; message: string } {
  if (state.recipientIsSent || state.attemptStatus === "SENT") {
    return {
      ok: false,
      reason: "ALREADY_SENT",
      message: "Attempt or recipient already marked sent",
    };
  }

  if (state.recipientIsStopped) {
    return {
      ok: false,
      reason: "RECIPIENT_STOPPED",
      message: "Recipient is stopped",
    };
  }

  if (!WORKER_SENDABLE_CAMPAIGN_STATUSES.includes(state.campaignStatus)) {
    return {
      ok: false,
      reason: "CAMPAIGN_NOT_SENDABLE",
      message: `Campaign status ${state.campaignStatus} does not allow sending`,
    };
  }

  if (!state.contact) {
    return {
      ok: false,
      reason: "CONTACT_MISSING",
      message: "Contact missing",
    };
  }

  if (state.contact.deletedAt) {
    return {
      ok: false,
      reason: "CONTACT_DELETED",
      message: "Contact deleted",
    };
  }

  if (state.contact.anonymizedAt) {
    return {
      ok: false,
      reason: "CONTACT_ANONYMIZED",
      message: "Contact anonymized (CNDP)",
    };
  }

  if (state.contact.isDuplicate) {
    return {
      ok: false,
      reason: "CONTACT_DUPLICATE",
      message: "Contact flagged duplicate",
    };
  }

  if (state.emailSuppressed) {
    return {
      ok: false,
      reason: "EMAIL_SUPPRESSED",
      message: "Email on suppression list",
    };
  }

  if (BLOCKED_SEND_STATUSES.includes(state.contact.status)) {
    return {
      ok: false,
      reason: "CONTACT_BLOCKED_STATUS",
      message: `Contact status ${state.contact.status} blocks send`,
    };
  }

  if (state.isTestMode) {
    if (!isEmailOnTestAllowlist(state.contact.email)) {
      return {
        ok: false,
        reason: "TEST_ALLOWLIST_DENIED",
        message: "Email not on test allowlist",
      };
    }
  } else {
    if (
      state.contact.status !== ContactStatus.ELIGIBLE &&
      state.contact.status !== ContactStatus.IN_SEQUENCE
    ) {
      return {
        ok: false,
        reason: "CONTACT_NOT_ELIGIBLE",
        message: `Contact status ${state.contact.status} not sendable`,
      };
    }
    if (!state.contact.source?.trim() || !state.contact.consentBase?.trim()) {
      return {
        ok: false,
        reason: "CONTACT_MISSING_JUSTIFICATION",
        message: "Missing source or consentBase",
      };
    }
  }

  return { ok: true };
}

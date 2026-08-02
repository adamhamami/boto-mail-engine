import { createSmtpProvider } from "./smtp-provider";
import { resolveMailConnectorConfig } from "./providers";
import type { MailProvider } from "./types";

let mailProviderInstance: MailProvider | null = null;
let mailProviderOverride: MailProvider | null = null;

export function setMailProviderOverride(provider: MailProvider | null): void {
  mailProviderOverride = provider;
  mailProviderInstance = provider;
}

export function resetMailProvider(): void {
  mailProviderOverride = null;
  mailProviderInstance = null;
}

/**
 * Connecteur d'envoi courant.
 *
 * Brevo, Mailgun, Postmark, Amazon SES, SendGrid et le SMTP classique
 * partagent le même transport : seuls l'hôte, le port et le chiffrement
 * changent (presets dans `./providers`). Les gates DRY_RUN / allowlist /
 * quotas restent inchangés en amont de ce module.
 */
export function getMailProvider(): MailProvider {
  if (mailProviderOverride) {
    return mailProviderOverride;
  }

  if (mailProviderInstance) {
    return mailProviderInstance;
  }

  mailProviderInstance = createSmtpProvider(resolveMailConnectorConfig());
  return mailProviderInstance;
}

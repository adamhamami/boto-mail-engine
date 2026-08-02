import { resolveMailConnectorConfig } from "./providers";

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

export interface SendMailResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

export interface MailProvider {
  readonly name: string;
  send(options: SendMailOptions): Promise<SendMailResult>;
  verifyConnection(): Promise<boolean>;
}

export interface MailProviderConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  fromName: string;
  fromEmail: string;
}

/**
 * Configuration SMTP effective (preset fournisseur + surcharges d'environnement).
 * Conservé ici pour compatibilité des imports existants ; la résolution vit
 * désormais dans `./providers` avec les presets Brevo/Mailgun/Postmark/SES.
 */
export function getMailProviderConfig(): MailProviderConfig {
  const resolved = resolveMailConnectorConfig();

  return {
    host: resolved.host,
    port: resolved.port,
    secure: resolved.secure,
    user: resolved.user,
    password: resolved.password,
    fromName: resolved.fromName,
    fromEmail: resolved.fromEmail,
  };
}

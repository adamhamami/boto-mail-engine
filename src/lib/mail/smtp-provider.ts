import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { logger } from "@/lib/logger";
import { sanitizeSmtpMessage } from "./providers";
import type { MailConnectorConfig } from "./providers";
import type {
  MailProvider,
  MailProviderConfig,
  SendMailOptions,
  SendMailResult,
} from "./types";

const CONNECTION_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 30_000;

/** Domaine annoncé en EHLO — évite de divulguer le hostname du conteneur. */
function ehloDomain(fromEmail: string): string {
  return fromEmail.split("@")[1]?.trim().toLowerCase() || "localhost";
}

export interface SmtpAuthCheckResult {
  status: "ok" | "failed" | "skipped";
  message: string;
  durationMs: number;
}

/**
 * Transport SMTP réel, partagé par tous les connecteurs (Brevo, Mailgun,
 * Postmark, Amazon SES, SendGrid, SMTP classique). Les différences entre
 * fournisseurs sont portées par les presets — pas par le code d'envoi.
 */
export class SMTPProvider implements MailProvider {
  readonly name: string;
  private transporter: Transporter;
  private readonly requireTls: boolean;

  constructor(
    private readonly config: MailProviderConfig,
    options: { name?: string; requireTls?: boolean } = {},
  ) {
    this.name = options.name ?? "smtp";
    this.requireTls = options.requireTls ?? false;

    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      name: ehloDomain(config.fromEmail),
      auth:
        config.user && config.password
          ? { user: config.user, pass: config.password }
          : undefined,
      // Refuse l'envoi en clair quand le connecteur l'exige.
      requireTLS: !config.secure && this.requireTls,
      ...(this.requireTls
        ? { tls: { minVersion: "TLSv1.2" as const, servername: config.host } }
        : {}),
      // Sandbox : pas de lecture fichier / fetch URL via options message (GHSA-p6gq).
      disableFileAccess: true,
      disableUrlAccess: true,
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      greetingTimeout: GREETING_TIMEOUT_MS,
      socketTimeout: SOCKET_TIMEOUT_MS,
    });
  }

  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      logger.error(
        {
          err:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : { message: "SMTP verify failed" },
          provider: this.name,
          host: this.config.host,
          port: this.config.port,
        },
        "SMTP connection verification failed",
      );
      return false;
    }
  }

  /**
   * Variante diagnostiquée de `verifyConnection` : conserve le message
   * d'erreur du serveur (identifiants retirés) pour la page Santé SMTP.
   */
  async checkAuthentication(): Promise<SmtpAuthCheckResult> {
    const startedAt = Date.now();

    if (!this.config.user || !this.config.password) {
      return {
        status: "skipped",
        message:
          "Aucun identifiant configuré (SMTP_USER / SMTP_PASSWORD) — authentification non testée",
        durationMs: 0,
      };
    }

    try {
      await this.transporter.verify();
      return {
        status: "ok",
        message: "Authentification acceptée par le serveur",
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const raw =
        error instanceof Error ? error.message : "Échec d'authentification";
      return {
        status: "failed",
        message: sanitizeSmtpMessage(raw, [
          this.config.user,
          this.config.password,
        ]),
        durationMs: Date.now() - startedAt,
      };
    }
  }

  async send(options: SendMailOptions): Promise<SendMailResult> {
    const result = await this.transporter.sendMail({
      from: `"${this.config.fromName}" <${this.config.fromEmail}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
      headers: options.headers,
    });

    return {
      messageId: result.messageId,
      accepted: (result.accepted as string[]) ?? [],
      rejected: (result.rejected as string[]) ?? [],
    };
  }
}

/** Instancie le transport à partir d'une configuration de connecteur résolue. */
export function createSmtpProvider(
  connector: MailConnectorConfig,
): SMTPProvider {
  return new SMTPProvider(connector, {
    name: connector.connectorId,
    requireTls: connector.requireTls,
  });
}

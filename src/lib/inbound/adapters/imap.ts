import type { NormalizedMailEvent } from "../types";
import type { InboundMailAdapter } from "./types";

/**
 * Configuration IMAP — aucune credential inventée.
 * À renseigner via env / secret manager avant activation.
 */
export interface ImapInboundConfig {
  host: string;
  port: number;
  user: string;
  /** Mot de passe / app password — jamais hardcodé */
  password: string;
  mailbox?: string;
  tls?: boolean;
}

/**
 * Adaptateur IMAP préparé (non branché tant que les credentials ne sont pas fournis).
 * Ne tente aucune connexion sans configuration complète.
 */
export class ImapInboundAdapter implements InboundMailAdapter {
  readonly name = "imap";

  constructor(private readonly config: ImapInboundConfig | null = null) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): ImapInboundAdapter {
    const host = env.IMAP_HOST?.trim();
    const user = env.IMAP_USER?.trim();
    const password = env.IMAP_PASSWORD?.trim();
    const port = Number(env.IMAP_PORT ?? "993");

    if (!host || !user || !password) {
      return new ImapInboundAdapter(null);
    }

    return new ImapInboundAdapter({
      host,
      port: Number.isFinite(port) ? port : 993,
      user,
      password,
      mailbox: env.IMAP_MAILBOX?.trim() || "INBOX",
      tls: env.IMAP_TLS !== "false",
    });
  }

  isConfigured(): boolean {
    return this.config !== null;
  }

  async poll(): Promise<NormalizedMailEvent[]> {
    if (!this.config) {
      throw new Error(
        "IMAP inbound adapter is not configured (set IMAP_HOST, IMAP_USER, IMAP_PASSWORD)",
      );
    }

    // Branchement réel différé : client IMAP + parsing RFC822 → NormalizedMailEvent.
    // Ne pas inventer de credentials ni de protocole partiel en production.
    throw new Error(
      "IMAP inbound polling is prepared but not connected yet — use webhook provider or MockInboundMailAdapter",
    );
  }
}

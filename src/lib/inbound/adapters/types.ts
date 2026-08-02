import type { NormalizedMailEvent } from "../types";

/**
 * Abstraction réception entrante indépendante du canal
 * (webhook fournisseur, IMAP, mock tests).
 */
export interface InboundMailAdapter {
  readonly name: string;
  /**
   * Récupère les événements entrants disponibles.
   * Les adaptateurs webhook n’utilisent pas poll — la route HTTP appelle normalize.
   */
  poll(): Promise<NormalizedMailEvent[]>;
}

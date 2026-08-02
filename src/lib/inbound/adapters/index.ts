import { getEnv } from "@/lib/config/env";
import { ImapInboundAdapter } from "./imap";
import { MockInboundMailAdapter } from "./mock";
import type { InboundMailAdapter } from "./types";

export type { InboundMailAdapter } from "./types";
export { MockInboundMailAdapter } from "./mock";
export { ImapInboundAdapter, type ImapInboundConfig } from "./imap";

/**
 * Choisit l’adaptateur entrant hors webhook HTTP.
 * Sans fournisseur concret → mock ; IMAP seulement si credentials présents.
 */
export function getInboundMailAdapter(): InboundMailAdapter {
  const imap = ImapInboundAdapter.fromEnv(process.env);
  if (imap.isConfigured()) {
    return imap;
  }

  // MAIL_PROVIDER webhook-capable futur (sendgrid/mailgun/ses) : événements via HTTP.
  void getEnv().MAIL_PROVIDER;
  return new MockInboundMailAdapter();
}

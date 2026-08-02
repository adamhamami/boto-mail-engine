import { z } from "zod";

/** Types d’événements mail entrants supportés (indépendants du fournisseur). */
export const MAIL_EVENT_TYPES = [
  "EMAIL_DELIVERED",
  "EMAIL_REPLIED",
  "HARD_BOUNCE",
  "SOFT_BOUNCE",
  "COMPLAINT",
  "UNSUBSCRIBED",
  "PROVIDER_ERROR",
] as const;

export type MailEventType = (typeof MAIL_EVENT_TYPES)[number];

export const mailEventTypeSchema = z.enum(MAIL_EVENT_TYPES);

/**
 * Événement normalisé — contrat unique pour webhook, mock et IMAP.
 * Aucun corps d’email complet ; PII minimisée.
 */
export interface NormalizedMailEvent {
  provider: string;
  providerEventId: string;
  type: MailEventType;
  messageId?: string | null;
  timestamp: Date;
  /** Email expéditeur minimisé (jamais le corps) */
  sender?: string | null;
  /** Email destinataire minimisé */
  recipient?: string | null;
  campaignId?: string | null;
  contactId?: string | null;
  sendAttemptId?: string | null;
  campaignRecipientId?: string | null;
  /** Référence stockage (id WebhookEvent) plutôt que payload brut */
  rawPayloadReference?: string | null;
  /** Sous-ensemble non sensible pour traitement */
  payloadMinimized?: Record<string, unknown>;
}

/** Enveloppe JSON attendue sur POST /api/webhooks/mail */
export const inboundWebhookPayloadSchema = z.object({
  eventId: z.string().min(1).max(256),
  type: mailEventTypeSchema,
  messageId: z.string().min(1).max(512).optional().nullable(),
  timestamp: z.union([z.string().datetime(), z.number().int()]),
  sender: z.string().email().max(320).optional().nullable(),
  recipient: z.string().email().max(320).optional().nullable(),
  campaignId: z.string().min(1).max(64).optional().nullable(),
  contactId: z.string().min(1).max(64).optional().nullable(),
  sendAttemptId: z.string().min(1).max(64).optional().nullable(),
  campaignRecipientId: z.string().min(1).max(64).optional().nullable(),
  /** Métadonnées non PII (codes bounce, etc.) */
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export type InboundWebhookPayload = z.infer<typeof inboundWebhookPayloadSchema>;

export function redactEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const prefix = local!.slice(0, 2);
  return `${prefix}***@${domain}`;
}

import {
  inboundWebhookPayloadSchema,
  type InboundWebhookPayload,
  type NormalizedMailEvent,
  redactEmail,
} from "./types";

export function parseInboundWebhookPayload(
  input: unknown,
): InboundWebhookPayload {
  return inboundWebhookPayloadSchema.parse(input);
}

export function toNormalizedMailEvent(
  payload: InboundWebhookPayload,
  provider: string,
): NormalizedMailEvent {
  const timestamp =
    typeof payload.timestamp === "number"
      ? new Date(payload.timestamp)
      : new Date(payload.timestamp);

  return {
    provider,
    providerEventId: payload.eventId,
    type: payload.type,
    messageId: payload.messageId ?? null,
    timestamp,
    sender: payload.sender ?? null,
    recipient: payload.recipient ?? null,
    campaignId: payload.campaignId ?? null,
    contactId: payload.contactId ?? null,
    sendAttemptId: payload.sendAttemptId ?? null,
    campaignRecipientId: payload.campaignRecipientId ?? null,
    payloadMinimized: {
      type: payload.type,
      messageId: payload.messageId ?? null,
      campaignId: payload.campaignId ?? null,
      contactId: payload.contactId ?? null,
      sendAttemptId: payload.sendAttemptId ?? null,
      campaignRecipientId: payload.campaignRecipientId ?? null,
      sender: redactEmail(payload.sender),
      recipient: redactEmail(payload.recipient),
      metadata: payload.metadata ?? {},
      occurredAt: timestamp.toISOString(),
    },
  };
}

/** Stockage minimal — pas de corps email, emails rédigés. */
export function minimizeStoredPayload(
  event: NormalizedMailEvent,
): Record<string, unknown> {
  return {
    provider: event.provider,
    providerEventId: event.providerEventId,
    type: event.type,
    messageId: event.messageId ?? null,
    timestamp: event.timestamp.toISOString(),
    sender: redactEmail(event.sender),
    recipient: redactEmail(event.recipient),
    campaignId: event.campaignId ?? null,
    contactId: event.contactId ?? null,
    sendAttemptId: event.sendAttemptId ?? null,
    campaignRecipientId: event.campaignRecipientId ?? null,
    ...(event.payloadMinimized ?? {}),
  };
}

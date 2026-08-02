import { getEnv } from "@/lib/config/env";
import { normalizeEmailAddress } from "@/lib/data/integrity";
import { prisma } from "@/lib/db/prisma";
import { NotFoundError } from "@/lib/errors";
import {
  ContactStatus,
  EventType,
  SuppressionReason,
} from "@/generated/prisma/client";
import { stopContactSequence } from "@/lib/inbound/stop-sequence";

export { stopContactSequence } from "@/lib/inbound/stop-sequence";
export type { StopSequenceReason } from "@/lib/inbound/stop-sequence";

export function buildUnsubscribeUrl(token: string): string {
  const base = getEnv().APP_URL.replace(/\/$/, "");
  return `${base}/unsubscribe/${token}`;
}

export function appendUnsubscribeFooter(html: string, token: string): string {
  const url = buildUnsubscribeUrl(token);
  if (html.includes(url) || html.includes("/unsubscribe/")) {
    return html;
  }

  const footer = `
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;font-family:sans-serif;">
  <p>Vous recevez cet email dans le cadre d'une prospection BotoSchool.</p>
  <p><a href="${url}" style="color:#0f766e;">Se désinscrire</a></p>
</div>`;

  if (html.includes("</body>")) {
    return html.replace("</body>", `${footer}</body>`);
  }
  return `${html}${footer}`;
}

/**
 * CDC : désinscription immédiate → suppression list + arrêt séquence + confirmation.
 */
export async function processUnsubscribe(token: string): Promise<{
  email: string;
  alreadyUnsubscribed: boolean;
}> {
  const recipient = await prisma.campaignRecipient.findUnique({
    where: { unsubscribeToken: token },
    include: {
      contact: true,
      campaign: { select: { id: true } },
    },
  });

  if (!recipient) {
    throw new NotFoundError("Unsubscribe token");
  }

  const email = normalizeEmailAddress(recipient.contact.email);
  const already =
    recipient.contact.status === ContactStatus.UNSUBSCRIBED ||
    Boolean(recipient.unsubscribedAt);

  if (!already) {
    await stopContactSequence(
      recipient.contactId,
      "UNSUBSCRIBE",
      recipient.campaignId,
    );

    await prisma.event.create({
      data: {
        type: EventType.EMAIL_UNSUBSCRIBED,
        campaignId: recipient.campaignId,
        contactId: recipient.contactId,
        metadata: { token: "redacted", source: "unsubscribe_link" },
      },
    });
  } else {
    // Idempotent : s'assurer suppression list à jour
    await prisma.suppressionList.upsert({
      where: { emailNormalized: email },
      create: {
        email: recipient.contact.email,
        emailNormalized: email,
        reason: SuppressionReason.UNSUBSCRIBE,
        contactId: recipient.contactId,
        source: "unsubscribe_link",
      },
      update: {
        reason: SuppressionReason.UNSUBSCRIBE,
        contactId: recipient.contactId,
      },
    });
  }

  return { email, alreadyUnsubscribed: already };
}

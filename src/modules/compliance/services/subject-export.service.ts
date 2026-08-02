import { prisma } from "@/lib/db/prisma";
import { NotFoundError } from "@/lib/errors";
import { AuditAction } from "@/generated/prisma/client";
import { auditService } from "@/modules/audit/services/audit.service";

/**
 * Export portable d’une personne concernée (accès / portabilité CNDP).
 */
export async function exportContactSubjectData(
  contactId: string,
  actorUserId: string,
) {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          domain: true,
          city: true,
          country: true,
        },
      },
      events: {
        orderBy: { occurredAt: "desc" },
        take: 5000,
        select: {
          id: true,
          type: true,
          occurredAt: true,
          campaignId: true,
          ipAddress: true,
          userAgent: true,
          metadata: true,
        },
      },
      campaignRecipients: {
        orderBy: { createdAt: "desc" },
        take: 2000,
        select: {
          id: true,
          campaignId: true,
          status: true,
          sequenceStep: true,
          isSent: true,
          isStopped: true,
          stopReason: true,
          sentAt: true,
          openedAt: true,
          clickedAt: true,
          repliedAt: true,
          bouncedAt: true,
          unsubscribedAt: true,
          createdAt: true,
          campaign: { select: { id: true, name: true, status: true } },
        },
      },
      suppressions: {
        select: {
          id: true,
          email: true,
          reason: true,
          source: true,
          notes: true,
          createdAt: true,
        },
      },
      salesTasks: {
        select: {
          id: true,
          type: true,
          status: true,
          title: true,
          summary: true,
          dueAt: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!contact) throw new NotFoundError("Contact introuvable");

  const auditTrail = await prisma.auditLog.findMany({
    where: { entityType: "Contact", entityId: contactId },
    orderBy: { createdAt: "desc" },
    take: 1000,
    select: {
      id: true,
      action: true,
      module: true,
      entityType: true,
      entityId: true,
      createdAt: true,
      metadata: true,
      // Pas de old/new Values bruts (peuvent contenir tiers)
      ipAddress: true,
    },
  });

  const requests = await prisma.dataSubjectRequest.findMany({
    where: {
      OR: [{ contactId }, { emailNormalized: contact.emailNormalized }],
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const payload = {
    exportedAt: new Date().toISOString(),
    framework: ["CNDP", "Loi 09-08"],
    subject: {
      id: contact.id,
      email: contact.email,
      emailNormalized: contact.emailNormalized,
      firstName: contact.firstName,
      lastName: contact.lastName,
      phone: contact.phone,
      jobTitle: contact.jobTitle,
      city: contact.city,
      status: contact.status,
      tags: contact.tags,
      customFields: contact.customFields,
      source: contact.source,
      consentBase: contact.consentBase,
      eligibilityNotes: contact.eligibilityNotes,
      legalHold: contact.legalHold,
      anonymizedAt: contact.anonymizedAt,
      deletedAt: contact.deletedAt,
      lastContactedAt: contact.lastContactedAt,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
      organization: contact.organization,
    },
    interactions: {
      events: contact.events,
      campaignRecipients: contact.campaignRecipients,
      suppressions: contact.suppressions,
      salesTasks: contact.salesTasks,
    },
    compliance: {
      dataSubjectRequests: requests,
      auditTrail,
    },
  };

  await auditService.log({
    action: AuditAction.EXPORT,
    module: "compliance",
    entityType: "Contact",
    entityId: contactId,
    userId: actorUserId,
    metadata: {
      contactId,
      kind: "subject_export",
      eventCount: contact.events.length,
      recipientCount: contact.campaignRecipients.length,
    },
  });

  return payload;
}

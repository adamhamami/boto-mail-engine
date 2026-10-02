import {
  CampaignValidationError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { assertApproverIsNotCreator } from "@/lib/compliance/approval-gates";
import { getSkipTake } from "@/lib/api/pagination";
import {
  type EmailSendJobData,
} from "@/lib/queue";
import { CampaignStatus, EventType, SequenceStepType } from "@/generated/prisma/client";
import { auditService } from "@/modules/audit/services/audit.service";
import { campaignRepository } from "@/modules/campaigns/repositories/campaign.repository";
import type {
  CreateCampaignInput,
  ListCampaignRecipientsInput,
  ListCampaignsInput,
  ScheduleCampaignInput,
  UpdateCampaignInput,
} from "@/modules/campaigns/validators/campaign.validator";
import { segmentService } from "@/modules/segments/services/segment.service";
import { templateService } from "@/modules/templates/services/template.service";
import { sequenceService } from "@/modules/sequences/services/sequence.service";
import { prisma } from "@/lib/db/prisma";
import {
  assertSendExecutionAllowed,
  isContactSendable,
  mustSimulateProviderSend,
  TEST_MODE_MAX_RECIPIENTS,
} from "@/lib/compliance/send-gates";
import {
  appendUnsubscribeFooter,
  buildUnsubscribeUrl,
} from "@/lib/mail/unsubscribe";
import { getEnv } from "@/lib/config/env";
import { getMailProvider } from "@/lib/mail";
import {
  buildApprovalContentHash,
  type ApprovalSnapshot,
} from "@/lib/data/integrity";
import type { Prisma } from "@/generated/prisma/client";
import { getClock } from "@/lib/campaign-engine/clock";
import {
  createStepRecipientAndAttempt,
  enqueueEmailJob,
} from "@/lib/campaign-engine/enqueue";
import { planEmailSteps, computeStepScheduledAt } from "@/lib/campaign-engine/sequence-rules";
import type { EmailStepDef } from "@/lib/campaign-engine/sequence-rules";
import { scheduleCampaignStartJob } from "@/lib/campaign-engine/scheduler";
import {
  pauseCampaignEngine,
  resumeCampaignEngine,
} from "@/lib/campaign-engine/pause-resume";
import {
  getEnvQuotaLimits,
  parseCampaignEngineSettings,
} from "@/lib/campaign-engine/settings";
import { DEFAULT_SEND_WINDOW } from "@/lib/campaign-engine/send-window";
import { DEFAULT_CAMPAIGN_TIMEZONE } from "@/lib/campaign-engine/timezone";
import { RecipientStepStatus } from "@/generated/prisma/client";

export class CampaignService {
  async list(input: ListCampaignsInput) {
    const { skip, take } = getSkipTake(input.page, input.limit);
    return campaignRepository.findMany({
      skip,
      take,
      search: input.search,
      status: input.status,
      sortOrder: input.sortOrder,
    });
  }

  async getById(id: string) {
    const campaign = await campaignRepository.findById(id);
    if (!campaign) {
      throw new NotFoundError("Campaign", id);
    }
    return campaign;
  }

  async create(input: CreateCampaignInput, userId: string) {
    const campaign = await campaignRepository.create(input, userId);

    await auditService.log({
      action: "CREATE",
      module: "campaigns",
      entityType: "Campaign",
      entityId: campaign.id,
      userId,
      newValues: campaign,
    });

    return campaign;
  }

  async update(id: string, input: UpdateCampaignInput, userId: string) {
    const existing = await this.getById(id);

    if (
      existing.status !== CampaignStatus.DRAFT &&
      existing.status !== CampaignStatus.TESTED
    ) {
      throw new ValidationError(
        "Seules les campagnes BROUILLON ou TESTÉE peuvent être modifiées",
      );
    }

    // Modification matérielle après test : invalide une éventuelle trace d'approbation
    const campaign = await campaignRepository.update(
      id,
      {
        ...input,
      },
      userId,
    );

    if (existing.approvalSnapshot || existing.validatedAt) {
      await campaignRepository.updateStatus(
        id,
        {
          status: CampaignStatus.DRAFT,
          validatedAt: null,
          validatedById: null,
          approvalSnapshot: null,
          approvedContentHash: null,
        },
        userId,
      );
    }

    await auditService.log({
      action: "UPDATE",
      module: "campaigns",
      entityType: "Campaign",
      entityId: campaign.id,
      userId,
      oldValues: existing,
      newValues: campaign,
      metadata: {
        approvalInvalidated: Boolean(
          existing.approvalSnapshot || existing.validatedAt,
        ),
      },
    });

    return this.getById(id);
  }

  async delete(id: string, userId: string) {
    const existing = await this.getById(id);
    const campaign = await campaignRepository.softDelete(id, userId);

    await auditService.log({
      action: "DELETE",
      module: "campaigns",
      entityType: "Campaign",
      entityId: campaign.id,
      userId,
      oldValues: existing,
    });

    return campaign;
  }

  /** CDC : BROUILLON → TESTÉE après envoi test réussi */
  async markTested(id: string, userId: string) {
    const campaign = await this.getById(id);

    if (
      campaign.status !== CampaignStatus.DRAFT &&
      campaign.status !== CampaignStatus.TESTED
    ) {
      throw new ValidationError("Seuls les brouillons peuvent être marqués testés");
    }

    if (!campaign.isTestMode) {
      throw new ValidationError(
        "Le marquage TESTÉE nécessite isTestMode=true (CDC R-04)",
      );
    }

    const updated = await campaignRepository.updateStatus(
      id,
      {
        status: CampaignStatus.TESTED,
        testedAt: new Date(),
        isTestMode: true,
      },
      userId,
    );

    await auditService.log({
      action: "UPDATE",
      module: "campaigns",
      entityType: "Campaign",
      entityId: id,
      userId,
      metadata: { action: "mark_tested" },
    });

    return updated;
  }

  async submitForValidation(id: string, userId: string) {
    const campaign = await this.getById(id);

    if (
      campaign.status !== CampaignStatus.DRAFT &&
      campaign.status !== CampaignStatus.TESTED
    ) {
      throw new ValidationError(
        "Seules les campagnes BROUILLON ou TESTÉE peuvent être soumises",
      );
    }

    if (campaign.status === CampaignStatus.DRAFT && !campaign.isTestMode) {
      throw new ValidationError(
        "CDC R-04 : un envoi test (statut TESTÉE) est requis avant approbation de production",
      );
    }

    const updated = await campaignRepository.updateStatus(
      id,
      { status: CampaignStatus.PENDING_VALIDATION },
      userId,
    );

    await auditService.log({
      action: "UPDATE",
      module: "campaigns",
      entityType: "Campaign",
      entityId: id,
      userId,
      metadata: { action: "submit_for_validation" },
    });

    return updated;
  }

  async validate(id: string, userId: string) {
    const campaign = await this.getById(id);

    if (campaign.status !== CampaignStatus.PENDING_VALIDATION) {
      throw new ValidationError(
        "Only campaigns pending validation can be validated",
      );
    }

    // Séparation des devoirs (P1-2) : le créateur ne peut pas s'auto-approuver
    assertApproverIsNotCreator(campaign.createdById, userId);

    const env = getEnv();
    const contentHash = buildApprovalContentHash({
      templateId: campaign.templateId,
      templateVersion: campaign.template?.version ?? null,
      templateSubject: campaign.template?.subject ?? null,
      templateBodyHtml: campaign.template?.bodyHtml ?? null,
      sequenceId: campaign.sequenceId,
      sequenceVersion: campaign.sequence?.version ?? null,
      segmentId: campaign.segmentId,
      segmentVersion: campaign.segment?.version ?? null,
      segmentFilters: campaign.segment?.filters ?? {},
      settings: campaign.settings,
      fromEmail: env.SMTP_FROM_EMAIL,
    });

    const snapshot: ApprovalSnapshot = {
      validatedAt: new Date().toISOString(),
      validatedById: userId,
      isTestMode: campaign.isTestMode,
      segment: {
        id: campaign.segmentId,
        version: campaign.segment?.version ?? null,
        filters: campaign.segment?.filters ?? {},
        contactCount: campaign.segment?.contactCount ?? null,
      },
      template: {
        id: campaign.templateId,
        version: campaign.template?.version ?? null,
        subject: campaign.template?.subject ?? null,
        contentHash: campaign.template?.contentHash ?? null,
      },
      sequence: {
        id: campaign.sequenceId,
        version: campaign.sequence?.version ?? null,
        stepCount: campaign.sequence?.steps?.length ?? null,
      },
      sender: {
        fromEmail: env.SMTP_FROM_EMAIL,
        fromName: env.SMTP_FROM_NAME,
      },
      quotas: {
        rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
        rateLimitMaxRequests: env.RATE_LIMIT_MAX_REQUESTS,
      },
      scheduleWindows: null,
      settings: campaign.settings,
      contentHash,
    };

    const updated = await campaignRepository.updateStatus(
      id,
      {
        status: CampaignStatus.VALIDATED,
        validatedAt: new Date(),
        validatedById: userId,
        approvalSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        approvedContentHash: contentHash,
      },
      userId,
    );

    await prisma.event.create({
      data: {
        type: EventType.CAMPAIGN_VALIDATED,
        campaignId: id,
        metadata: { validatedById: userId, contentHash },
      },
    });

    await auditService.log({
      action: "VALIDATE",
      module: "campaigns",
      entityType: "Campaign",
      entityId: id,
      userId,
      newValues: updated,
      metadata: { contentHash },
    });

    return updated;
  }

  async reject(id: string, userId: string) {
    const campaign = await this.getById(id);

    if (campaign.status !== CampaignStatus.PENDING_VALIDATION) {
      throw new ValidationError(
        "Only campaigns pending validation can be rejected",
      );
    }

    const updated = await campaignRepository.updateStatus(
      id,
      {
        status: CampaignStatus.DRAFT,
        validatedAt: null,
        validatedById: null,
      },
      userId,
    );

    await auditService.log({
      action: "REJECT",
      module: "campaigns",
      entityType: "Campaign",
      entityId: id,
      userId,
    });

    return updated;
  }

  async schedule(id: string, input: ScheduleCampaignInput, userId: string) {
    const campaign = await this.getById(id);

    assertSendExecutionAllowed({
      phase: "schedule",
      isTestMode: campaign.isTestMode,
      intendRealSmtp: false,
    });

    // Mode test CDC R-04 : lancer depuis BROUILLON/TESTÉE sans validation prod
    if (campaign.isTestMode) {
      if (
        campaign.status !== CampaignStatus.DRAFT &&
        campaign.status !== CampaignStatus.TESTED &&
        campaign.status !== CampaignStatus.VALIDATED &&
        campaign.status !== CampaignStatus.SCHEDULED
      ) {
        throw new ValidationError("Statut invalide pour un envoi test");
      }
      return this.startCampaign(id, userId);
    }

    if (campaign.status !== CampaignStatus.VALIDATED) {
      throw new CampaignValidationError(
        "Campaign must be validated before scheduling or sending",
      );
    }

    if (input.scheduledAt) {
      const scheduledAt = input.scheduledAt;
      const clock = getClock();
      if (scheduledAt.getTime() <= clock.now().getTime()) {
        throw new ValidationError("scheduledAt must be in the future");
      }

      const updated = await campaignRepository.updateStatus(
        id,
        {
          status: CampaignStatus.SCHEDULED,
          scheduledAt,
        },
        userId,
      );

      await scheduleCampaignStartJob({
        campaignId: id,
        scheduledAt,
        userId,
        clock,
      });

      await auditService.log({
        action: "UPDATE",
        module: "campaigns",
        entityType: "Campaign",
        entityId: id,
        userId,
        metadata: {
          action: "schedule",
          scheduledAt: scheduledAt.toISOString(),
          timezone: DEFAULT_CAMPAIGN_TIMEZONE,
        },
      });

      return updated;
    }

    return this.startCampaign(id, userId);
  }

  async startCampaign(id: string, userId: string) {
    const campaign = await this.getById(id);
    const isTestMode = campaign.isTestMode;
    const clock = getClock();

    // Mode test : peut démarrer depuis DRAFT/TESTED ; prod : VALIDATED/SCHEDULED seulement
    if (isTestMode) {
      if (
        campaign.status !== CampaignStatus.DRAFT &&
        campaign.status !== CampaignStatus.TESTED &&
        campaign.status !== CampaignStatus.VALIDATED &&
        campaign.status !== CampaignStatus.SCHEDULED
      ) {
        throw new ValidationError(
          "Mode test : statut de campagne invalide pour l'envoi",
        );
      }
    } else if (
      campaign.status !== CampaignStatus.VALIDATED &&
      campaign.status !== CampaignStatus.SCHEDULED
    ) {
      // Déjà RUNNING / COMPLETED → idempotent (double scheduler / double clic)
      if (
        campaign.status === CampaignStatus.RUNNING ||
        campaign.status === CampaignStatus.TESTED ||
        campaign.status === CampaignStatus.COMPLETED
      ) {
        return campaign;
      }
      throw new CampaignValidationError(
        "La campagne doit être VALIDÉE avant tout envoi de production",
      );
    }

    // Claim atomique multi-instance (prod SCHEDULED/VALIDATED)
    if (!isTestMode) {
      const claimed = await prisma.campaign.updateMany({
        where: {
          id,
          status: {
            in: [CampaignStatus.VALIDATED, CampaignStatus.SCHEDULED],
          },
        },
        data: {
          status: CampaignStatus.RUNNING,
          startedAt: clock.now(),
        },
      });
      if (claimed.count === 0) {
        return this.getById(id);
      }
    }

    assertSendExecutionAllowed({
      phase: "schedule",
      isTestMode,
      intendRealSmtp: false,
    });

    if (!isTestMode) {
      if (!campaign.approvalSnapshot || !campaign.approvedContentHash) {
        throw new CampaignValidationError(
          "Snapshot d'approbation manquant — revalidez la campagne",
        );
      }
      const currentHash = buildApprovalContentHash({
        templateId: campaign.templateId,
        templateVersion: campaign.template?.version ?? null,
        templateSubject: campaign.template?.subject ?? null,
        templateBodyHtml: campaign.template?.bodyHtml ?? null,
        sequenceId: campaign.sequenceId,
        sequenceVersion: campaign.sequence?.version ?? null,
        segmentId: campaign.segmentId,
        segmentVersion: campaign.segment?.version ?? null,
        segmentFilters: campaign.segment?.filters ?? {},
        settings: campaign.settings,
        fromEmail: getEnv().SMTP_FROM_EMAIL,
      });
      if (currentHash !== campaign.approvedContentHash) {
        throw new CampaignValidationError(
          "Le contenu a changé depuis l'approbation — snapshot invalide. Resoumettez pour validation.",
        );
      }
    }

    if (!campaign.segmentId) {
      throw new ValidationError("Campaign must have a segment");
    }

    const segment = await segmentService.getById(campaign.segmentId);
    if (segment.isDynamic) {
      await segmentService.refresh(campaign.segmentId, userId);
    }

    const segmentContacts = await campaignRepository.findSegmentContacts(
      campaign.segmentId,
    );

    let contactsToSend = segmentContacts
      .map((sc) => sc.contact)
      .filter((contact) =>
        isContactSendable(
          {
            email: contact.email,
            status: contact.status,
            source: contact.source,
            consentBase: contact.consentBase,
            deletedAt: contact.deletedAt,
            isDuplicate: contact.isDuplicate,
            isTestRecipient: contact.isTestRecipient,
          },
          { isTestMode },
        ),
      );

    const emails = contactsToSend.map((c) => c.email.toLowerCase());
    const suppressed = await campaignRepository.findSuppressedEmails(emails);
    contactsToSend = contactsToSend.filter(
      (contact) => !suppressed.has(contact.email.toLowerCase()),
    );

    if (isTestMode) {
      contactsToSend = contactsToSend.slice(0, TEST_MODE_MAX_RECIPIENTS);
    }

    if (contactsToSend.length === 0) {
      throw new ValidationError(
        isTestMode
          ? "Aucun destinataire de test sur l'allowlist serveur (TEST_EMAIL_ALLOWLIST / TEST_DOMAIN_ALLOWLIST)"
          : "Aucun contact ÉLIGIBLE avec source/consentement (hors liste de suppression)",
      );
    }

    const willCallRealSmtp = !mustSimulateProviderSend();
    assertSendExecutionAllowed({
      phase: "enqueue",
      isTestMode,
      intendRealSmtp: willCallRealSmtp,
    });

    if (willCallRealSmtp) {
      const healthy = await getMailProvider().verifyConnection();
      if (!healthy) {
        throw new CampaignValidationError(
          "Connecteur email non sain : SMTP réel refusé",
        );
      }
    }

    const sequenceSteps = campaign.sequence?.steps ?? [];
    let emailSteps;
    try {
      emailSteps = planEmailSteps(sequenceSteps);
    } catch {
      // Campagne template-only (pas de séquence) → une étape J0
      if (!campaign.templateId) {
        throw new ValidationError("Campaign must have a template or sequence");
      }
      emailSteps = [
        {
          id: "template-only",
          stepOrder: 0,
          templateId: campaign.templateId,
          delayDays: 0,
          delayHours: 0,
          emailIndex: 0,
        },
      ];
    }
    const sequenceVersion = campaign.sequence?.version ?? 1;
    const env = getEnv();
    const startedAt = clock.now();

    const engineSettings = parseCampaignEngineSettings(campaign.settings, {
      timeZone: env.CAMPAIGN_DEFAULT_TIMEZONE || DEFAULT_CAMPAIGN_TIMEZONE,
      quotas: getEnvQuotaLimits(),
      sendWindow: {
        ...DEFAULT_SEND_WINDOW,
        timeZone: env.CAMPAIGN_DEFAULT_TIMEZONE || DEFAULT_CAMPAIGN_TIMEZONE,
        startHour: env.SEND_WINDOW_START_HOUR,
        endHour: env.SEND_WINDOW_END_HOUR,
        allowedWeekdays: env.SEND_WINDOW_WEEKDAYS.split(",")
          .map((d) => Number(d.trim()))
          .filter((n) => Number.isFinite(n)),
      },
    });

    const templateById = new Map<
      string,
      { subject: string; bodyHtml: string; bodyText: string | null; version: number }
    >();
    for (const step of emailSteps) {
      const tpl = await templateService.getById(step.templateId);
      templateById.set(step.templateId, {
        subject: tpl.subject,
        bodyHtml: tpl.bodyHtml,
        bodyText: tpl.bodyText,
        version: tpl.version,
      });
    }

    for (const contact of contactsToSend) {
      for (const step of emailSteps) {
        const tpl = templateById.get(step.templateId)!;
        const probe = templateService.renderForContact(tpl, contact, {
          unsubscribeUrl: "https://preview.local/unsubscribe/probe",
        });
        if (probe.missingVariables.length > 0) {
          throw new ValidationError(
            `Variables manquantes (étape ${step.stepOrder}) pour ${contact.email}: ${probe.missingVariables.join(", ")}`,
          );
        }
      }
    }

    let enqueued = 0;
    let recipientRows = 0;

    // Mode test : passer TESTED avant enqueue (évite course worker sur statut DRAFT).
    if (isTestMode && campaign.status === CampaignStatus.DRAFT) {
      await campaignRepository.updateStatus(
        id,
        {
          status: CampaignStatus.TESTED,
          startedAt,
          testedAt: startedAt,
        },
        userId,
      );
    }

    for (const contact of contactsToSend) {
      for (const step of emailSteps) {
        const tpl = templateById.get(step.templateId)!;
        const stepAt = computeStepScheduledAt(
          startedAt,
          step,
          engineSettings.timeZone,
        );

        const idempotencyKey = [
          id,
          contact.id,
          String(step.stepOrder),
          `v${sequenceVersion}`,
        ].join(":");

        const created = await createStepRecipientAndAttempt({
          campaignId: id,
          contactId: contact.id,
          contactEmail: contact.email,
          step,
          sequenceVersion,
          contentVersion: tpl.version,
          scheduledAt: stepAt,
          idempotencyKey,
        });

        recipientRows += 1;
        if (!created.sendAttemptId) continue;

        if (!created.created) {
          const existingAttempt = await prisma.sendAttempt.findUnique({
            where: { id: created.sendAttemptId },
            select: { status: true },
          });
          if (
            existingAttempt?.status === "SENT" ||
            existingAttempt?.status === "SKIPPED"
          ) {
            continue;
          }
        }

        const unsubscribeUrl = buildUnsubscribeUrl(created.unsubscribeToken);
        const rendered = templateService.renderForContact(tpl, contact, {
          unsubscribeUrl,
        });

        let html = rendered.html;
        html = html.includes("{{lien_desinscription}}")
          ? html.replaceAll("{{lien_desinscription}}", unsubscribeUrl)
          : appendUnsubscribeFooter(html, created.unsubscribeToken);
        if (!html.includes("/unsubscribe/")) {
          html = appendUnsubscribeFooter(html, created.unsubscribeToken);
        }

        const subjectPrefix =
          isTestMode || env.DRY_RUN
            ? `[TEST/DRY_RUN] ${rendered.subject}`
            : rendered.subject;

        await prisma.sendAttempt.update({
          where: { id: created.sendAttemptId },
          data: {
            metadata: {
              subject: subjectPrefix,
              html,
              text: rendered.text ?? null,
              contentVersion: tpl.version,
              templateId: step.templateId,
              sequenceStep: step.stepOrder,
            },
          },
        });

        await prisma.campaignRecipient.update({
          where: { id: created.campaignRecipientId },
          data: {
            status:
              stepAt.getTime() > clock.now().getTime()
                ? RecipientStepStatus.SCHEDULED
                : RecipientStepStatus.QUEUED,
            scheduledAt: stepAt,
          },
        });

        const jobData: EmailSendJobData = {
          sendAttemptId: created.sendAttemptId,
          campaignRecipientId: created.campaignRecipientId,
          contactEmail: contact.email,
          subject: subjectPrefix,
          html,
          text: rendered.text,
          idempotencyKey,
        };

        await enqueueEmailJob(jobData, stepAt, {
          clock,
          sendWindow: engineSettings.sendWindow,
        });
        enqueued += 1;
      }
    }

    if (!isTestMode) {
      await prisma.contact.updateMany({
        where: { id: { in: contactsToSend.map((c) => c.id) } },
        data: { status: "IN_SEQUENCE", lastContactedAt: startedAt },
      });
    }

    const nextStatus =
      isTestMode && campaign.status === CampaignStatus.DRAFT
        ? CampaignStatus.TESTED
        : CampaignStatus.RUNNING;

    const updated = await campaignRepository.updateStatus(
      id,
      {
        status: nextStatus,
        startedAt,
        testedAt: isTestMode ? startedAt : campaign.testedAt,
        totalRecipients: contactsToSend.length,
        scheduledAt: campaign.scheduledAt,
      },
      userId,
    );

    await prisma.event.create({
      data: {
        type: EventType.CAMPAIGN_STARTED,
        campaignId: id,
        metadata: {
          totalRecipients: contactsToSend.length,
          enqueuedJobs: enqueued,
          recipientSteps: recipientRows,
          emailSteps: emailSteps.length,
          isTestMode,
          dryRun: env.DRY_RUN,
          timezone: engineSettings.timeZone,
          suppressedCount: emails.length - contactsToSend.length,
        },
      },
    });

    await auditService.log({
      action: "SEND",
      module: "campaigns",
      entityType: "Campaign",
      entityId: id,
      userId,
      metadata: {
        totalRecipients: contactsToSend.length,
        enqueuedJobs: enqueued,
        isTestMode,
        dryRun: env.DRY_RUN,
      },
    });

    return updated;
  }

  async cancel(id: string, userId: string) {
    const campaign = await this.getById(id);

    if (
      campaign.status === CampaignStatus.CANCELLED ||
      campaign.status === CampaignStatus.COMPLETED
    ) {
      throw new ValidationError("Campaign cannot be cancelled");
    }

    const updated = await campaignRepository.updateStatus(
      id,
      { status: CampaignStatus.CANCELLED },
      userId,
    );

    await auditService.log({
      action: "UPDATE",
      module: "campaigns",
      entityType: "Campaign",
      entityId: id,
      userId,
      metadata: { action: "cancel" },
    });

    return updated;
  }

  async pause(id: string, userId: string) {
    const campaign = await this.getById(id);

    if (campaign.status !== CampaignStatus.RUNNING) {
      throw new ValidationError("Only running campaigns can be paused");
    }

    await pauseCampaignEngine(id);

    const updated = await this.getById(id);

    await auditService.log({
      action: "UPDATE",
      module: "campaigns",
      entityType: "Campaign",
      entityId: id,
      userId,
      metadata: { action: "pause" },
    });

    return updated;
  }

  async resume(id: string, userId: string) {
    const campaign = await this.getById(id);

    if (campaign.status !== CampaignStatus.PAUSED) {
      throw new ValidationError("Only paused campaigns can be resumed");
    }

    if (!campaign.validatedAt && !campaign.isTestMode) {
      throw new CampaignValidationError(
        "Campaign must be validated before resuming sends",
      );
    }

    const { requeued } = await resumeCampaignEngine(id);
    const updated = await this.getById(id);

    await auditService.log({
      action: "UPDATE",
      module: "campaigns",
      entityType: "Campaign",
      entityId: id,
      userId,
      metadata: { action: "resume", requeued },
    });

    return updated;
  }

  async getRecipients(id: string, input: ListCampaignRecipientsInput) {
    await this.getById(id);
    const { skip, take } = getSkipTake(input.page, input.limit);
    const { items, total } = await campaignRepository.findRecipients({
      campaignId: id,
      skip,
      take,
    });
    const stats = await campaignRepository.getRecipientStats(id);

    return { items, total, stats };
  }

  /**
   * Récapitulatif pré-validation / pré-programmation (assistant campagne).
   * Lecture seule — ne contourne aucun contrôle d'envoi serveur.
   */
  async getReadiness(id: string) {
    const campaign = await this.getById(id);
    const env = getEnv();
    const warnings: string[] = [];
    const blockingReasons: string[] = [];

    if (!campaign.segmentId) {
      blockingReasons.push("Segment manquant");
    }
    if (!campaign.templateId && !campaign.sequenceId) {
      blockingReasons.push("Modèle ou séquence manquant");
    }

    let totalInSegment = 0;
    let eligibleCount = 0;
    let excludedCount = 0;
    const missingVariables = new Set<string>();

    if (campaign.segmentId) {
      const segmentContacts = await campaignRepository.findSegmentContacts(
        campaign.segmentId,
      );
      totalInSegment = segmentContacts.length;

      const candidates = segmentContacts.map((sc) => sc.contact);
      const sendable = candidates.filter((contact) =>
        isContactSendable(
          {
            email: contact.email,
            status: contact.status,
            source: contact.source,
            consentBase: contact.consentBase,
            deletedAt: contact.deletedAt,
            isDuplicate: contact.isDuplicate,
            isTestRecipient: contact.isTestRecipient,
          },
          { isTestMode: campaign.isTestMode },
        ),
      );

      const emails = sendable.map((c) => c.email.toLowerCase());
      const suppressed = await campaignRepository.findSuppressedEmails(emails);
      const afterSuppression = sendable.filter(
        (c) => !suppressed.has(c.email.toLowerCase()),
      );

      eligibleCount = campaign.isTestMode
        ? Math.min(afterSuppression.length, TEST_MODE_MAX_RECIPIENTS)
        : afterSuppression.length;
      excludedCount = Math.max(totalInSegment - eligibleCount, 0);

      if (campaign.isTestMode && afterSuppression.length > TEST_MODE_MAX_RECIPIENTS) {
        warnings.push(
          `Mode test : plafond ${TEST_MODE_MAX_RECIPIENTS} destinataires (allowlist)`,
        );
      }

      let emailSteps: EmailStepDef[] = [];
      try {
        emailSteps = planEmailSteps(campaign.sequence?.steps ?? []);
      } catch {
        if (campaign.templateId) {
          emailSteps = [
            {
              id: "template-only",
              stepOrder: 0,
              templateId: campaign.templateId,
              delayDays: 0,
              delayHours: 0,
              emailIndex: 0,
            },
          ];
        } else {
          emailSteps = [];
          blockingReasons.push("Séquence invalide (pas d'étapes EMAIL)");
        }
      }

      const templateById = new Map<
        string,
        { subject: string; bodyHtml: string; bodyText: string | null }
      >();
      for (const step of emailSteps) {
        try {
          const tpl = await templateService.getById(step.templateId);
          templateById.set(step.templateId, {
            subject: tpl.subject,
            bodyHtml: tpl.bodyHtml,
            bodyText: tpl.bodyText,
          });
        } catch {
          blockingReasons.push(`Template introuvable: ${step.templateId}`);
        }
      }

      const sample = afterSuppression.slice(0, 25);
      for (const contact of sample) {
        for (const step of emailSteps) {
          const tpl = templateById.get(step.templateId);
          if (!tpl) continue;
          const probe = templateService.renderForContact(tpl, contact, {
            unsubscribeUrl: "https://preview.local/unsubscribe/probe",
          });
          for (const v of probe.missingVariables) {
            missingVariables.add(v);
          }
        }
      }
    }

    if (missingVariables.size > 0) {
      warnings.push(
        `Variables manquantes détectées (échantillon): ${[...missingVariables].join(", ")}`,
      );
    }

    const engineSettings = parseCampaignEngineSettings(campaign.settings, {
      timeZone: env.CAMPAIGN_DEFAULT_TIMEZONE || DEFAULT_CAMPAIGN_TIMEZONE,
      quotas: getEnvQuotaLimits(),
      sendWindow: {
        ...DEFAULT_SEND_WINDOW,
        timeZone: env.CAMPAIGN_DEFAULT_TIMEZONE || DEFAULT_CAMPAIGN_TIMEZONE,
        startHour: env.SEND_WINDOW_START_HOUR,
        endHour: env.SEND_WINDOW_END_HOUR,
        allowedWeekdays: env.SEND_WINDOW_WEEKDAYS.split(",")
          .map((d) => Number(d.trim()))
          .filter((n) => Number.isFinite(n)),
      },
    });

    let connectorHealthy: boolean | null = null;
    if (!env.DRY_RUN) {
      try {
        connectorHealthy = await getMailProvider().verifyConnection();
      } catch {
        connectorHealthy = false;
      }
    } else {
      warnings.push("DRY_RUN actif — aucun SMTP réel");
    }

    if (env.DRY_RUN === false && connectorHealthy === false) {
      blockingReasons.push("Connecteur email non sain");
    }

    if (eligibleCount === 0) {
      blockingReasons.push("Aucun destinataire éligible");
    }

    if (
      !campaign.isTestMode &&
      campaign.status !== CampaignStatus.TESTED &&
      campaign.status !== CampaignStatus.PENDING_VALIDATION &&
      campaign.status !== CampaignStatus.VALIDATED
    ) {
      warnings.push("CDC R-04 : un envoi test (TESTÉE) est requis avant production");
    }

    return {
      campaignId: campaign.id,
      status: campaign.status,
      isTestMode: campaign.isTestMode,
      totals: {
        total: totalInSegment,
        eligible: eligibleCount,
        excluded: excludedCount,
      },
      missingVariables: [...missingVariables],
      template: campaign.template
        ? {
            id: campaign.template.id,
            name: campaign.template.name,
            version: campaign.template.version,
          }
        : null,
      sequence: campaign.sequence
        ? {
            id: campaign.sequence.id,
            name: campaign.sequence.name,
            version: campaign.sequence.version,
          }
        : null,
      sender: {
        fromName: env.SMTP_FROM_NAME,
        fromEmail: env.SMTP_FROM_EMAIL,
      },
      sendWindow: {
        timeZone: engineSettings.sendWindow.timeZone,
        startHour: engineSettings.sendWindow.startHour,
        endHour: engineSettings.sendWindow.endHour,
        allowedWeekdays: engineSettings.sendWindow.allowedWeekdays,
      },
      quotas: engineSettings.quotas,
      connector: {
        name: env.MAIL_PROVIDER,
        healthy: connectorHealthy,
        dryRun: env.DRY_RUN,
      },
      dryRun: env.DRY_RUN,
      warnings,
      blockingReasons,
      canSubmitForValidation:
        blockingReasons.length === 0 &&
        (campaign.status === CampaignStatus.TESTED ||
          (campaign.status === CampaignStatus.DRAFT && campaign.isTestMode)),
      canSchedule:
        blockingReasons.length === 0 &&
        campaign.status === CampaignStatus.VALIDATED &&
        !campaign.isTestMode,
    };
  }

  private async resolveEmailTemplate(campaign: {
    templateId: string | null;
    sequenceId: string | null;
  }) {
    if (campaign.templateId) {
      const template = await templateService.getById(campaign.templateId);
      return {
        subject: template.subject,
        bodyHtml: template.bodyHtml,
        bodyText: template.bodyText,
      };
    }

    if (campaign.sequenceId) {
      const sequence = await sequenceService.getById(campaign.sequenceId);
      const firstEmailStep = sequence.steps.find(
        (step) => step.type === SequenceStepType.EMAIL && step.templateId,
      );

      if (!firstEmailStep?.templateId) {
        throw new ValidationError("Sequence has no email step with a template");
      }

      const template = await templateService.getById(firstEmailStep.templateId);
      return {
        subject: template.subject,
        bodyHtml: template.bodyHtml,
        bodyText: template.bodyText,
      };
    }

    throw new ValidationError("Campaign must have a template or sequence");
  }
}

export const campaignService = new CampaignService();

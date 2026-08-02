import { prisma } from "@/lib/db/prisma";
import { CampaignStatus, Prisma } from "@/generated/prisma/client";
import type {
  CreateCampaignInput,
  UpdateCampaignInput,
} from "@/modules/campaigns/validators/campaign.validator";

/** Liste — sans bodyHtml / approvalSnapshot / filters (Phase 11). */
const campaignListSelect = {
  id: true,
  name: true,
  description: true,
  status: true,
  isTestMode: true,
  segmentId: true,
  templateId: true,
  sequenceId: true,
  scheduledAt: true,
  startedAt: true,
  completedAt: true,
  testedAt: true,
  validatedAt: true,
  validatedById: true,
  approvedContentHash: true,
  totalRecipients: true,
  sentCount: true,
  openCount: true,
  clickCount: true,
  replyCount: true,
  bounceCount: true,
  unsubscribeCount: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  createdById: true,
  segment: {
    select: { id: true, name: true, contactCount: true, version: true },
  },
  template: {
    select: { id: true, name: true, subject: true, version: true },
  },
  sequence: {
    select: {
      id: true,
      name: true,
      version: true,
      steps: { select: { id: true, stepOrder: true, type: true } },
    },
  },
  createdBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.CampaignSelect;

/** Détail — payload complet (gates / wizard). */
const campaignSelect = {
  ...campaignListSelect,
  approvalSnapshot: true,
  settings: true,
  updatedById: true,
  segment: {
    select: {
      id: true,
      name: true,
      contactCount: true,
      version: true,
      filters: true,
    },
  },
  template: {
    select: {
      id: true,
      name: true,
      subject: true,
      bodyHtml: true,
      version: true,
      contentHash: true,
    },
  },
  sequence: {
    select: {
      id: true,
      name: true,
      version: true,
      steps: { select: { id: true, stepOrder: true, type: true } },
    },
  },
  validatedBy: { select: { id: true, name: true, email: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  updatedBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.CampaignSelect;

const campaignRecipientSelect = {
  id: true,
  campaignId: true,
  contactId: true,
  sequenceStep: true,
  sequenceStepId: true,
  sequenceVersion: true,
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
  contact: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      status: true,
      organization: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.CampaignRecipientSelect;

export class CampaignRepository {
  async findMany(params: {
    skip: number;
    take: number;
    search?: string;
    status?: CampaignStatus;
    sortOrder?: "asc" | "desc";
  }) {
    const where: Prisma.CampaignWhereInput = {
      deletedAt: null,
      ...(params.status ? { status: params.status } : {}),
      ...(params.search
        ? { name: { contains: params.search, mode: "insensitive" } }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.campaign.findMany({
        where,
        select: campaignListSelect,
        orderBy: { createdAt: params.sortOrder ?? "desc" },
        skip: params.skip,
        take: params.take,
      }),
      prisma.campaign.count({ where }),
    ]);

    return { items, total };
  }

  async findById(id: string) {
    return prisma.campaign.findFirst({
      where: { id, deletedAt: null },
      select: campaignSelect,
    });
  }

  async create(input: CreateCampaignInput, userId: string) {
    return prisma.campaign.create({
      data: {
        name: input.name,
        description: input.description,
        segmentId: input.segmentId,
        templateId: input.templateId,
        sequenceId: input.sequenceId,
        isTestMode: input.isTestMode ?? true,
        settings: input.settings as Prisma.InputJsonValue,
        status: CampaignStatus.DRAFT,
        createdById: userId,
        updatedById: userId,
      },
      select: campaignSelect,
    });
  }

  async update(id: string, input: UpdateCampaignInput, userId: string) {
    const { settings, ...rest } = input;
    return prisma.campaign.update({
      where: { id },
      data: {
        ...rest,
        ...(settings !== undefined
          ? { settings: settings as Prisma.InputJsonValue }
          : {}),
        updatedById: userId,
      },
      select: campaignSelect,
    });
  }

  async softDelete(id: string, userId: string) {
    return prisma.campaign.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        updatedById: userId,
      },
      select: campaignSelect,
    });
  }

  async updateStatus(
    id: string,
    data: {
      status?: CampaignStatus;
      scheduledAt?: Date | null;
      startedAt?: Date | null;
      completedAt?: Date | null;
      testedAt?: Date | null;
      validatedAt?: Date | null;
      validatedById?: string | null;
      approvalSnapshot?: Prisma.InputJsonValue | typeof Prisma.DbNull | typeof Prisma.JsonNull | null;
      approvedContentHash?: string | null;
      totalRecipients?: number;
      isTestMode?: boolean;
    },
    userId: string,
  ) {
    const { approvalSnapshot, ...rest } = data;
    return prisma.campaign.update({
      where: { id },
      data: {
        ...rest,
        ...(approvalSnapshot === null
          ? { approvalSnapshot: Prisma.JsonNull }
          : approvalSnapshot !== undefined
            ? { approvalSnapshot }
            : {}),
        updatedById: userId,
      },
      select: campaignSelect,
    });
  }

  async findSegmentContacts(segmentId: string) {
    return prisma.segmentContact.findMany({
      where: { segmentId },
      select: {
        contact: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            jobTitle: true,
            city: true,
            status: true,
            source: true,
            consentBase: true,
            isTestRecipient: true,
            deletedAt: true,
            isDuplicate: true,
            organization: { select: { id: true, name: true, city: true } },
          },
        },
      },
    });
  }

  async findSuppressedEmails(emails: string[]) {
    if (emails.length === 0) {
      return new Set<string>();
    }

    const normalized = emails.map((e) => e.toLowerCase().trim());
    const suppressed = await prisma.suppressionList.findMany({
      where: {
        emailNormalized: { in: normalized },
      },
      select: { emailNormalized: true },
    });

    return new Set(suppressed.map((s) => s.emailNormalized));
  }

  async createRecipientsAndAttempts(params: {
    campaignId: string;
    sequenceVersion: number;
    sequenceStep?: number;
    sequenceStepId?: string | null;
    recipients: Array<{
      contactId: string;
      idempotencyKey: string;
      subject: string;
      html: string;
      text?: string;
      contactEmail: string;
    }>;
  }) {
    return prisma.$transaction(async (tx) => {
      const createdRecipients = [];

      for (const recipient of params.recipients) {
        const campaignRecipient = await tx.campaignRecipient.create({
          data: {
            campaignId: params.campaignId,
            contactId: recipient.contactId,
            sequenceStep: params.sequenceStep ?? 0,
            sequenceStepId: params.sequenceStepId ?? null,
            sequenceVersion: params.sequenceVersion,
          },
          select: { id: true, contactId: true, unsubscribeToken: true },
        });

        const sendAttempt = await tx.sendAttempt.create({
          data: {
            campaignRecipientId: campaignRecipient.id,
            idempotencyKey: recipient.idempotencyKey,
            status: "QUEUED",
          },
          select: {
            id: true,
            idempotencyKey: true,
            campaignRecipientId: true,
          },
        });

        createdRecipients.push({
          ...recipient,
          campaignRecipientId: campaignRecipient.id,
          sendAttemptId: sendAttempt.id,
          unsubscribeToken: campaignRecipient.unsubscribeToken,
        });
      }

      return createdRecipients;
    });
  }

  async findRecipients(params: {
    campaignId: string;
    skip: number;
    take: number;
  }) {
    const where: Prisma.CampaignRecipientWhereInput = {
      campaignId: params.campaignId,
    };

    const [items, total] = await Promise.all([
      prisma.campaignRecipient.findMany({
        where,
        select: campaignRecipientSelect,
        orderBy: { createdAt: "desc" },
        skip: params.skip,
        take: params.take,
      }),
      prisma.campaignRecipient.count({ where }),
    ]);

    return { items, total };
  }

  async getRecipientStats(campaignId: string) {
    const [total, sent, pending] = await Promise.all([
      prisma.campaignRecipient.count({ where: { campaignId } }),
      prisma.campaignRecipient.count({
        where: { campaignId, isSent: true },
      }),
      prisma.campaignRecipient.count({
        where: { campaignId, isSent: false },
      }),
    ]);

    return { total, sent, pending };
  }

  async incrementSentCount(campaignId: string) {
    return prisma.campaign.update({
      where: { id: campaignId },
      data: { sentCount: { increment: 1 } },
    });
  }
}

export const campaignRepository = new CampaignRepository();

import {
  AuditAction,
  DataSubjectRequestStatus,
  DataSubjectRequestType,
  type Prisma,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { normalizeEmailAddress } from "@/lib/data/integrity";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { getSkipTake } from "@/lib/api/pagination";
import { auditService } from "@/modules/audit/services/audit.service";
import type {
  CreateDataSubjectRequestInput,
  UpdateDataSubjectRequestInput,
} from "@/modules/compliance/validators/compliance.validator";

export class ComplianceRequestService {
  async create(input: CreateDataSubjectRequestInput, actorUserId: string) {
    const emailNormalized = normalizeEmailAddress(input.email);
    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + input.dueInDays);

    let contactId = input.contactId ?? null;
    if (!contactId) {
      const match = await prisma.contact.findFirst({
        where: {
          emailNormalized,
          anonymizedAt: null,
          deletedAt: null,
        },
        select: { id: true },
      });
      contactId = match?.id ?? null;
    }

    const request = await prisma.dataSubjectRequest.create({
      data: {
        type: input.type,
        email: input.email.trim(),
        emailNormalized,
        contactId,
        requesterName: input.requesterName,
        notes: input.notes,
        legalBasis: input.legalBasis,
        dueAt,
        createdById: actorUserId,
        status: DataSubjectRequestStatus.RECEIVED,
      },
    });

    await auditService.log({
      action: AuditAction.ACCESS,
      module: "compliance",
      entityType: "DataSubjectRequest",
      entityId: request.id,
      userId: actorUserId,
      newValues: {
        type: request.type,
        emailNormalized,
        contactId,
        dueAt: dueAt.toISOString(),
      },
      metadata: { kind: "request_created" },
    });

    return request;
  }

  async list(params: {
    page: number;
    limit: number;
    status?: DataSubjectRequestStatus;
    type?: DataSubjectRequestType;
    email?: string;
  }) {
    const where: Prisma.DataSubjectRequestWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.type ? { type: params.type } : {}),
      ...(params.email
        ? { emailNormalized: { contains: normalizeEmailAddress(params.email) } }
        : {}),
    };
    const { skip, take } = getSkipTake(params.page, params.limit);
    const [items, total] = await Promise.all([
      prisma.dataSubjectRequest.findMany({
        where,
        orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
        skip,
        take,
        include: {
          contact: {
            select: {
              id: true,
              email: true,
              status: true,
              anonymizedAt: true,
              legalHold: true,
            },
          },
          createdBy: { select: { id: true, name: true, email: true } },
          assignedTo: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.dataSubjectRequest.count({ where }),
    ]);
    return { items, total };
  }

  async update(
    id: string,
    input: UpdateDataSubjectRequestInput,
    actorUserId: string,
  ) {
    const existing = await prisma.dataSubjectRequest.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundError("Demande", id);

    if (
      input.status === DataSubjectRequestStatus.COMPLETED &&
      !input.resultSummary &&
      !existing.resultSummary
    ) {
      throw new ValidationError(
        "resultSummary requis pour clôturer une demande",
      );
    }

    const terminalStatuses: DataSubjectRequestStatus[] = [
      DataSubjectRequestStatus.COMPLETED,
      DataSubjectRequestStatus.REJECTED,
      DataSubjectRequestStatus.CANCELLED,
    ];
    const completedAt =
      input.status && terminalStatuses.includes(input.status)
        ? new Date()
        : undefined;

    // legalHold sur contact lié
    if (input.legalHold !== undefined && existing.contactId) {
      await prisma.contact.update({
        where: { id: existing.contactId },
        data: { legalHold: input.legalHold },
      });
    }

    const updated = await prisma.dataSubjectRequest.update({
      where: { id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.resultSummary !== undefined
          ? { resultSummary: input.resultSummary }
          : {}),
        ...(input.assignedToId !== undefined
          ? { assignedToId: input.assignedToId }
          : {}),
        ...(input.contactId !== undefined
          ? { contactId: input.contactId }
          : {}),
        ...(completedAt ? { completedAt } : {}),
      },
    });

    await auditService.log({
      action: AuditAction.UPDATE,
      module: "compliance",
      entityType: "DataSubjectRequest",
      entityId: id,
      userId: actorUserId,
      oldValues: {
        status: existing.status,
        contactId: existing.contactId,
      },
      newValues: {
        status: updated.status,
        contactId: updated.contactId,
        legalHold: input.legalHold,
      },
    });

    return updated;
  }
}

export const complianceRequestService = new ComplianceRequestService();

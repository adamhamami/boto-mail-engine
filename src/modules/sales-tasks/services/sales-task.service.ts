import { prisma } from "@/lib/db/prisma";
import { getSkipTake } from "@/lib/api/pagination";
import { NotFoundError } from "@/lib/errors";
import { auditService } from "@/modules/audit/services/audit.service";
import {
  SalesTaskPriority,
  SalesTaskStatus,
  SalesTaskType,
} from "@/generated/prisma/client";

export interface CreateSalesTaskInput {
  contactId: string;
  campaignId?: string | null;
  eventId?: string | null;
  type?: SalesTaskType;
  priority?: SalesTaskPriority;
  ownerId?: string | null;
  title: string;
  summary?: string | null;
  dueAt?: Date | null;
}

export interface ListSalesTasksInput {
  page?: number;
  limit?: number;
  status?: SalesTaskStatus;
}

export class SalesTaskService {
  async list(input: ListSalesTasksInput = {}) {
    const page = input.page ?? 1;
    const limit = Math.min(input.limit ?? 50, 100);
    const where = {
      ...(input.status ? { status: input.status } : {}),
    };

    const { skip, take } = getSkipTake(page, limit);

    const [items, total] = await Promise.all([
      prisma.salesTask.findMany({
        where,
        orderBy: [{ priority: "desc" }, { dueAt: "asc" }, { createdAt: "desc" }],
        skip,
        take,
        include: {
          contact: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          campaign: { select: { id: true, name: true } },
          owner: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.salesTask.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async create(input: CreateSalesTaskInput, userId: string) {
    const task = await prisma.salesTask.create({
      data: {
        contactId: input.contactId,
        campaignId: input.campaignId ?? null,
        eventId: input.eventId ?? null,
        type: input.type ?? SalesTaskType.REPLY_FOLLOW_UP,
        priority: input.priority ?? SalesTaskPriority.MEDIUM,
        ownerId: input.ownerId ?? null,
        title: input.title,
        summary: input.summary ?? null,
        dueAt: input.dueAt ?? null,
        createdById: userId,
      },
      include: {
        contact: { select: { id: true, email: true, firstName: true, lastName: true } },
        campaign: { select: { id: true, name: true } },
      },
    });

    await auditService.log({
      action: "CREATE",
      module: "sales_tasks",
      entityType: "SalesTask",
      entityId: task.id,
      userId,
      newValues: {
        id: task.id,
        type: task.type,
        status: task.status,
        contactId: task.contactId,
        campaignId: task.campaignId,
      },
    });

    return task;
  }

  async complete(id: string, userId: string) {
    const existing = await prisma.salesTask.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError("SalesTask", id);
    }

    const task = await prisma.salesTask.update({
      where: { id },
      data: {
        status: SalesTaskStatus.DONE,
        completedAt: new Date(),
      },
    });

    await auditService.log({
      action: "UPDATE",
      module: "sales_tasks",
      entityType: "SalesTask",
      entityId: id,
      userId,
      metadata: { action: "complete" },
    });

    return task;
  }
}

export const salesTaskService = new SalesTaskService();

import { NotFoundError, ValidationError } from "@/lib/errors";
import { auditService } from "@/modules/audit/services/audit.service";
import { contactRepository } from "@/modules/contacts/repositories/contact.repository";
import { prisma } from "@/lib/db/prisma";
import {
  buildContactFilterWhere,
  segmentRepository,
} from "@/modules/segments/repositories/segment.repository";
import type {
  CreateSegmentInput,
  ListSegmentsInput,
  SegmentFilters,
  UpdateSegmentInput,
} from "@/modules/segments/validators/segment.validator";
import { segmentFiltersSchema } from "@/modules/segments/validators/segment.validator";
import { getSkipTake } from "@/lib/api/pagination";

export class SegmentService {
  async list(input: ListSegmentsInput) {
    const { skip, take } = getSkipTake(input.page, input.limit);
    return segmentRepository.findMany({
      skip,
      take,
      search: input.search,
      sortOrder: input.sortOrder,
    });
  }

  async getById(id: string) {
    const segment = await segmentRepository.findById(id);
    if (!segment) {
      throw new NotFoundError("Segment", id);
    }
    return segment;
  }

  async create(input: CreateSegmentInput, userId: string) {
    const segment = await segmentRepository.create(input, userId);

    if (segment.isDynamic) {
      await this.refresh(segment.id, userId);
      return this.getById(segment.id);
    }

    await auditService.log({
      action: "CREATE",
      module: "segments",
      entityType: "Segment",
      entityId: segment.id,
      userId,
      newValues: segment,
    });

    return segment;
  }

  async update(id: string, input: UpdateSegmentInput, userId: string) {
    const existing = await this.getById(id);
    const segment = await segmentRepository.update(id, input, userId);

    await auditService.log({
      action: "UPDATE",
      module: "segments",
      entityType: "Segment",
      entityId: segment.id,
      userId,
      oldValues: existing,
      newValues: segment,
    });

    if (segment.isDynamic && input.filters !== undefined) {
      await this.refresh(id, userId);
      return this.getById(id);
    }

    return segment;
  }

  async delete(id: string, userId: string) {
    const existing = await this.getById(id);
    const segment = await segmentRepository.softDelete(id, userId);

    await auditService.log({
      action: "DELETE",
      module: "segments",
      entityType: "Segment",
      entityId: segment.id,
      userId,
      oldValues: existing,
    });

    return segment;
  }

  async refresh(id: string, userId: string) {
    const segment = await this.getById(id);

    if (!segment.isDynamic) {
      throw new ValidationError("Only dynamic segments can be refreshed");
    }

    const filters = segmentFiltersSchema.parse(segment.filters);
    const where = buildContactFilterWhere(filters);
    const contacts = await contactRepository.findMatchingFilters(where);
    const contactIds = contacts.map((c) => c.id);

    const updated = await segmentRepository.refreshMembership(id, contactIds);

    await auditService.log({
      action: "UPDATE",
      module: "segments",
      entityType: "Segment",
      entityId: id,
      userId,
      metadata: {
        action: "refresh",
        contactCount: contactIds.length,
        filters,
      },
    });

    return updated;
  }

  parseFilters(filters: unknown): SegmentFilters {
    return segmentFiltersSchema.parse(filters);
  }

  /**
   * Aperçu CDC : volume total, éligibles, exclus + raisons, page contacts.
   */
  async preview(filtersInput: unknown, page = 1, limit = 20) {
    const filters = segmentFiltersSchema.parse(filtersInput);
    const where = buildContactFilterWhere(filters);
    const { skip, take } = getSkipTake(page, limit);

    const [totalMatching, eligibleCount, activeTotal, items] =
      await Promise.all([
        prisma.contact.count({ where }),
        prisma.contact.count({
          where: { ...where, status: "ELIGIBLE" },
        }),
        prisma.contact.count({ where: { deletedAt: null } }),
        prisma.contact.findMany({
          where,
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            city: true,
            status: true,
            tags: true,
            organization: {
              select: { id: true, name: true, industry: true, size: true },
            },
            owner: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take,
        }),
      ]);

    const excluded = Math.max(0, activeTotal - totalMatching);
    const exclusionReasons = buildExclusionReasons(filters);

    return {
      filters,
      totals: {
        activeContacts: activeTotal,
        matching: totalMatching,
        eligible: eligibleCount,
        excluded,
      },
      exclusionReasons,
      items,
      page,
      limit,
    };
  }
}

function buildExclusionReasons(filters: SegmentFilters): string[] {
  const reasons: string[] = [];
  if (filters.eligibleOnly || filters.status === "ELIGIBLE") {
    reasons.push("Contacts non ÉLIGIBLE");
  }
  if (filters.city) reasons.push(`Ville ≠ ${filters.city}`);
  if (filters.establishmentType) {
    reasons.push(`Type établissement ≠ ${filters.establishmentType}`);
  }
  if (filters.organizationSize) {
    reasons.push(`Taille ≠ ${filters.organizationSize}`);
  }
  if (filters.organizationId) reasons.push("Organisation hors périmètre");
  if (filters.ownerId) reasons.push("Responsable différent");
  if (filters.tags?.length) reasons.push("Tags incomplets");
  if (filters.status && !filters.eligibleOnly) {
    reasons.push(`Statut ≠ ${filters.status}`);
  }
  if (!reasons.length) reasons.push("Filtres vides — aucun exclu par règle");
  return reasons;
}

export const segmentService = new SegmentService();

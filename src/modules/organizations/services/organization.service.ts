import { NotFoundError } from "@/lib/errors";
import { auditService } from "@/modules/audit/services/audit.service";
import { organizationRepository } from "@/modules/organizations/repositories/organization.repository";
import type {
  CreateOrganizationInput,
  ListOrganizationsInput,
  UpdateOrganizationInput,
} from "@/modules/organizations/validators/organization.validator";
import { getSkipTake } from "@/lib/api/pagination";

export class OrganizationService {
  async list(input: ListOrganizationsInput) {
    const { skip, take } = getSkipTake(input.page, input.limit);
    return organizationRepository.findMany({
      skip,
      take,
      search: input.search,
      domain: input.domain,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
    });
  }

  async getById(id: string) {
    const org = await organizationRepository.findById(id);
    if (!org) {
      throw new NotFoundError("Organization", id);
    }
    return org;
  }

  async create(input: CreateOrganizationInput, userId: string) {
    const org = await organizationRepository.create(input, userId);

    await auditService.log({
      action: "CREATE",
      module: "organizations",
      entityType: "Organization",
      entityId: org.id,
      userId,
      newValues: org,
    });

    return org;
  }

  async update(id: string, input: UpdateOrganizationInput, userId: string) {
    const existing = await this.getById(id);
    const org = await organizationRepository.update(id, input, userId);

    await auditService.log({
      action: "UPDATE",
      module: "organizations",
      entityType: "Organization",
      entityId: org.id,
      userId,
      oldValues: existing,
      newValues: org,
    });

    return org;
  }

  async delete(id: string, userId: string) {
    const existing = await this.getById(id);
    const org = await organizationRepository.softDelete(id, userId);

    await auditService.log({
      action: "DELETE",
      module: "organizations",
      entityType: "Organization",
      entityId: org.id,
      userId,
      oldValues: existing,
    });

    return org;
  }

  async findOrCreateByName(name: string, userId: string) {
    const existing = await organizationRepository.findByName(name);
    if (existing) {
      return existing;
    }
    return organizationRepository.create({ name, tags: [] }, userId);
  }
}

export const organizationService = new OrganizationService();

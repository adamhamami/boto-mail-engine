import { NotFoundError } from "@/lib/errors";
import { auditService } from "@/modules/audit/services/audit.service";
import { contactRepository } from "@/modules/contacts/repositories/contact.repository";
import type {
  CreateContactInput,
  ListContactsInput,
  QualifyContactInput,
  UpdateContactInput,
} from "@/modules/contacts/validators/contact.validator";
import { getSkipTake } from "@/lib/api/pagination";

export class ContactService {
  private async resolveDuplicateFlags(email: string, excludeId?: string) {
    const original = await contactRepository.findByEmail(email, excludeId);
    if (!original) {
      return { isDuplicate: false, duplicateOfId: null as string | null };
    }
    return { isDuplicate: true, duplicateOfId: original.id };
  }

  async list(input: ListContactsInput) {
    const { skip, take } = getSkipTake(input.page, input.limit);
    return contactRepository.findMany({
      skip,
      take,
      search: input.search,
      status: input.status,
      organizationId: input.organizationId,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
    });
  }

  async getById(id: string) {
    const contact = await contactRepository.findById(id);
    if (!contact) {
      throw new NotFoundError("Contact", id);
    }
    return contact;
  }

  async listDuplicates(page: number, limit: number) {
    const { skip, take } = getSkipTake(page, limit);
    return contactRepository.findDuplicates({ skip, take });
  }

  async create(input: CreateContactInput, userId: string) {
    const duplicateFlags = await this.resolveDuplicateFlags(input.email);
    const contact = await contactRepository.create(
      { ...input, ...duplicateFlags },
      userId,
    );

    await auditService.log({
      action: "CREATE",
      module: "contacts",
      entityType: "Contact",
      entityId: contact.id,
      userId,
      newValues: contact,
    });

    return contact;
  }

  async update(id: string, input: UpdateContactInput, userId: string) {
    const existing = await this.getById(id);
    const duplicateFlags = input.email
      ? await this.resolveDuplicateFlags(input.email, id)
      : { isDuplicate: existing.isDuplicate, duplicateOfId: existing.duplicateOfId };

    const contact = await contactRepository.update(
      id,
      { ...input, ...duplicateFlags },
      userId,
    );

    await auditService.log({
      action: "UPDATE",
      module: "contacts",
      entityType: "Contact",
      entityId: contact.id,
      userId,
      oldValues: existing,
      newValues: contact,
    });

    return contact;
  }

  async qualify(id: string, input: QualifyContactInput, userId: string) {
    const existing = await this.getById(id);
    const contact = await contactRepository.update(
      id,
      {
        status: input.status,
        ...(input.score !== undefined ? { score: input.score } : {}),
        ...(input.source !== undefined ? { source: input.source } : {}),
        ...(input.consentBase !== undefined
          ? { consentBase: input.consentBase }
          : {}),
        ...(input.eligibilityNotes !== undefined
          ? { eligibilityNotes: input.eligibilityNotes }
          : {}),
        ...(input.isTestRecipient !== undefined
          ? { isTestRecipient: input.isTestRecipient }
          : {}),
      },
      userId,
    );

    await auditService.log({
      action: "UPDATE",
      module: "contacts",
      entityType: "Contact",
      entityId: contact.id,
      userId,
      oldValues: {
        status: existing.status,
        score: existing.score,
        source: existing.source,
        consentBase: existing.consentBase,
      },
      newValues: {
        status: contact.status,
        score: contact.score,
        source: contact.source,
        consentBase: contact.consentBase,
      },
      metadata: { action: "qualify" },
    });

    return contact;
  }

  async delete(id: string, userId: string) {
    const existing = await this.getById(id);
    const contact = await contactRepository.softDelete(id, userId);

    await auditService.log({
      action: "DELETE",
      module: "contacts",
      entityType: "Contact",
      entityId: contact.id,
      userId,
      oldValues: existing,
    });

    return contact;
  }

  async upsertFromImport(
    data: CreateContactInput & { importBatchId: string },
    userId: string,
  ) {
    const existing = await contactRepository.findByEmail(data.email);
    const duplicateFlags = await this.resolveDuplicateFlags(
      data.email,
      existing?.id,
    );

    // Jamais ÉLIGIBLE via import
    const safeStatus =
      data.status === "ELIGIBLE" || data.status === "IN_SEQUENCE"
        ? "TO_REVIEW"
        : data.status;

    if (existing) {
      const { status: _ignored, ...rest } = data;
      void _ignored;
      return contactRepository.update(
        existing.id,
        {
          ...rest,
          ...duplicateFlags,
          // Ne pas changer le statut métier d’un contact existant via import
        },
        userId,
      );
    }

    return contactRepository.create(
      {
        ...data,
        ...duplicateFlags,
        status: safeStatus ?? "IMPORTED",
      },
      userId,
    );
  }
}

export const contactService = new ContactService();

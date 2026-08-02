import { NotFoundError } from "@/lib/errors";
import { getSkipTake } from "@/lib/api/pagination";
import { auditService } from "@/modules/audit/services/audit.service";
import { templateRepository } from "@/modules/templates/repositories/template.repository";
import {
  buildContactVariables,
  extractTemplateVariables,
  findMissingVariables,
  PREVIEW_SAMPLE_DATA,
  renderTemplateVariables,
  type ContactLike,
} from "@/modules/templates/utils/render-template";
import type {
  CreateTemplateInput,
  ListTemplatesInput,
  PreviewTemplateInput,
  UpdateTemplateInput,
} from "@/modules/templates/validators/template.validator";

export class TemplateService {
  async list(input: ListTemplatesInput) {
    const { skip, take } = getSkipTake(input.page, input.limit);
    return templateRepository.findMany({
      skip,
      take,
      search: input.search,
      sortOrder: input.sortOrder,
    });
  }

  async getById(id: string) {
    const template = await templateRepository.findById(id);
    if (!template) {
      throw new NotFoundError("Template", id);
    }
    return template;
  }

  async create(input: CreateTemplateInput, userId: string) {
    const variables =
      input.variables.length > 0
        ? input.variables
        : extractTemplateVariables(input.subject, input.bodyHtml, input.bodyText ?? "");

    const template = await templateRepository.create(
      { ...input, variables },
      userId,
    );

    await auditService.log({
      action: "CREATE",
      module: "templates",
      entityType: "Template",
      entityId: template.id,
      userId,
      newValues: template,
    });

    return template;
  }

  async update(id: string, input: UpdateTemplateInput, userId: string) {
    const existing = await this.getById(id);

    const merged = {
      subject: input.subject ?? existing.subject,
      bodyHtml: input.bodyHtml ?? existing.bodyHtml,
      bodyText: input.bodyText ?? existing.bodyText,
    };

    const variables =
      input.variables ??
      extractTemplateVariables(
        merged.subject,
        merged.bodyHtml,
        merged.bodyText ?? "",
      );

    const template = await templateRepository.update(
      id,
      { ...input, variables },
      userId,
    );

    await auditService.log({
      action: "UPDATE",
      module: "templates",
      entityType: "Template",
      entityId: template.id,
      userId,
      oldValues: existing,
      newValues: template,
    });

    return template;
  }

  async delete(id: string, userId: string) {
    const existing = await this.getById(id);
    const template = await templateRepository.softDelete(id, userId);

    await auditService.log({
      action: "DELETE",
      module: "templates",
      entityType: "Template",
      entityId: template.id,
      userId,
      oldValues: existing,
    });

    return template;
  }

  async preview(id: string, input: PreviewTemplateInput = {}) {
    const template = await this.getById(id);
    const sampleData = { ...PREVIEW_SAMPLE_DATA, ...input.sampleData };

    return {
      subject: renderTemplateVariables(template.subject, sampleData),
      bodyHtml: renderTemplateVariables(template.bodyHtml, sampleData, {
        escapeHtmlValues: true,
      }),
      bodyText: template.bodyText
        ? renderTemplateVariables(template.bodyText, sampleData)
        : null,
      sampleData,
    };
  }

  renderForContact(
    template: { subject: string; bodyHtml: string; bodyText: string | null },
    contact: ContactLike,
    extras?: { unsubscribeUrl?: string },
  ) {
    const variables = buildContactVariables(contact, extras);
    const combined = `${template.subject}\n${template.bodyHtml}\n${template.bodyText ?? ""}`;
    const missing = findMissingVariables(combined, variables).filter(
      (v) => v !== "lien_desinscription",
    );

    return {
      subject: renderTemplateVariables(template.subject, variables),
      html: renderTemplateVariables(template.bodyHtml, variables, {
        escapeHtmlValues: true,
      }),
      text: template.bodyText
        ? renderTemplateVariables(template.bodyText, variables)
        : undefined,
      missingVariables: missing,
    };
  }
}

export const templateService = new TemplateService();

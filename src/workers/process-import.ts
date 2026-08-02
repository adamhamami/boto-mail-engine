import { ContactStatus, ImportStatus } from "@/generated/prisma/client";
import { normalizeEmailAddress } from "@/lib/data/integrity";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { applyMapping, mapRawToImportRow } from "@/lib/imports/mapping";
import { parseImportFile } from "@/lib/imports/parse-file";
import { purgeImportTempFile } from "@/lib/imports/temp-storage";
import { contactService } from "@/modules/contacts/services/contact.service";
import { organizationService } from "@/modules/organizations/services/organization.service";
import { auditService } from "@/modules/audit/services/audit.service";
import path from "node:path";

export interface ImportProcessJobData {
  importBatchId: string;
  userId: string;
}

type MappingState = {
  mapping?: Record<string, string | null>;
  extension?: ".csv" | ".xlsx";
};

/**
 * Traitement asynchrone d’un lot d’import (worker).
 * Ne rend jamais ÉLIGIBLE automatiquement — IMPORTED / TO_REVIEW uniquement.
 */
export async function processImportBatch(
  data: ImportProcessJobData,
): Promise<void> {
  const batch = await prisma.importBatch.findUnique({
    where: { id: data.importBatchId },
  });

  if (!batch) {
    logger.warn({ id: data.importBatchId }, "Import batch not found");
    return;
  }

  if (
    batch.status !== ImportStatus.PENDING &&
    batch.status !== ImportStatus.PROCESSING
  ) {
    logger.info(
      { id: batch.id, status: batch.status },
      "Import batch already finalized",
    );
    return;
  }

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { status: ImportStatus.PROCESSING, startedAt: new Date() },
  });

  const mappingState = (batch.columnMapping ?? {}) as MappingState & {
    rows?: Array<Record<string, unknown>>;
  };
  const mapping = mappingState.mapping;

  // Mode JSON legacy : rows déjà en base
  if (!batch.tempFilePath && Array.isArray(mappingState.rows)) {
    await processJsonRows(batch.id, mappingState.rows, data.userId);
    return;
  }

  if (!mapping || !batch.tempFilePath) {
    await failBatch(batch.id, "Mapping ou fichier temporaire manquant");
    return;
  }

  const ext =
    mappingState.extension ??
    (path.extname(batch.filename).toLowerCase() === ".xlsx" ? ".xlsx" : ".csv");

  let sheet;
  try {
    sheet = await parseImportFile({
      tempRelativeKey: batch.tempFilePath,
      extension: ext,
    });
  } catch (error) {
    await failBatch(
      batch.id,
      error instanceof Error ? error.message : "Parse failed",
    );
    await purgeImportTempFile(batch.tempFilePath);
    return;
  }

  const headers = (batch.headers as string[])?.length
    ? (batch.headers as string[])
    : sheet.headers;

  let processedRows = 0;
  let successRows = 0;
  let errorRows = 0;
  let duplicateRows = 0;
  let rejectedRows = 0;
  let suppressedRows = 0;
  const errors: Array<{
    row: number;
    email?: string;
    message: string;
    code?: string;
  }> = [];

  const seenInFile = new Set<string>();

  for (let i = 0; i < sheet.rows.length; i += 1) {
    processedRows += 1;
    const raw = applyMapping(headers, sheet.rows[i]!, mapping);
    const mapped = mapRawToImportRow(raw);

    if (!mapped.ok) {
      errorRows += 1;
      rejectedRows += 1;
      errors.push({
        row: i + 2,
        message: mapped.message,
        code: "VALIDATION",
      });
      continue;
    }

    const row = mapped.row;
    const emailNormalized = normalizeEmailAddress(row.email);

    if (seenInFile.has(emailNormalized)) {
      duplicateRows += 1;
      rejectedRows += 1;
      errors.push({
        row: i + 2,
        email: emailNormalized,
        message: "Doublon interne au fichier",
        code: "FILE_DUPLICATE",
      });
      continue;
    }
    seenInFile.add(emailNormalized);

    const suppressed = await prisma.suppressionList.findUnique({
      where: { emailNormalized: emailNormalized },
      select: { id: true },
    });
    if (suppressed) {
      suppressedRows += 1;
      rejectedRows += 1;
      errors.push({
        row: i + 2,
        email: emailNormalized,
        message: "Email présent sur SuppressionList",
        code: "SUPPRESSED",
      });
      continue;
    }

    const existing = await prisma.contact.findFirst({
      where: { emailNormalized: emailNormalized },
      select: {
        id: true,
        deletedAt: true,
        organizationId: true,
        isDuplicate: true,
      },
    });

    if (existing?.deletedAt) {
      rejectedRows += 1;
      errorRows += 1;
      errors.push({
        row: i + 2,
        email: emailNormalized,
        message: "Contact soft-deleted — réactivation manuelle requise",
        code: "DELETED_CONTACT",
      });
      continue;
    }

    try {
      let organizationId: string | null = null;
      if (row.organizationName?.trim()) {
        const org = await organizationService.findOrCreateByName(
          row.organizationName.trim(),
          data.userId,
        );
        organizationId = org.id;

        // Enrichir type / taille si fournis
                if (row.establishmentType || row.organizationSize || row.city) {
          await prisma.organization.update({
            where: { id: org.id },
            data: {
              ...(row.establishmentType
                ? { industry: row.establishmentType }
                : {}),
              ...(row.organizationSize ? { size: row.organizationSize } : {}),
              ...(row.city ? { city: row.city } : {}),
            },
          });
        }

        if (
          existing?.organizationId &&
          existing.organizationId !== organizationId
        ) {
          errors.push({
            row: i + 2,
            email: emailNormalized,
            message:
              "Conflit d'organisation — contact existant conservé, org non écrasée",
            code: "ORG_CONFLICT",
          });
          organizationId = existing.organizationId;
        }
      }

      const contact = await contactService.upsertFromImport(
        {
          email: row.email,
          firstName: row.firstName,
          lastName: row.lastName,
          phone: row.phone,
          jobTitle: row.jobTitle,
          city: row.city,
          tags: row.tags ?? [],
          source: row.source ?? "import",
          consentBase: row.consentBase,
          organizationId,
          importBatchId: batch.id,
          // Jamais ELIGIBLE à l'import
          status: existing
            ? undefined
            : ContactStatus.IMPORTED,
        },
        data.userId,
      );

      // Nouveaux → IMPORTED ; si flags manquants → TO_REVIEW
      if (!existing) {
        const needsReview =
          !row.source ||
          !row.consentBase ||
          contact.isDuplicate;
        if (needsReview) {
          await prisma.contact.update({
            where: { id: contact.id },
            data: { status: ContactStatus.TO_REVIEW },
          });
        }
      }

      if (contact.isDuplicate || existing) {
        duplicateRows += 1;
      }

      successRows += 1;
    } catch (error) {
      errorRows += 1;
      rejectedRows += 1;
      errors.push({
        row: i + 2,
        email: emailNormalized,
        message: error instanceof Error ? error.message : "Processing error",
        code: "PROCESS_ERROR",
      });
    }

    if (processedRows % 50 === 0) {
      await prisma.importBatch.update({
        where: { id: batch.id },
        data: {
          processedRows,
          successRows,
          errorRows,
          duplicateRows,
          rejectedRows,
          suppressedRows,
        },
      });
    }
  }

  const finalStatus =
    errorRows === 0 && rejectedRows === 0
      ? ImportStatus.COMPLETED
      : successRows > 0
        ? ImportStatus.PARTIAL
        : ImportStatus.FAILED;

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: {
      status: finalStatus,
      processedRows,
      successRows,
      errorRows,
      duplicateRows,
      rejectedRows,
      suppressedRows,
      errors: errors.slice(0, 500),
      completedAt: new Date(),
      tempFilePath: null,
    },
  });

  await purgeImportTempFile(batch.tempFilePath);

  await auditService.log({
    action: "IMPORT",
    module: "imports",
    entityType: "ImportBatch",
    entityId: batch.id,
    userId: data.userId,
    metadata: {
      processedRows,
      successRows,
      errorRows,
      duplicateRows,
      rejectedRows,
      suppressedRows,
      status: finalStatus,
    },
  });

  logger.info(
    {
      importBatchId: batch.id,
      successRows,
      rejectedRows,
      duplicateRows,
      status: finalStatus,
    },
    "Import batch processed",
  );
}

async function failBatch(id: string, message: string): Promise<void> {
  await prisma.importBatch.update({
    where: { id },
    data: {
      status: ImportStatus.FAILED,
      errors: [{ row: 0, message }],
      completedAt: new Date(),
    },
  });
}

async function processJsonRows(
  batchId: string,
  rows: Array<Record<string, unknown>>,
  userId: string,
): Promise<void> {
  let processedRows = 0;
  let successRows = 0;
  let errorRows = 0;
  let duplicateRows = 0;
  const errors: Array<{ row: number; email?: string; message: string }> = [];
  const seen = new Set<string>();

  for (let i = 0; i < rows.length; i += 1) {
    processedRows += 1;
    const mapped = mapRawToImportRow(
      Object.fromEntries(
        Object.entries(rows[i]!).map(([k, v]) => [k, String(v ?? "")]),
      ),
    );
    if (!mapped.ok) {
      errorRows += 1;
      errors.push({ row: i + 1, message: mapped.message });
      continue;
    }
    const emailNormalized = normalizeEmailAddress(mapped.row.email);
    if (seen.has(emailNormalized)) {
      duplicateRows += 1;
      continue;
    }
    seen.add(emailNormalized);

    try {
      let organizationId: string | null = null;
      if (mapped.row.organizationName?.trim()) {
        const org = await organizationService.findOrCreateByName(
          mapped.row.organizationName.trim(),
          userId,
        );
        organizationId = org.id;
      }
      const contact = await contactService.upsertFromImport(
        {
          email: mapped.row.email,
          firstName: mapped.row.firstName,
          lastName: mapped.row.lastName,
          phone: mapped.row.phone,
          jobTitle: mapped.row.jobTitle,
          city: mapped.row.city,
          tags: mapped.row.tags ?? [],
          source: mapped.row.source ?? "import",
          consentBase: mapped.row.consentBase,
          organizationId,
          importBatchId: batchId,
          status: ContactStatus.IMPORTED,
        },
        userId,
      );
      if (contact.isDuplicate) duplicateRows += 1;
      successRows += 1;
    } catch (error) {
      errorRows += 1;
      errors.push({
        row: i + 1,
        email: emailNormalized,
        message: error instanceof Error ? error.message : "error",
      });
    }
  }

  const finalStatus =
    errorRows === 0
      ? ImportStatus.COMPLETED
      : successRows > 0
        ? ImportStatus.PARTIAL
        : ImportStatus.FAILED;

  await prisma.importBatch.update({
    where: { id: batchId },
    data: {
      status: finalStatus,
      processedRows,
      successRows,
      errorRows,
      duplicateRows,
      errors,
      completedAt: new Date(),
    },
  });
}

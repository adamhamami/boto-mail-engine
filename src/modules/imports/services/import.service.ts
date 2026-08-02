import { ImportStatus } from "@/generated/prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { getEnv } from "@/lib/config/env";
import { auditService } from "@/modules/audit/services/audit.service";
import { importRepository } from "@/modules/imports/repositories/import.repository";
import type {
  CreateImportInput,
  ListImportsInput,
  SetImportMappingInput,
} from "@/modules/imports/validators/import.validator";
import { getSkipTake } from "@/lib/api/pagination";
import {
  storeImportTempFile,
  validateImportFileMeta,
  purgeImportTempFile,
} from "@/lib/imports/temp-storage";
import { parseImportFile } from "@/lib/imports/parse-file";
import {
  applyMapping,
  mapRawToImportRow,
  suggestMapping,
} from "@/lib/imports/mapping";
import { getQueue, QUEUE_NAMES } from "@/lib/queue";
import path from "node:path";

export class ImportService {
  async list(input: ListImportsInput) {
    const { skip, take } = getSkipTake(input.page, input.limit);
    return importRepository.findMany({
      skip,
      take,
      status: input.status,
      sortOrder: input.sortOrder,
    });
  }

  async getById(id: string) {
    const batch = await importRepository.findById(id);
    if (!batch) {
      throw new NotFoundError("ImportBatch", id);
    }
    return batch;
  }

  /** Legacy JSON — stocke rows, process sync possible via confirm. */
  async create(input: CreateImportInput, userId: string) {
    const batch = await importRepository.create(input, userId);

    await auditService.log({
      action: "IMPORT",
      module: "imports",
      entityType: "ImportBatch",
      entityId: batch.id,
      userId,
      newValues: {
        filename: batch.filename,
        totalRows: batch.totalRows,
        mode: "json",
      },
    });

    return batch;
  }

  async uploadFile(
    file: { filename: string; mimeType: string; buffer: Buffer },
    userId: string,
  ) {
    const meta = validateImportFileMeta({
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: file.buffer.length,
      buffer: file.buffer,
    });

    const stored = await storeImportTempFile(file.buffer, file.filename);
    let sheet;
    try {
      sheet = await parseImportFile({
        tempRelativeKey: stored.relativeKey,
        extension: meta.extension,
      });
    } catch (error) {
      await purgeImportTempFile(stored.relativeKey);
      throw new ValidationError(
        error instanceof Error ? error.message : "Fichier invalide",
      );
    }

    const mapping = suggestMapping(sheet.headers);
    const batch = await importRepository.createFromUpload(
      {
        filename: file.filename,
        mimeType: meta.mimeType,
        fileSizeBytes: file.buffer.length,
        tempFilePath: stored.relativeKey,
        headers: sheet.headers,
        totalRows: sheet.rows.length,
        columnMapping: {
          mapping,
          extension: meta.extension,
          sha256: stored.sha256,
          previewSample: sheet.rows.slice(0, 5),
        },
      },
      userId,
    );

    await auditService.log({
      action: "IMPORT",
      module: "imports",
      entityType: "ImportBatch",
      entityId: batch.id,
      userId,
      metadata: {
        action: "upload",
        filename: file.filename,
        rows: sheet.rows.length,
        extension: meta.extension,
      },
    });

    return {
      ...batch,
      suggestedMapping: mapping,
      headers: sheet.headers,
    };
  }

  async setMapping(id: string, input: SetImportMappingInput, userId: string) {
    const batch = await this.getById(id);
    if (batch.status !== ImportStatus.PENDING) {
      throw new ValidationError("Mapping possible uniquement en PENDING");
    }
    if (!Object.values(input.mapping).includes("email")) {
      throw new ValidationError("Le champ email doit être mappé");
    }

    const prev = (batch.columnMapping ?? {}) as Record<string, unknown>;
    const updated = await importRepository.updateMapping(id, {
      ...prev,
      mapping: input.mapping,
    });

    await auditService.log({
      action: "UPDATE",
      module: "imports",
      entityType: "ImportBatch",
      entityId: id,
      userId,
      metadata: { action: "mapping" },
    });

    return updated;
  }

  async preview(id: string, limit = 20) {
    const batch = await this.getById(id);
    const state = (batch.columnMapping ?? {}) as {
      mapping?: Record<string, string | null>;
      extension?: ".csv" | ".xlsx";
      previewSample?: string[][];
    };
    const mapping = state.mapping;
    if (!mapping) {
      throw new ValidationError("Mapping manquant");
    }

    const headers = (batch.headers as string[]) ?? [];
    let rows: string[][] = state.previewSample ?? [];

    if (batch.tempFilePath) {
      const ext =
        state.extension ??
        (path.extname(batch.filename).toLowerCase() === ".xlsx"
          ? ".xlsx"
          : ".csv");
      const sheet = await parseImportFile({
        tempRelativeKey: batch.tempFilePath,
        extension: ext,
      });
      rows = sheet.rows.slice(0, Math.min(limit, getEnv().IMPORT_MAX_ROWS));
    }

    const preview = rows.map((row, index) => {
      const raw = applyMapping(headers, row, mapping);
      const mapped = mapRawToImportRow(raw);
      return {
        row: index + 2,
        raw,
        valid: mapped.ok,
        error: mapped.ok ? null : mapped.message,
        data: mapped.ok ? mapped.row : null,
      };
    });

    const invalid = preview.filter((p) => !p.valid).length;
    return {
      headers,
      mapping,
      totalRows: batch.totalRows,
      preview,
      invalidInPreview: invalid,
    };
  }

  /**
   * Confirme le mapping et enqueue le worker (réponse HTTP rapide).
   */
  async confirmAndEnqueue(id: string, userId: string) {
    const batch = await this.getById(id);
    if (batch.status !== ImportStatus.PENDING) {
      throw new ValidationError("Import déjà démarré ou terminé");
    }

    const state = (batch.columnMapping ?? {}) as {
      mapping?: Record<string, string | null>;
      rows?: unknown[];
    };

    // JSON legacy : rows en mémoire → process sync via worker data
    if (!batch.tempFilePath && Array.isArray(state.rows)) {
      // Ensure mapping has email synthetic for JSON rows
      await importRepository.markMappingConfirmed(id);
    } else {
      if (!state.mapping || !Object.values(state.mapping).includes("email")) {
        throw new ValidationError("Mapping email requis avant confirmation");
      }
      if (!batch.tempFilePath) {
        throw new ValidationError("Fichier temporaire manquant");
      }
      await importRepository.markMappingConfirmed(id);
    }

    const queue = getQueue(QUEUE_NAMES.IMPORT_PROCESS);
    await queue.add(
      "process-import",
      { importBatchId: id, userId },
      { jobId: `import:${id}` },
    );

    await auditService.log({
      action: "IMPORT",
      module: "imports",
      entityType: "ImportBatch",
      entityId: id,
      userId,
      metadata: { action: "confirm_enqueue" },
    });

    return this.getById(id);
  }

  /** @deprecated prefer confirmAndEnqueue — kept for UI process button */
  async process(id: string, userId: string) {
    return this.confirmAndEnqueue(id, userId);
  }
}

export const importService = new ImportService();

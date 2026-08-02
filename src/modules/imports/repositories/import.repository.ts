import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { CreateImportInput } from "@/modules/imports/validators/import.validator";

const importSelect = {
  id: true,
  filename: true,
  mimeType: true,
  status: true,
  totalRows: true,
  processedRows: true,
  successRows: true,
  errorRows: true,
  duplicateRows: true,
  rejectedRows: true,
  suppressedRows: true,
  fileSizeBytes: true,
  tempFilePath: true,
  headers: true,
  columnMapping: true,
  errors: true,
  mappingConfirmedAt: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  createdBy: { select: { id: true, name: true, email: true } },
  _count: { select: { contacts: true } },
} satisfies Prisma.ImportBatchSelect;

export class ImportRepository {
  async findMany(params: {
    skip: number;
    take: number;
    status?: string;
    sortOrder?: "asc" | "desc";
  }) {
    const where: Prisma.ImportBatchWhereInput = {
      ...(params.status
        ? { status: params.status as Prisma.EnumImportStatusFilter["equals"] }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.importBatch.findMany({
        where,
        select: importSelect,
        orderBy: { createdAt: params.sortOrder ?? "desc" },
        skip: params.skip,
        take: params.take,
      }),
      prisma.importBatch.count({ where }),
    ]);

    return { items, total };
  }

  async findById(id: string) {
    return prisma.importBatch.findUnique({
      where: { id },
      select: importSelect,
    });
  }

  async create(input: CreateImportInput, userId: string) {
    return prisma.importBatch.create({
      data: {
        filename: input.filename,
        mimeType: input.mimeType,
        totalRows: input.rows.length,
        columnMapping: {
          rows: input.rows,
          mapping: { email: "email" },
          extension: ".csv",
        },
        headers: ["email"],
        createdById: userId,
      },
      select: importSelect,
    });
  }

  async createFromUpload(
    input: {
      filename: string;
      mimeType: string;
      fileSizeBytes: number;
      tempFilePath: string;
      headers: string[];
      totalRows: number;
      columnMapping: Prisma.InputJsonValue;
    },
    userId: string,
  ) {
    return prisma.importBatch.create({
      data: {
        filename: input.filename,
        mimeType: input.mimeType,
        fileSizeBytes: input.fileSizeBytes,
        tempFilePath: input.tempFilePath,
        headers: input.headers,
        totalRows: input.totalRows,
        columnMapping: input.columnMapping,
        createdById: userId,
      },
      select: importSelect,
    });
  }

  async updateMapping(id: string, columnMapping: Prisma.InputJsonValue) {
    return prisma.importBatch.update({
      where: { id },
      data: { columnMapping },
      select: importSelect,
    });
  }

  async markMappingConfirmed(id: string) {
    return prisma.importBatch.update({
      where: { id },
      data: { mappingConfirmedAt: new Date() },
      select: importSelect,
    });
  }

  async updateStatus(
    id: string,
    data: {
      status: Prisma.ImportBatchUpdateInput["status"];
      processedRows?: number;
      successRows?: number;
      errorRows?: number;
      duplicateRows?: number;
      rejectedRows?: number;
      suppressedRows?: number;
      errors?: unknown;
      startedAt?: Date;
      completedAt?: Date;
      tempFilePath?: string | null;
    },
  ) {
    return prisma.importBatch.update({
      where: { id },
      data: {
        status: data.status,
        processedRows: data.processedRows,
        successRows: data.successRows,
        errorRows: data.errorRows,
        duplicateRows: data.duplicateRows,
        rejectedRows: data.rejectedRows,
        suppressedRows: data.suppressedRows,
        errors: data.errors as object | undefined,
        startedAt: data.startedAt,
        completedAt: data.completedAt,
        ...(data.tempFilePath !== undefined
          ? { tempFilePath: data.tempFilePath }
          : {}),
      },
      select: importSelect,
    });
  }

  async getStoredRows(id: string): Promise<unknown[]> {
    const batch = await prisma.importBatch.findUnique({
      where: { id },
      select: { columnMapping: true },
    });
    const mapping = batch?.columnMapping as { rows?: unknown[] } | null;
    return mapping?.rows ?? [];
  }
}

export const importRepository = new ImportRepository();

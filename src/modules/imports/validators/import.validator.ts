import { z } from "zod";
import { paginationSchema } from "@/lib/api/pagination";
import { columnMappingSchema, importRowSchema } from "@/lib/imports/mapping";

export { importRowSchema, columnMappingSchema };
export type { ImportRow, ColumnMapping } from "@/lib/imports/mapping";

/** Legacy JSON create — conservé pour compat tests / scripts */
export const createImportSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  rows: z.array(importRowSchema).min(1).max(10000),
});

export const listImportsSchema = paginationSchema.extend({
  status: z
    .enum(["PENDING", "PROCESSING", "COMPLETED", "FAILED", "PARTIAL"])
    .optional(),
});

export const setImportMappingSchema = z.object({
  mapping: columnMappingSchema,
});

export type CreateImportInput = z.infer<typeof createImportSchema>;
export type ListImportsInput = z.infer<typeof listImportsSchema>;
export type SetImportMappingInput = z.infer<typeof setImportMappingSchema>;

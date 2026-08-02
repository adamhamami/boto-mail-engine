import { z } from "zod";
import { paginationSchema } from "@/lib/api/pagination";
import { ContactStatus } from "@/generated/prisma/client";

export const segmentFiltersSchema = z.object({
  /** Ville (contact ou organisation) */
  city: z.string().max(255).optional(),
  /** Type d’établissement → Organization.industry */
  establishmentType: z.string().max(255).optional(),
  /** Taille → Organization.size */
  organizationSize: z.string().max(255).optional(),
  status: z.nativeEnum(ContactStatus).optional(),
  statuses: z.array(z.nativeEnum(ContactStatus)).optional(),
  /** Responsable commercial */
  ownerId: z.string().cuid().optional(),
  tags: z.array(z.string()).optional(),
  organizationId: z.string().cuid().optional(),
  /** true → uniquement ÉLIGIBLE */
  eligibleOnly: z.boolean().optional(),
  scoreMin: z.number().int().min(0).optional(),
  scoreMax: z.number().int().max(100).optional(),
});

export const createSegmentSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  filters: segmentFiltersSchema.default({}),
  isDynamic: z.boolean().optional().default(true),
});

export const updateSegmentSchema = createSegmentSchema.partial();

export const listSegmentsSchema = paginationSchema;

export const previewSegmentSchema = z.object({
  filters: segmentFiltersSchema.default({}),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type SegmentFilters = z.infer<typeof segmentFiltersSchema>;
export type CreateSegmentInput = z.infer<typeof createSegmentSchema>;
export type UpdateSegmentInput = z.infer<typeof updateSegmentSchema>;
export type ListSegmentsInput = z.infer<typeof listSegmentsSchema>;
export type PreviewSegmentInput = z.infer<typeof previewSegmentSchema>;

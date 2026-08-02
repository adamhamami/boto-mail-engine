import { z } from "zod";
import {
  DataSubjectRequestStatus,
  DataSubjectRequestType,
} from "@/generated/prisma/client";
import { paginationSchema } from "@/lib/api/pagination";

export const createDataSubjectRequestSchema = z.object({
  type: z.nativeEnum(DataSubjectRequestType),
  email: z.string().email().max(320),
  contactId: z.string().cuid().optional(),
  requesterName: z.string().max(200).optional(),
  notes: z.string().max(5000).optional(),
  legalBasis: z.string().max(500).optional(),
  /** Jours jusqu’à échéance — défaut 30 (CNDP) */
  dueInDays: z.coerce.number().int().min(1).max(90).default(30),
});

export const updateDataSubjectRequestSchema = z.object({
  status: z.nativeEnum(DataSubjectRequestStatus).optional(),
  notes: z.string().max(5000).optional(),
  resultSummary: z.string().max(5000).optional(),
  assignedToId: z.string().cuid().nullable().optional(),
  contactId: z.string().cuid().nullable().optional(),
  legalHold: z.boolean().optional(),
});

export const listDataSubjectRequestsSchema = paginationSchema.extend({
  status: z.nativeEnum(DataSubjectRequestStatus).optional(),
  type: z.nativeEnum(DataSubjectRequestType).optional(),
  email: z.string().optional(),
});

export const anonymizeContactSchema = z.object({
  reason: z.string().min(3).max(1000),
  requestId: z.string().cuid().optional(),
  /** Confirmation explicite anti-erreur */
  confirm: z.literal("anonymize"),
});

export const legalHoldSchema = z.object({
  legalHold: z.boolean(),
  reason: z.string().min(3).max(1000).optional(),
});

export const runRetentionSchema = z.object({
  confirm: z.literal("retention"),
  dryRun: z.boolean().default(true),
});

export type CreateDataSubjectRequestInput = z.infer<
  typeof createDataSubjectRequestSchema
>;
export type UpdateDataSubjectRequestInput = z.infer<
  typeof updateDataSubjectRequestSchema
>;
export type AnonymizeContactInput = z.infer<typeof anonymizeContactSchema>;

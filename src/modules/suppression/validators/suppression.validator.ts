import { z } from "zod";
import { paginationSchema } from "@/lib/api/pagination";
import { SuppressionReason } from "@/generated/prisma/client";

export const createSuppressionSchema = z.object({
  email: z.string().email().max(255),
  reason: z.nativeEnum(SuppressionReason),
  notes: z.string().max(5000).optional().nullable(),
  contactId: z.string().cuid().optional().nullable(),
});

export const listSuppressionSchema = paginationSchema.extend({
  reason: z.nativeEnum(SuppressionReason).optional(),
});

export type CreateSuppressionInput = z.infer<typeof createSuppressionSchema>;
export type ListSuppressionInput = z.infer<typeof listSuppressionSchema>;

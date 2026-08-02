import { z } from "zod";
import { paginationSchema } from "@/lib/api/pagination";
import { ContactStatus } from "@/generated/prisma/client";

export const listResponsesSchema = paginationSchema.extend({
  campaignId: z.string().cuid().optional(),
});

export const updateResponseSchema = z.object({
  status: z.nativeEnum(ContactStatus).optional(),
  notes: z.string().max(5000).optional().nullable(),
});

export type ListResponsesInput = z.infer<typeof listResponsesSchema>;
export type UpdateResponseInput = z.infer<typeof updateResponseSchema>;

import { z } from "zod";
import { paginationSchema } from "@/lib/api/pagination";

export const createOrganizationSchema = z.object({
  name: z.string().min(1).max(255),
  domain: z.string().max(255).optional().nullable(),
  industry: z.string().max(255).optional().nullable(),
  size: z.string().max(100).optional().nullable(),
  website: z.string().url().optional().nullable().or(z.literal("")),
  address: z.string().max(500).optional().nullable(),
  city: z.string().max(255).optional().nullable(),
  country: z.string().max(255).optional().nullable(),
  notes: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().default([]),
});

export const updateOrganizationSchema = createOrganizationSchema.partial();

export const listOrganizationsSchema = paginationSchema.extend({
  domain: z.string().optional(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type ListOrganizationsInput = z.infer<typeof listOrganizationsSchema>;

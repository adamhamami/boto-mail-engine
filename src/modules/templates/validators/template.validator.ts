import { z } from "zod";
import { paginationSchema } from "@/lib/api/pagination";

export const createTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  subject: z.string().min(1).max(500),
  bodyHtml: z.string().min(1),
  bodyText: z.string().optional().nullable(),
  variables: z.array(z.string()).optional().default([]),
});

export const updateTemplateSchema = createTemplateSchema.partial();

export const listTemplatesSchema = paginationSchema;

export const previewTemplateSchema = z.object({
  sampleData: z
    .object({
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      email: z.string().optional(),
      organization: z.string().optional(),
    })
    .optional(),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
export type ListTemplatesInput = z.infer<typeof listTemplatesSchema>;
export type PreviewTemplateInput = z.infer<typeof previewTemplateSchema>;

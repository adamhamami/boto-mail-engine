import { z } from "zod";
import { paginationSchema } from "@/lib/api/pagination";
import { CampaignStatus } from "@/generated/prisma/client";

export const createCampaignSchema = z
  .object({
    name: z.string().min(1).max(255),
    description: z.string().optional().nullable(),
    segmentId: z.string().cuid(),
    templateId: z.string().cuid().optional().nullable(),
    sequenceId: z.string().cuid().optional().nullable(),
    /** CDC : true par défaut — mode test (max 10 internes) */
    isTestMode: z.boolean().optional().default(true),
    settings: z.record(z.string(), z.unknown()).optional().default({}),
  })
  .superRefine((data, ctx) => {
    const hasTemplate = Boolean(data.templateId);
    const hasSequence = Boolean(data.sequenceId);

    if (hasTemplate === hasSequence) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either templateId or sequenceId, not both",
      });
    }
  });

export const updateCampaignSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional().nullable(),
  segmentId: z.string().cuid().optional(),
  templateId: z.string().cuid().optional().nullable(),
  sequenceId: z.string().cuid().optional().nullable(),
  isTestMode: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export const listCampaignsSchema = paginationSchema.extend({
  status: z.nativeEnum(CampaignStatus).optional(),
});

export const scheduleCampaignSchema = z.object({
  scheduledAt: z.coerce.date().optional(),
});

export const listCampaignRecipientsSchema = paginationSchema;

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
export type ListCampaignsInput = z.infer<typeof listCampaignsSchema>;
export type ScheduleCampaignInput = z.infer<typeof scheduleCampaignSchema>;
export type ListCampaignRecipientsInput = z.infer<
  typeof listCampaignRecipientsSchema
>;

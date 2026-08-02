import { z } from "zod";
import { paginationSchema } from "@/lib/api/pagination";
import { SequenceStepType } from "@/generated/prisma/client";
import {
  CDC_STEP_DELAY_BOUNDS,
  MAX_EMAIL_STEPS_V1,
} from "@/lib/campaign-engine/sequence-rules";

export const sequenceStepSchema = z
  .object({
    stepOrder: z.number().int().min(0),
    type: z.nativeEnum(SequenceStepType),
    templateId: z.string().cuid().optional().nullable(),
    delayDays: z.number().int().min(0).optional().default(0),
    delayHours: z.number().int().min(0).max(23).optional().default(0),
  })
  .superRefine((step, ctx) => {
    if (step.type === SequenceStepType.EMAIL && !step.templateId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "templateId is required for EMAIL steps",
        path: ["templateId"],
      });
    }
  });

export const createSequenceSchema = z
  .object({
    name: z.string().min(1).max(255),
    description: z.string().optional().nullable(),
    isActive: z.boolean().optional().default(true),
    steps: z.array(sequenceStepSchema).min(1),
  })
  .superRefine((data, ctx) => {
    validateEmailStepBounds(data.steps, ctx);
  });

export const updateSequenceSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
    steps: z.array(sequenceStepSchema).min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.steps) {
      validateEmailStepBounds(data.steps, ctx);
    }
  });

function validateEmailStepBounds(
  steps: z.infer<typeof sequenceStepSchema>[],
  ctx: z.RefinementCtx,
) {
  const emailSteps = steps
    .filter((s) => s.type === SequenceStepType.EMAIL)
    .sort((a, b) => a.stepOrder - b.stepOrder);

  if (emailSteps.length > MAX_EMAIL_STEPS_V1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Maximum ${MAX_EMAIL_STEPS_V1} étapes EMAIL en V1`,
      path: ["steps"],
    });
  }

  emailSteps.forEach((step, index) => {
    const bounds = CDC_STEP_DELAY_BOUNDS[index];
    if (!bounds) return;
    const delayDays = step.delayDays ?? 0;
    if (delayDays < bounds.minDays || delayDays > bounds.maxDays) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Étape EMAIL ${index + 1}: delayDays doit être entre ${bounds.minDays} et ${bounds.maxDays} (CDC J0 / J+4–6 / J+10–14)`,
        path: ["steps", steps.indexOf(step), "delayDays"],
      });
    }
  });
}

export const listSequencesSchema = paginationSchema;

export type SequenceStepInput = z.infer<typeof sequenceStepSchema>;
export type CreateSequenceInput = z.infer<typeof createSequenceSchema>;
export type UpdateSequenceInput = z.infer<typeof updateSequenceSchema>;
export type ListSequencesInput = z.infer<typeof listSequencesSchema>;

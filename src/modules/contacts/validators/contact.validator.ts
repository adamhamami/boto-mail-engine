import { z } from "zod";
import { paginationSchema } from "@/lib/api/pagination";
import { ContactStatus } from "@/generated/prisma/client";

export const createContactSchema = z.object({
  email: z.string().email().max(255),
  firstName: z.string().max(255).optional().nullable(),
  lastName: z.string().max(255).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  jobTitle: z.string().max(255).optional().nullable(),
  city: z.string().max(255).optional().nullable(),
  status: z.nativeEnum(ContactStatus).optional(),
  score: z.number().int().min(0).max(100).optional(),
  tags: z.array(z.string()).optional().default([]),
  organizationId: z.string().cuid().optional().nullable(),
  source: z.string().max(500).optional().nullable(),
  consentBase: z.string().max(500).optional().nullable(),
  eligibilityNotes: z.string().max(2000).optional().nullable(),
  isTestRecipient: z.boolean().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export const updateContactSchema = createContactSchema.partial();

export const listContactsSchema = paginationSchema.extend({
  status: z.nativeEnum(ContactStatus).optional(),
  organizationId: z.string().cuid().optional(),
  isTestRecipient: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => v === true || v === "true")
    .optional(),
});

/** CDC R-02 : ÉLIGIBLE exige source + base légale */
export const qualifyContactSchema = z
  .object({
    status: z.enum([ContactStatus.ELIGIBLE, ContactStatus.DISQUALIFIED, ContactStatus.TO_REVIEW]),
    score: z.number().int().min(0).max(100).optional(),
    source: z.string().min(2).max(500).optional(),
    consentBase: z.string().min(2).max(500).optional(),
    eligibilityNotes: z.string().max(2000).optional().nullable(),
    isTestRecipient: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.status === ContactStatus.ELIGIBLE) {
      if (!data.source?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "La source est obligatoire pour un contact ÉLIGIBLE (CDC R-02)",
          path: ["source"],
        });
      }
      if (!data.consentBase?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "La base légale / autorisation est obligatoire pour ÉLIGIBLE (CDC R-02)",
          path: ["consentBase"],
        });
      }
    }
  });

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type ListContactsInput = z.infer<typeof listContactsSchema>;
export type QualifyContactInput = z.infer<typeof qualifyContactSchema>;

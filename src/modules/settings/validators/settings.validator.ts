import { z } from "zod";

export const SETTING_KEYS = {
  FROM_NAME: "mail.fromName",
  FROM_EMAIL: "mail.fromEmail",
  REPLY_TO: "mail.replyTo",
  RATE_LIMIT_WINDOW_MS: "rateLimit.windowMs",
  RATE_LIMIT_MAX_REQUESTS: "rateLimit.maxRequests",
  DEFAULT_TIMEZONE: "app.defaultTimezone",
  COMPANY_NAME: "app.companyName",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export const updateSettingsSchema = z.object({
  fromName: z.string().min(1).max(255).optional(),
  fromEmail: z.string().email().max(255).optional(),
  replyTo: z.string().email().max(255).optional().nullable(),
  rateLimitWindowMs: z.number().int().min(1000).optional(),
  rateLimitMaxRequests: z.number().int().min(1).optional(),
  defaultTimezone: z.string().max(100).optional(),
  companyName: z.string().max(255).optional(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

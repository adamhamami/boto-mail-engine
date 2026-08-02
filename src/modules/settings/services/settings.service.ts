import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/config/env";
import { auditService } from "@/modules/audit/services/audit.service";
import type { Prisma } from "@/generated/prisma/client";
import {
  SETTING_KEYS,
  type UpdateSettingsInput,
} from "@/modules/settings/validators/settings.validator";

export interface PublicSettings {
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  defaultTimezone: string;
  companyName: string;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    fromName: string;
    fromEmail: string;
    source: "env";
    note: string;
  };
}

/** Vue publique SMTP — jamais d'hôte / user / password en clair (P1-3). */
export function buildMaskedSmtpPublicView(input: {
  host: string;
  port: number;
  secure: boolean;
  user: string | undefined;
  password: string | undefined;
  fromName: string;
  fromEmail: string;
}): PublicSettings["smtp"] {
  return {
    host: input.host ? "***" : "",
    port: input.port,
    secure: input.secure,
    user: input.user ? "***" : "",
    password: input.password ? "***" : "",
    fromName: input.fromName,
    fromEmail: input.fromEmail,
    source: "env",
    note:
      "Les identifiants SMTP (hôte, utilisateur, mot de passe) sont masqués — configurés uniquement via variables d'environnement, jamais stockés en base.",
  };
}

async function getSettingValue(key: string): Promise<unknown> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function upsertSetting(
  key: string,
  value: Prisma.InputJsonValue,
  isSecret = false,
): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value, isSecret },
    update: { value },
  });
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export class SettingsService {
  async getPublicSettings(): Promise<PublicSettings> {
    const [
      fromName,
      fromEmail,
      replyTo,
      rateLimitWindowMs,
      rateLimitMaxRequests,
      defaultTimezone,
      companyName,
    ] = await Promise.all([
      getSettingValue(SETTING_KEYS.FROM_NAME),
      getSettingValue(SETTING_KEYS.FROM_EMAIL),
      getSettingValue(SETTING_KEYS.REPLY_TO),
      getSettingValue(SETTING_KEYS.RATE_LIMIT_WINDOW_MS),
      getSettingValue(SETTING_KEYS.RATE_LIMIT_MAX_REQUESTS),
      getSettingValue(SETTING_KEYS.DEFAULT_TIMEZONE),
      getSettingValue(SETTING_KEYS.COMPANY_NAME),
    ]);

    return {
      fromName: stringValue(fromName, env.SMTP_FROM_NAME),
      fromEmail: stringValue(fromEmail, env.SMTP_FROM_EMAIL),
      replyTo: typeof replyTo === "string" ? replyTo : null,
      rateLimitWindowMs: numberValue(rateLimitWindowMs, env.RATE_LIMIT_WINDOW_MS),
      rateLimitMaxRequests: numberValue(
        rateLimitMaxRequests,
        env.RATE_LIMIT_MAX_REQUESTS,
      ),
      defaultTimezone: stringValue(defaultTimezone, "Africa/Casablanca"),
      companyName: stringValue(companyName, env.APP_NAME),
      smtp: buildMaskedSmtpPublicView({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        user: env.SMTP_USER,
        password: env.SMTP_PASSWORD,
        fromName: env.SMTP_FROM_NAME,
        fromEmail: env.SMTP_FROM_EMAIL,
      }),
    };
  }

  async update(input: UpdateSettingsInput, userId: string): Promise<PublicSettings> {
    const updates: Array<{ key: string; value: Prisma.InputJsonValue }> = [];

    if (input.fromName !== undefined) {
      updates.push({ key: SETTING_KEYS.FROM_NAME, value: input.fromName });
    }
    if (input.fromEmail !== undefined) {
      updates.push({ key: SETTING_KEYS.FROM_EMAIL, value: input.fromEmail });
    }
    if (input.replyTo !== undefined) {
      updates.push({ key: SETTING_KEYS.REPLY_TO, value: input.replyTo ?? "" });
    }
    if (input.rateLimitWindowMs !== undefined) {
      updates.push({
        key: SETTING_KEYS.RATE_LIMIT_WINDOW_MS,
        value: input.rateLimitWindowMs,
      });
    }
    if (input.rateLimitMaxRequests !== undefined) {
      updates.push({
        key: SETTING_KEYS.RATE_LIMIT_MAX_REQUESTS,
        value: input.rateLimitMaxRequests,
      });
    }
    if (input.defaultTimezone !== undefined) {
      updates.push({
        key: SETTING_KEYS.DEFAULT_TIMEZONE,
        value: input.defaultTimezone,
      });
    }
    if (input.companyName !== undefined) {
      updates.push({ key: SETTING_KEYS.COMPANY_NAME, value: input.companyName });
    }

    for (const item of updates) {
      await upsertSetting(item.key, item.value);
    }

    if (updates.length > 0) {
      await auditService.log({
        action: "UPDATE",
        module: "settings",
        entityType: "AppSetting",
        userId,
        newValues: Object.fromEntries(
          updates.map((u) => [u.key, u.value]),
        ),
      });
    }

    return this.getPublicSettings();
  }
}

export const settingsService = new SettingsService();

import {
  DEFAULT_CAMPAIGN_TIMEZONE,
} from "./timezone";
import {
  DEFAULT_SEND_WINDOW,
  type SendWindowConfig,
} from "./send-window";
import {
  DEFAULT_QUOTA_LIMITS,
  type QuotaLimits,
} from "./quotas";

export interface CampaignEngineSettings {
  timeZone: string;
  sendWindow: SendWindowConfig;
  quotas: QuotaLimits;
}

export function parseCampaignEngineSettings(
  raw: unknown,
  defaults?: Partial<CampaignEngineSettings>,
): CampaignEngineSettings {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const timeZone =
    typeof obj.timeZone === "string" && obj.timeZone.length > 0
      ? obj.timeZone
      : (defaults?.timeZone ?? DEFAULT_CAMPAIGN_TIMEZONE);

  const windowRaw =
    obj.sendWindow && typeof obj.sendWindow === "object"
      ? (obj.sendWindow as Record<string, unknown>)
      : {};

  const seasonal =
    windowRaw.seasonalOverride &&
    typeof windowRaw.seasonalOverride === "object"
      ? (windowRaw.seasonalOverride as Record<string, unknown>)
      : null;

  const sendWindow: SendWindowConfig = {
    timeZone:
      typeof windowRaw.timeZone === "string"
        ? windowRaw.timeZone
        : timeZone,
    allowedWeekdays: Array.isArray(windowRaw.allowedWeekdays)
      ? (windowRaw.allowedWeekdays as number[])
      : (defaults?.sendWindow?.allowedWeekdays ??
        DEFAULT_SEND_WINDOW.allowedWeekdays),
    startHour:
      typeof windowRaw.startHour === "number"
        ? windowRaw.startHour
        : (defaults?.sendWindow?.startHour ?? DEFAULT_SEND_WINDOW.startHour),
    endHour:
      typeof windowRaw.endHour === "number"
        ? windowRaw.endHour
        : (defaults?.sendWindow?.endHour ?? DEFAULT_SEND_WINDOW.endHour),
    seasonalOverride: seasonal
      ? {
          active: Boolean(seasonal.active),
          label: String(seasonal.label ?? "seasonal"),
          startHour: Number(seasonal.startHour ?? 9),
          endHour: Number(seasonal.endHour ?? 18),
          allowedWeekdays: Array.isArray(seasonal.allowedWeekdays)
            ? (seasonal.allowedWeekdays as number[])
            : undefined,
        }
      : null,
  };

  const quotaRaw =
    obj.quotas && typeof obj.quotas === "object"
      ? (obj.quotas as Record<string, unknown>)
      : {};

  const quotas: QuotaLimits = {
    perHour: num(quotaRaw.perHour, defaults?.quotas?.perHour ?? DEFAULT_QUOTA_LIMITS.perHour),
    perDay: num(quotaRaw.perDay, defaults?.quotas?.perDay ?? DEFAULT_QUOTA_LIMITS.perDay),
    perConnector: num(
      quotaRaw.perConnector,
      defaults?.quotas?.perConnector ?? DEFAULT_QUOTA_LIMITS.perConnector,
    ),
    perSenderDomain: num(
      quotaRaw.perSenderDomain,
      defaults?.quotas?.perSenderDomain ?? DEFAULT_QUOTA_LIMITS.perSenderDomain,
    ),
    perCampaign: num(
      quotaRaw.perCampaign,
      defaults?.quotas?.perCampaign ?? DEFAULT_QUOTA_LIMITS.perCampaign,
    ),
  };

  return { timeZone, sendWindow, quotas };
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function getEnvQuotaLimits(): QuotaLimits {
  // Lazy to avoid circular env at import in tests before env set
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getEnv } = require("@/lib/config/env") as typeof import("@/lib/config/env");
    const env = getEnv();
    return {
      perHour: env.SEND_QUOTA_PER_HOUR,
      perDay: env.SEND_QUOTA_PER_DAY,
      perConnector: env.SEND_QUOTA_PER_CONNECTOR,
      perSenderDomain: env.SEND_QUOTA_PER_SENDER_DOMAIN,
      perCampaign: env.SEND_QUOTA_PER_CAMPAIGN,
    };
  } catch {
    return { ...DEFAULT_QUOTA_LIMITS };
  }
}

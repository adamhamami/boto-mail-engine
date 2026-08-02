import {
  DEFAULT_CAMPAIGN_TIMEZONE,
  getZonedParts,
  zonedCivilToUtc,
} from "./timezone";

/**
 * Créneaux d’envoi administrables.
 * Ramadan / DST : pas de valeurs magiques — overrides explicites uniquement.
 */
export interface SendWindowConfig {
  timeZone: string;
  /** Jours autorisés 0=dim … 6=sam */
  allowedWeekdays: number[];
  startHour: number; // inclusif 0–23
  endHour: number; // exclusif 1–24
  /**
   * Fenêtre alternative explicite (ex. Ramadan).
   * Si `active: true`, remplace start/end (jours inchangés sauf override).
   */
  seasonalOverride?: {
    active: boolean;
    label: string;
    startHour: number;
    endHour: number;
    allowedWeekdays?: number[];
  } | null;
}

export const DEFAULT_SEND_WINDOW: SendWindowConfig = {
  timeZone: DEFAULT_CAMPAIGN_TIMEZONE,
  allowedWeekdays: [1, 2, 3, 4, 5], // lun–ven
  startHour: 9,
  endHour: 18,
  seasonalOverride: null,
};

export function resolveActiveWindow(config: SendWindowConfig): {
  timeZone: string;
  allowedWeekdays: number[];
  startHour: number;
  endHour: number;
  seasonalLabel: string | null;
} {
  const override = config.seasonalOverride;
  if (override?.active) {
    return {
      timeZone: config.timeZone,
      allowedWeekdays: override.allowedWeekdays ?? config.allowedWeekdays,
      startHour: override.startHour,
      endHour: override.endHour,
      seasonalLabel: override.label,
    };
  }
  return {
    timeZone: config.timeZone,
    allowedWeekdays: config.allowedWeekdays,
    startHour: config.startHour,
    endHour: config.endHour,
    seasonalLabel: null,
  };
}

export function isWithinSendWindow(
  date: Date,
  config: SendWindowConfig = DEFAULT_SEND_WINDOW,
): boolean {
  const active = resolveActiveWindow(config);
  const z = getZonedParts(date, active.timeZone);
  if (!active.allowedWeekdays.includes(z.weekday)) return false;
  return z.hour >= active.startHour && z.hour < active.endHour;
}

/**
 * Prochain instant UTC dans un créneau valide (≥ now).
 * Algorithme : avance jour par jour jusqu’à un weekday autorisé, pose startHour.
 */
export function nextValidSendSlot(
  now: Date,
  config: SendWindowConfig = DEFAULT_SEND_WINDOW,
): Date {
  if (isWithinSendWindow(now, config)) {
    return now;
  }

  const active = resolveActiveWindow(config);

  for (let dayOffset = 0; dayOffset < 16; dayOffset += 1) {
    const probe = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const z = getZonedParts(probe, active.timeZone);

    if (!active.allowedWeekdays.includes(z.weekday)) {
      continue;
    }

    const candidate = zonedCivilToUtc(
      {
        year: z.year,
        month: z.month,
        day: z.day,
        hour: active.startHour,
        minute: 0,
        second: 0,
      },
      active.timeZone,
    );

    // Même jour mais déjà après endHour → essayer le jour suivant
    if (dayOffset === 0 && z.hour >= active.endHour) {
      continue;
    }

    // Même jour avant startHour → startHour aujourd’hui
    if (candidate.getTime() >= now.getTime()) {
      return candidate;
    }

    // candidate dans le passé (horloge) mais on est avant endHour le même jour
    if (
      dayOffset === 0 &&
      z.hour < active.endHour &&
      z.hour >= active.startHour
    ) {
      return now;
    }
  }

  // Fallback : +1 jour startHour
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tz = getZonedParts(tomorrow, active.timeZone);
  return zonedCivilToUtc(
    {
      year: tz.year,
      month: tz.month,
      day: tz.day,
      hour: active.startHour,
      minute: 0,
      second: 0,
    },
    active.timeZone,
  );
}

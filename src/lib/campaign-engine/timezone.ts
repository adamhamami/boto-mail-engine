/** Fuseau CDC par défaut — jamais silencieux / caché. */
export const DEFAULT_CAMPAIGN_TIMEZONE = "Africa/Casablanca";

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0=Sun … 6=Sat (JS)
}

/**
 * Décompose un instant UTC en parties civiles dans un fuseau IANA.
 * DST géré par le moteur ICU (ex. Africa/Casablanca).
 */
export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value]),
  );

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: weekdayMap[parts.weekday ?? "Mon"] ?? 1,
  };
}

/**
 * Construit un Date UTC correspondant à une date/heure civile dans le fuseau.
 * Approximation itérative (DST-safe pour Casablanca).
 */
export function zonedCivilToUtc(
  parts: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute?: number;
    second?: number;
  },
  timeZone: string,
): Date {
  const guess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute ?? 0,
    parts.second ?? 0,
  );

  let utc = guess;
  for (let i = 0; i < 3; i += 1) {
    const z = getZonedParts(new Date(utc), timeZone);
    const asUtc = Date.UTC(
      z.year,
      z.month - 1,
      z.day,
      z.hour,
      z.minute,
      z.second,
    );
    const target = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute ?? 0,
      parts.second ?? 0,
    );
    utc += target - asUtc;
  }
  return new Date(utc);
}

export function addCalendarDaysUtc(
  start: Date,
  days: number,
  timeZone: string,
): Date {
  const z = getZonedParts(start, timeZone);
  const base = new Date(Date.UTC(z.year, z.month - 1, z.day));
  base.setUTCDate(base.getUTCDate() + days);
  return zonedCivilToUtc(
    {
      year: base.getUTCFullYear(),
      month: base.getUTCMonth() + 1,
      day: base.getUTCDate(),
      hour: z.hour,
      minute: z.minute,
      second: z.second,
    },
    timeZone,
  );
}

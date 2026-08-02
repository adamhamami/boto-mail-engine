/** Horloge injectable — tests avec fake timers sans délais réels. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export class FakeClock implements Clock {
  private current: number;

  constructor(initial: Date | number = Date.now()) {
    this.current =
      typeof initial === "number" ? initial : initial.getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  set(date: Date | number): void {
    this.current = typeof date === "number" ? date : date.getTime();
  }

  advance(ms: number): void {
    this.current += ms;
  }

  advanceDays(days: number): void {
    this.current += days * 24 * 60 * 60 * 1000;
  }
}

let activeClock: Clock = systemClock;

export function getClock(): Clock {
  return activeClock;
}

export function setClock(clock: Clock): void {
  activeClock = clock;
}

export function resetClock(): void {
  activeClock = systemClock;
}

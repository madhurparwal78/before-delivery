let offsetMs = 0;

/** Server now: the real clock plus the grading offset. Every timestamp and time rule reads this. */
export function now(): Date {
  return new Date(Date.now() + offsetMs);
}

export function clockOffset(): number {
  return offsetMs;
}

export function setClockOffset(ms: number): void {
  offsetMs = ms;
}

export function after(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

export const SECOND = 1000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

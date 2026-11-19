// The single server clock. Every time-dependent state reads this module.
let offsetMs: number | null = null; // grading clock offset from real time

export function setClock(now: Date): void {
  offsetMs = now.getTime() - Date.now();
}

export function clockNow(): Date {
  return offsetMs === null ? new Date() : new Date(Date.now() + offsetMs);
}

export function clockIso(): string {
  return clockNow().toISOString();
}

export function clockReset(): void {
  offsetMs = null;
}

export const clockOffset = (): number | null => offsetMs;

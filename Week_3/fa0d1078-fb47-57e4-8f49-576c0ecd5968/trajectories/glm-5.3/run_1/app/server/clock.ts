// The server clock. The grading clock route can set it; it decides dates,
// on-day results, finished_at and token expiry. It does not move duel timers,
// the join-limit window or room expiry, which use real milliseconds.

let offsetMs = 0;
let frozen: number | null = null;

export function now(): Date {
  if (frozen !== null) return new Date(frozen);
  return new Date(Date.now() + offsetMs);
}

export function setGradingClock(instant: Date | null): void {
  if (instant === null) {
    offsetMs = 0;
    frozen = null;
  } else {
    frozen = instant.getTime();
  }
}

export function gradingOffset(): number {
  return offsetMs;
}

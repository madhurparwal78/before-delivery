// Server now: the real clock plus the grading offset. Every server-side rule reads it here. DP-34, time rules.
let offsetMs = 0;

export function now(): Date {
  return new Date(Date.now() + offsetMs);
}

export function nowIso(): string {
  return now().toISOString();
}

export function setClockOffset(offset: number): void {
  offsetMs = offset;
}

export function clockOffset(): number {
  return offsetMs;
}

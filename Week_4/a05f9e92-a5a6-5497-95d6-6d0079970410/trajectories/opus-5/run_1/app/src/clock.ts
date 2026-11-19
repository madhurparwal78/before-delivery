/**
 * The one server clock. Every time-dependent decision reads it, never the system
 * time directly, so the grading clock governs them all.
 */

let offsetMs = 0;

export function now(): Date {
  return new Date(Date.now() + offsetMs);
}

export function nowMs(): number {
  return Date.now() + offsetMs;
}

/** Real elapsed time, used only for rate-limit windows. */
export function realNowMs(): number {
  return Date.now();
}

export function offset(): number {
  return offsetMs;
}

export function loadOffset(ms: number): void {
  offsetMs = ms;
}

export function setTo(instant: Date): void {
  offsetMs = instant.getTime() - Date.now();
}

export function advanceSeconds(seconds: number): void {
  offsetMs += Math.round(seconds * 1000);
}

export function resetToRealTime(): void {
  offsetMs = 0;
}

/** An ISO 8601 instant with an offset, as every API time is written. */
export function iso(d: Date): string {
  return d.toISOString();
}

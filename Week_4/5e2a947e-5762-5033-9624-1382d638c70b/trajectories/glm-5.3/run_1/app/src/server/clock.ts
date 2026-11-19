/**
 * The one server clock. Time-dependent decisions read this and never
 * the wall clock directly; the grading clock offsets it.
 */

let offsetMs = 0;

export function advanceClock(ms: number): void {
  offsetMs += ms;
}

export function now(): Date {
  return new Date(Date.now() + offsetMs);
}

export function nowIso(): string {
  return now().toISOString();
}

/** The server's current UTC date as YYYY-MM-DD. */
export function serverDate(): string {
  return now().toISOString().slice(0, 10);
}

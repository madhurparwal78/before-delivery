// The one server clock. Every rule (lead, horizon, expiry, cutoff, no-show, session) reads now() from here.

let offsetMs = 0;

export function now(): Date {
  return new Date(Date.now() + offsetMs);
}

/** Controlled clock: set the server's now; it then runs forward in real time. */
export function setNow(instant: Date): void {
  offsetMs = instant.getTime() - Date.now();
}

export function addMs(instant: Date, ms: number): Date {
  return new Date(instant.getTime() + ms);
}

export function addMinutes(instant: Date, minutes: number): Date {
  return addMs(instant, minutes * 60_000);
}

export function instantIso(instant: Date): string {
  return instant.toISOString();
}

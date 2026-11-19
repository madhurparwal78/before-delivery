let offsetMs = 0;

/** The one server clock. Every time-dependent decision reads it. */
export function now(): Date {
  return new Date(Date.now() + offsetMs);
}

export function nowMs(): number {
  return Date.now() + offsetMs;
}

export function isoNow(): string {
  return now().toISOString();
}

/** The server's current UTC date as `YYYY-MM-DD`. */
export function serverDate(): string {
  return now().toISOString().slice(0, 10);
}

export function advanceClock(ms: number): void {
  offsetMs += ms;
}

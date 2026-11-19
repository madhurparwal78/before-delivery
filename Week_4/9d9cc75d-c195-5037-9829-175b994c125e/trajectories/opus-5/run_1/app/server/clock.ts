let fixedMs: number | null = null;
let offsetMs = 0;

export function now(): Date {
  return new Date(fixedMs === null ? Date.now() + offsetMs : fixedMs);
}

export function nowIso(): string {
  return now().toISOString();
}

/** A set pins the server clock, which then moves only by advanceClock. */
export function setClock(iso: string): void {
  fixedMs = Date.parse(iso);
}

export function advanceClock(ms: number): void {
  if (fixedMs === null) offsetMs += ms;
  else fixedMs += ms;
}

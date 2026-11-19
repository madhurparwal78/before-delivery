// Domain rule: server time. Real clock unless the grading clock is set.
let clockOffsetMs: number | null = null;

export function now(): Date {
  return new Date(Date.now() + (clockOffsetMs ?? 0));
}

export function setClock(instant: Date | null): void {
  clockOffsetMs = instant === null ? null : instant.getTime() - Date.now();
}

export function hasSetClock(): boolean {
  return clockOffsetMs !== null;
}

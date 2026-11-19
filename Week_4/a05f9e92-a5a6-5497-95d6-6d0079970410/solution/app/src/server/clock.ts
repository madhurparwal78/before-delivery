let offsetMs = 0;
let frozenAt: number | null = null;

/** The one server clock. Real time appears only here; everything else asks `now()`. */
export function now(): number {
  return frozenAt ?? Date.now() + offsetMs;
}

export function nowDate(): Date {
  return new Date(now());
}

export function currentOffset(): number {
  return offsetMs;
}

export function loadOffset(value: number): void {
  offsetMs = value;
}

export function setClockTo(instantMs: number): void {
  offsetMs = instantMs - Date.now();
}

export function resetClock(): void {
  offsetMs = 0;
  frozenAt = null;
}

/** While the scheduler walks through due events, the clock reads the event instant. */
export function withClockAt<T>(instantMs: number, run: () => Promise<T>): Promise<T> {
  const previous = frozenAt;
  frozenAt = instantMs;
  return run().finally(() => {
    frozenAt = previous;
  });
}

export function realTime(): number {
  return Date.now();
}

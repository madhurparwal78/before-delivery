// The single server clock. Every business rule reads now() from here; nothing else reads the system time.

let originEpoch = 0;
let originMonotonic = 0;

/** Starts the clock at an instant (the test clock) or at the real time, then advances in real time. */
export function startClock(startAt: number | null): void {
  originMonotonic = performance.now();
  originEpoch = startAt ?? Date.now();
}

/** Epoch milliseconds now. */
export function now(): number {
  return originEpoch + (performance.now() - originMonotonic);
}

/** Epoch milliseconds now, truncated to the whole second (stored instants are second-precise). */
export function nowSecond(): number {
  return Math.floor(now() / 1000) * 1000;
}

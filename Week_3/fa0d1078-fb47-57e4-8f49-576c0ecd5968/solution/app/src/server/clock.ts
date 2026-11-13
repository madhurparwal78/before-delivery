let offsetMs = 0;

/** The server clock: real time, unless the grading route moved it. It decides dates, finishes and token expiry. */
export function now(): Date {
  return new Date(Date.now() + offsetMs);
}

/** Sets the clock to an instant (running on from there), or back to real time with null. */
export function setClock(instant: Date | null): void {
  offsetMs = instant ? instant.getTime() - Date.now() : 0;
}

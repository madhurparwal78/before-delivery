export const HOUR_MS = 3_600_000;

let offsetMs = 0;

/** The server clock: real time plus the offset the grading clock route set. */
export const now = (): Date => new Date(Date.now() + offsetMs);

/** Sets the clock to `instant`, running on from there; null returns to real time. */
export const setClock = (instant: Date | null): Date => {
  offsetMs = instant === null ? 0 : instant.getTime() - Date.now();
  return now();
};

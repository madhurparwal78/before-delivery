// The server clock: real time plus whatever the grading clock route has added (Time).

/** The last instant a `Date` can hold: past it every stored or printed time breaks, so the clock is never moved there. */
export const LAST_INSTANT_MS = 8.64e15;

let advancedMs = 0;

export const clock = {
  now: (): number => Date.now() + advancedMs,
  iso: (): string => new Date(Date.now() + advancedMs).toISOString(),
  advance(ms: number): void {
    advancedMs += ms;
  },
};

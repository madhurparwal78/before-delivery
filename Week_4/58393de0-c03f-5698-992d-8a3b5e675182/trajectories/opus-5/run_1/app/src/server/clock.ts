/** Server time: the real clock, unless the grading clock has been set. */

let origin: { fakeFromMs: number; realFromMs: number } | null = null;

export const serverNowMs = (): number => {
  if (origin === null) return Date.now();
  return origin.fakeFromMs + (Date.now() - origin.realFromMs);
};

export const serverNow = (): Date => new Date(serverNowMs());

export const serverNowIso = (): string => new Date(serverNowMs()).toISOString();

export const setGradingClock = (now: Date | null): void => {
  origin = now === null ? null : { fakeFromMs: now.getTime(), realFromMs: Date.now() };
};

let offsetMs = 0;

/** Server time: real time plus the grading offset. Every deadline is decided on it. */
export const now = (): number => Date.now() + offsetMs;

export const nowIso = (): string => new Date(now()).toISOString();

export const iso = (ms: number): string => new Date(ms).toISOString();

export const advanceClock = (ms: number): void => {
  offsetMs += ms;
};

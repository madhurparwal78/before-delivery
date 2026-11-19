let offsetMs = 0;

/** The one server clock. Every deadline reads it; the grading clock moves its offset. */
export const serverNow = (): number => Date.now() + offsetMs;

export const advanceClock = (ms: number): void => {
  offsetMs += ms;
};

export const toIso = (ms: number): string => new Date(ms).toISOString();
export const serverIso = (): string => toIso(serverNow());
export const serverDate = (): string => serverIso().slice(0, 10);

/** The real time, only for signing requests to the object store; never a decision. */
export const signingTime = (): Date => new Date();

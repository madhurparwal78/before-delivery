export const now = (): Date => new Date();

/** Stored and published instants are whole seconds. */
export const wholeSecond = (at: Date): Date => new Date(Math.floor(at.getTime() / 1000) * 1000);

export const instant = (at: Date): string => `${at.toISOString().slice(0, 19)}Z`;

export const maybeInstant = (at: Date | null): string | null => (at ? instant(at) : null);

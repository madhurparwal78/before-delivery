/** The server clock: every time-dependent rule reads it here, never the device or the database. */
export const now = (): Date => new Date();

export const secondsFromNow = (seconds: number): Date => new Date(Date.now() + seconds * 1000);

export const secondsAgo = (seconds: number): Date => new Date(Date.now() - seconds * 1000);

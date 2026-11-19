/** Seconds as `mm:ss`, the form of every breakout timer. */
export const clockText = (seconds: number): string => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

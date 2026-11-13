export const BAND_START = 100;
export const BAND_STEP = 50;
export const BAND_MAX = 400;

export interface Band {
  low: number;
  high: number;
}

/**
 * The ranked band starts at plus or minus 100 around the player's rounded rating and
 * widens by 50 each period, up to plus or minus 400.
 */
export function bandFor(near: number, waitedSeconds: number, bandWidenSeconds: number): Band {
  const periods = Math.floor(waitedSeconds / bandWidenSeconds);
  const half = Math.min(BAND_START + BAND_STEP * periods, BAND_MAX);
  return { low: near - half, high: near + half };
}

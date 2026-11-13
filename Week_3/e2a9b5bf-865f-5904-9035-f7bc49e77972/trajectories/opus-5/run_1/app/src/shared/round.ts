/**
 * Round half up, correcting for the binary representation of decimal inputs so
 * that a value the brief states as an exact half (33.5 arcmin) rounds upward.
 */
export function roundHalfUp(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const nudged = scaled + Math.max(Math.abs(scaled), 1) * 1e-9;
  return Math.floor(nudged + 0.5) / factor;
}

/** Aperture prints bare when whole and to one decimal otherwise. */
export function formatAperture(apertureMm: number): string {
  const whole = roundHalfUp(apertureMm, 1);
  return Number.isInteger(whole) ? String(whole) : whole.toFixed(1);
}

export function formatExitPupil(exitPupilMm: number): string {
  return exitPupilMm.toFixed(1);
}

/** Rounds half up with halves moving away from zero. */
export function roundHalfAway(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const scaled = Math.abs(value) * factor;
  // Compensate for binary representations that sit a hair below a .5 boundary.
  const rounded = Math.round(Number(scaled.toFixed(6)));
  return (value < 0 ? -rounded : rounded) / factor;
}

/** The single place the builder's degrees become the hero record's radians. */
export function degreesToStoredRadians(degrees: number): number {
  return roundHalfAway((degrees * Math.PI) / 180, 4);
}

/** The slider shows a stored pose angle as whole degrees. */
export function storedRadiansToDegrees(radians: number): number {
  return roundHalfAway((radians * 180) / Math.PI, 0);
}

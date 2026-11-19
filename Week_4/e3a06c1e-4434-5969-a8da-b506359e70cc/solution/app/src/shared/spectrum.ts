/** The index of a spectrum row's largest value, the lowest index on a tie. */
export function peakBin(bins: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i] > bins[best]) best = i;
  return best;
}

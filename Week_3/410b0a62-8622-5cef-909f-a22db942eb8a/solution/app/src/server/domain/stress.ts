/**
 * The normalised measure of a session: the fourth root of the mean fourth power of the 30-sample
 * trailing means, or the plain mean when there are fewer than 30 samples.
 */
export function normalisedMeasure(values: readonly number[]): number {
  const window = 30;
  if (values.length < window) return values.reduce((sum, value) => sum + value, 0) / values.length;
  let sum = 0;
  let fourths = 0;
  for (let index = 0; index < values.length; index++) {
    sum += values[index] ?? 0;
    if (index >= window) sum -= values[index - window] ?? 0;
    if (index >= window - 1) fourths += (sum / window) ** 4;
  }
  return (fourths / (values.length - window + 1)) ** 0.25;
}

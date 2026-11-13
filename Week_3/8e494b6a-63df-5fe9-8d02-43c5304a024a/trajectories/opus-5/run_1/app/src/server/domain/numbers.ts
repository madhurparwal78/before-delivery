/** Rounds half away from zero to the given number of decimals. */
export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const rounded = scaled >= 0 ? Math.floor(scaled + 0.5) : Math.ceil(scaled - 0.5);
  return rounded / factor;
}

export function fixed(value: number, decimals: number): string {
  return round(value, decimals).toFixed(decimals);
}

/** Up to <decimals> decimals, half away from zero, with no trailing zeros. */
export function upTo(value: number, decimals: number): string {
  const text = round(value, decimals).toFixed(decimals);
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

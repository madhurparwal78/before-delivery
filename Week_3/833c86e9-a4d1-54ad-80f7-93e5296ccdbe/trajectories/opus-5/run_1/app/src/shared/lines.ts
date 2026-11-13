import { PRICE_LINE_ORDER, PriceLine } from './types';

/** A night's price lines summed over rooms, in the published order. */
export function sumLines(groups: PriceLine[][]): PriceLine[] {
  const totals = new Map<string, number>();
  for (const group of groups) {
    for (const line of group) totals.set(line.key, (totals.get(line.key) ?? 0) + line.minor);
  }
  const out: PriceLine[] = [];
  for (const key of PRICE_LINE_ORDER) {
    const minor = totals.get(key);
    if (minor === undefined) continue;
    if (minor === 0 && key !== 'night_total') continue;
    out.push({ key, minor });
  }
  return out;
}

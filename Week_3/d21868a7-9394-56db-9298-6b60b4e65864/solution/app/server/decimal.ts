// The one conversion rule. ML and ML/day are BigInt thousandths ("milli") end to end; every
// rounding is to three decimals with halves rounded up (adapted from kit/modules/money).

export type Milli = bigint;

const ML_TEXT = /^\d{1,9}(\.\d{1,3})?$/;

/** A request value (decimal string or JSON number) with at most three decimals, else null. */
export function parseMl(value: unknown): Milli | null {
  let text: string;
  if (typeof value === "number" && Number.isFinite(value)) text = String(value);
  else if (typeof value === "string") text = value;
  else return null;
  if (!ML_TEXT.test(text)) return null;
  const [whole = "0", fraction = ""] = text.split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
}

export function formatMl(value: Milli): string {
  const sign = value < 0n ? "-" : "";
  const size = value < 0n ? -value : value;
  return `${sign}${size / 1000n}.${(size % 1000n).toString().padStart(3, "0")}`;
}

/** num / den rounded to the nearest integer, halves up, for non-negative operands. */
function divideHalfUp(num: bigint, den: bigint): bigint {
  return (num * 2n + den) / (den * 2n);
}

export function lower(a: Milli, b: Milli): Milli {
  return a < b ? a : b;
}

/** effective cap = the lower of the table cap and the restriction cap. */
export function effectiveCap(tableCap: Milli, restrictionCap: Milli | null): Milli {
  return restrictionCap === null ? tableCap : lower(tableCap, restrictionCap);
}

/** A restriction as the conversion rule sees it: its cap and the window minutes before it took effect. */
interface ProRating {
  cap: Milli;
  minutesBefore: number;
}

/** cap volume = table cap × hours ÷ 24, or, restricted, (table cap × m_before + effective cap × m_after) ÷ 1440. */
export function capVolume(tableCap: Milli, hours: number, restriction: ProRating | null): Milli {
  if (restriction === null) return divideHalfUp(tableCap * BigInt(hours), 24n);
  const before = BigInt(restriction.minutesBefore);
  const after = BigInt(hours * 60) - before;
  return divideHalfUp(tableCap * before + effectiveCap(tableCap, restriction.cap) * after, 1440n);
}

/** A turnout's max volume for a window = its outlet limit × hours ÷ 24. */
export function turnoutMaxVolume(maxRate: Milli, hours: number): Milli {
  return divideHalfUp(maxRate * BigInt(hours), 24n);
}

/** rate = volume × 24 ÷ window hours, fixed when the order is placed. */
export function flowRate(volume: Milli, hours: number): Milli {
  return divideHalfUp(volume * 24n, BigInt(hours));
}

export const VOLUME_MAX: Milli = 500_000n;
export const CAP_MAX: Milli = 10_000_000n;

// Lengths and units (brief: Business rules, Lengths and units). Every length is stored once in
// whole millimetres; every displayed length is computed from those millimetres.
export type Unit = "cm" | "in";

const MAX_DECIMALS: Record<Unit, number> = { cm: 1, in: 2 };

/** Decimal places written in a numeric value, or null when it is not a plain decimal. */
function decimals(text: string): number | null {
  const match = /^-?\d+(?:\.(\d+))?$/.exec(text);
  return match ? (match[1]?.length ?? 0) : null;
}

/**
 * Converts a length in cm (at most 1 decimal, mm = cm × 10) or inches (at most 2 decimals,
 * mm = inches × 25.4 rounded half up) to whole millimetres. Returns null when the value has too
 * many decimals or is not a number.
 */
export function toMillimetres(value: number | string, unit: Unit): number | null {
  const text = typeof value === "number" ? String(value) : value.trim();
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const places = decimals(text);
  if (places === null || places > MAX_DECIMALS[unit]) return null;
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace("-", "").split(".");
  if (unit === "cm") {
    const tenths = Number(whole) * 10 + Number(fraction.padEnd(1, "0"));
    return negative ? -tenths : tenths;
  }
  const hundredths = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  // inches × 25.4 = hundredths × 254 / 1000 millimetres; round half up on the magnitude.
  const mm = Math.floor((hundredths * 254 + 500) / 1000);
  return negative ? -mm : mm;
}

/** `<number> cm` with one decimal, or `<number> in` rounded half up to one decimal. No separators. */
export function formatLength(mm: number, unit: Unit): string {
  return `${lengthNumber(mm, unit)} ${unit}`;
}

/** The number part of a displayed length, as typed back into a length field. */
export function lengthNumber(mm: number, unit: Unit): string {
  if (unit === "cm") return (mm / 10).toFixed(1);
  // tenths of an inch = mm × 10 / 25.4 = mm × 100 / 254, rounded half up.
  const sign = mm < 0 ? -1 : 1;
  const tenths = Math.floor((Math.abs(mm) * 100 + 127) / 254);
  return ((sign * tenths) / 10).toFixed(1);
}

// Draught input: metres convert exactly; feet and inches convert at 25.4 mm to the inch,
// dropping any fraction of a millimetre. Clearance and billing read only the stored millimetres.

export const DRAUGHT_MIN_MM = 2000;
export const DRAUGHT_MAX_MM = 16000;

/** Decimal places a number was written with (exponent notation counts as too many). */
export const decimalsOf = (value: number): number => {
  const text = String(value);
  if (/e/i.test(text)) return Infinity;
  return text.includes(".") ? (text.split(".")[1] ?? "").length : 0;
};

/** Whole millimetres from metres with up to three decimals; null when more precise than that. */
export function draughtMmFromMetres(value: number): number | null {
  if (!Number.isFinite(value) || decimalsOf(value) > 3) return null;
  return Math.round(value * 1000);
}

/** Whole millimetres from feet and inches (inches with up to two decimals), fraction dropped. */
export function draughtMmFromFeet(feet: number, inches: number): number | null {
  if (!Number.isInteger(feet) || feet < 0 || !Number.isFinite(inches) || inches < 0 || inches >= 12) return null;
  if (decimalsOf(inches) > 2) return null;
  const hundredthsOfInch = feet * 1200 + Math.round(inches * 100);
  return Math.floor((hundredthsOfInch * 254) / 1000);
}

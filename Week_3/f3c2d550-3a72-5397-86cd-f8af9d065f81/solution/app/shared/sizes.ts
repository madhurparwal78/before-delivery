export type SizeUnit = "mm" | "in";

export interface SizeTenths {
  width: number;
  height: number;
  depth: number;
}

const MIN_SIZE_TENTHS = 1;
const MAX_SIZE_TENTHS = 50_000;
const TENTHS_PER_INCH = 254;

function oneDecimal(scaled: number): string {
  return `${Math.trunc(scaled / 10)}.${scaled % 10}`;
}

function tenthsToMillimetres(tenths: number): string {
  return oneDecimal(tenths);
}

function tenthsToInches(tenths: number): string {
  return oneDecimal(Math.floor((tenths * 20 + TENTHS_PER_INCH) / (TENTHS_PER_INCH * 2)));
}

export function sizeText(size: SizeTenths, unit: SizeUnit): string {
  const show = unit === "mm" ? tenthsToMillimetres : tenthsToInches;
  return `${show(size.width)} × ${show(size.height)} × ${show(size.depth)} ${unit}`;
}

/** Whole tenths of a millimetre for a typed number, or null when it has too many decimals. */
function typedToTenths(typed: string, unit: SizeUnit): number | null {
  const pattern = unit === "mm" ? /^(\d{1,6})(?:\.(\d))?$/ : /^(\d{1,6})(?:\.(\d{1,2}))?$/;
  const match = pattern.exec(typed.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = match[2] ?? "";
  if (unit === "mm") return whole * 10 + Number(fraction.padEnd(1, "0"));
  const hundredths = whole * 100 + Number(fraction.padEnd(2, "0"));
  return Math.floor((hundredths * TENTHS_PER_INCH + 50) / 100);
}

/** What a stored size reads as in a size field of the given unit. */
export function tenthsToTyped(tenths: number, unit: SizeUnit): string {
  return unit === "mm" ? tenthsToMillimetres(tenths) : tenthsToInches(tenths);
}

/**
 * The stored tenths a saved size field means. An inch value that equals the stored
 * value's one-decimal inch display keeps the stored tenths, so saving never drifts.
 */
export function tenthsAfterEdit(typed: string, unit: SizeUnit, stored: number | null): number | null {
  if (unit === "in" && stored !== null && typed.trim() !== "" && Number(typed) === Number(tenthsToInches(stored))) return stored;
  const tenths = typedToTenths(typed, unit);
  if (tenths === null || tenths < MIN_SIZE_TENTHS || tenths > MAX_SIZE_TENTHS) return null;
  return tenths;
}

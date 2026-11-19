/** Units, rounding and number formats. Every length, area and money figure is converted and rounded here and nowhere else. */

const MM_PER_INCH_TENTHS = 254;
const MM2_PER_M2 = 1_000_000;
const MM2_PER_FT2_HUNDREDTHS = 9_290_304;

/** n / d rounded half away from zero, in integer arithmetic. d must be positive. */
export function roundDiv(n: number, d: number): number {
  const num = BigInt(n);
  const den = BigInt(d);
  const magnitude = ((num < 0n ? -num : num) * 2n + den) / (2n * den);
  return Number(num < 0n ? -magnitude : magnitude);
}

/** An integer count of hundredths as a plain two-decimal string, with no grouping. */
function hundredths(value: number): string {
  const sign = value < 0 ? "-" : "";
  const magnitude = Math.abs(value);
  const whole = Math.trunc(magnitude / 100);
  const fraction = magnitude % 100;
  return `${sign}${whole}.${String(fraction).padStart(2, "0")}`;
}

export function inchesOf(mm: number): string {
  return hundredths(roundDiv(mm * 1000, MM_PER_INCH_TENTHS));
}

export function squareMetresOf(mm2: number): string {
  return hundredths(roundDiv(mm2 * 100, MM2_PER_M2));
}

export function squareFeetOf(mm2: number): string {
  return hundredths(roundDiv(mm2 * 10_000, MM2_PER_FT2_HUNDREDTHS));
}

function poundsOf(pence: number): string {
  return hundredths(pence);
}

/** Screen grouping: an integer part of 1000 or more is grouped in threes with one ordinary space. */
export function grouped(text: string | number): string {
  const [whole = "", ...rest] = String(text).split(".");
  const negative = whole.startsWith("-");
  const digits = negative ? whole.slice(1) : whole;
  const spaced = digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return [`${negative ? "-" : ""}${spaced}`, ...rest].join(".");
}

/** A length as millimetres then inches, the two halves of every length on screen. */
export function lengthParts(mm: number): [string, string] {
  return [`${grouped(mm)} mm`, `${grouped(inchesOf(mm))} in`];
}

export function lengthText(mm: number): string {
  const [metric, imperial] = lengthParts(mm);
  return `${metric} (${imperial})`;
}

/** An area as square metres then square feet. */
export function areaParts(mm2: number): [string, string] {
  return [`${grouped(squareMetresOf(mm2))} m²`, `${grouped(squareFeetOf(mm2))} ft²`];
}

export function areaText(mm2: number): string {
  const [metric, imperial] = areaParts(mm2);
  return `${metric} (${imperial})`;
}

export function poundsText(pence: number): string {
  return grouped(poundsOf(pence));
}

/** Pounds typed with up to two decimals, as whole pence; null when it is not a positive amount. */
export function penceOfPounds(text: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const pence = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(pence) && pence > 0 ? pence : null;
}

const MIN_LENGTH_MM = 1;
export const MAX_LENGTH_MM = 60000;

/** What an owner typed into the inch field, and the millimetres it stands for. */
type InchReading = { mm: number; decimal: boolean } | null;

const DECIMAL_INCHES = /^(\d+)(?:\.(\d{1,2}))?$/;
const FEET_AND_INCHES = /^(0|[1-9]\d{0,2})['’] (0|[1-9]\d?)(?: ([1-9]\d?)\/(\d+))?["”]$/;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function readInches(text: string): InchReading {
  const decimal = DECIMAL_INCHES.exec(text);
  if (decimal) {
    const hundredthsOfInch = Number(decimal[1]) * 100 + Number((decimal[2] ?? "").padEnd(2, "0"));
    if (!Number.isSafeInteger(hundredthsOfInch) || hundredthsOfInch <= 0) return null;
    return { mm: roundDiv(hundredthsOfInch * MM_PER_INCH_TENTHS, 1000), decimal: true };
  }
  const feet = FEET_AND_INCHES.exec(text);
  if (!feet) return null;
  const foot = Number(feet[1]);
  const inch = Number(feet[2]);
  if (foot > 196 || inch > 11) return null;
  let sixteenths = (foot * 12 + inch) * 16;
  if (feet[3] !== undefined) {
    const numerator = Number(feet[3]);
    const denominator = Number(feet[4]);
    if (![2, 4, 8, 16].includes(denominator) || numerator >= denominator || gcd(numerator, denominator) !== 1) return null;
    sixteenths += numerator * (16 / denominator);
  }
  if (sixteenths <= 0) return null;
  return { mm: roundDiv(sixteenths * 127, 80), decimal: false };
}

export function inLengthRange(mm: number): boolean {
  return Number.isInteger(mm) && mm >= MIN_LENGTH_MM && mm <= MAX_LENGTH_MM;
}

/** The unit-slip guard: a millimetre figure that, read as inches, lands within the tolerance of the current value. */
export function looksLikeInches(valueMm: number, currentMm: number, toleranceMm: number): boolean {
  return Math.abs(roundDiv(valueMm * MM_PER_INCH_TENTHS, 10) - currentMm) <= toleranceMm;
}

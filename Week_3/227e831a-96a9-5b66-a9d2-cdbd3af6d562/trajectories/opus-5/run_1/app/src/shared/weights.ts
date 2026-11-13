/**
 * Every gram value in Skinout is a whole number. Entered decimals are converted
 * here, exactly from the decimal as written, and rounded half-up once.
 */

export type DisplayUnit = 'g' | 'oz' | 'lb';
export type EntryUnit = 'g' | 'oz' | 'kg' | 'lb';

const GRAMS_PER_UNIT: Record<EntryUnit, { numerator: bigint; denominator: bigint }> = {
  g: { numerator: 1n, denominator: 1n },
  oz: { numerator: 28349523125n, denominator: 1000000000n },
  kg: { numerator: 1000n, denominator: 1n },
  lb: { numerator: 45359237n, denominator: 100000n },
};

const DECIMAL = /^\d+(\.\d+)?$/;

/** Rounds a non-negative fraction half-up to a whole number. */
function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

export function isDecimalText(text: string): boolean {
  return DECIMAL.test(text);
}

/** Splits a decimal literal into its value over a power of ten. */
function decimalToFraction(text: string): { numerator: bigint; denominator: bigint } {
  const point = text.indexOf('.');
  if (point === -1) return { numerator: BigInt(text), denominator: 1n };
  const digits = text.slice(0, point) + text.slice(point + 1);
  return { numerator: BigInt(digits), denominator: 10n ** BigInt(text.length - point - 1) };
}

/**
 * Converts a decimal written as text to whole grams, exactly and once.
 * Returns null when the text is not a plain unsigned decimal.
 */
export function toGrams(text: string, unit: EntryUnit): number | null {
  if (!isDecimalText(text)) return null;
  const value = decimalToFraction(text);
  const factor = GRAMS_PER_UNIT[unit];
  return Number(
    roundHalfUp(value.numerator * factor.numerator, value.denominator * factor.denominator),
  );
}

/** Grams as tenths of an ounce, rounded half-up once. */
function gramsToOunceTenths(grams: number): bigint {
  const factor = GRAMS_PER_UNIT.oz;
  return roundHalfUp(BigInt(grams) * 10n * factor.denominator, factor.numerator);
}

function tenths(value: bigint): string {
  return `${value / 10n}.${value % 10n}`;
}

/** The one display rule: every weight on every surface is written here. */
export function formatGrams(grams: number, unit: DisplayUnit): string {
  const whole = Math.round(grams);
  if (unit === 'g') return `${whole} g`;
  const ounceTenths = gramsToOunceTenths(whole);
  if (unit === 'oz') return `${tenths(ounceTenths)} oz`;
  const pounds = ounceTenths / 160n;
  const remainder = ounceTenths % 160n;
  return `${pounds} lb ${tenths(remainder)} oz`;
}

/** The goal delta text: the gram difference first, converted once. */
export function formatGoalDelta(baseGrams: number, goalGrams: number, unit: DisplayUnit): string {
  if (baseGrams > goalGrams) return `${formatGrams(baseGrams - goalGrams, unit)} over goal`;
  return `${formatGrams(goalGrams - baseGrams, unit)} under goal`;
}

export function isOverGoal(baseGrams: number, goalGrams: number): boolean {
  return baseGrams > goalGrams;
}

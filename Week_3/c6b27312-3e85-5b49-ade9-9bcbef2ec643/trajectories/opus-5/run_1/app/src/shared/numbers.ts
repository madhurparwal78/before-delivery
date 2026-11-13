/**
 * House rule H1 (number grammar) and H2 (rendering and rounding).
 * Every rounding and every displayed number in Tinework goes through this module.
 */

export const MINUS = '\u2212';
export const THIN_SPACE = '\u2009';
export const NNBSP = '\u202f';

/** H1: the only accepted shape of a number entering Tinework. */
export const NUMBER_GRAMMAR = /^-?(0|[1-9][0-9]*)(\.[0-9]{1,3})?$/;

export function matchesNumberGrammar(raw: string): boolean {
  return NUMBER_GRAMMAR.test(raw);
}

/** Decomposes a finite double into an exact mantissa × 2^exponent pair. */
function exactParts(x: number): { neg: boolean; mantissa: bigint; exponent: number } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const neg = (hi & 0x80000000) !== 0;
  const biased = (hi >>> 20) & 0x7ff;
  const high = BigInt(hi & 0x000fffff);
  const mantissaBits = (high << 32n) | BigInt(lo);
  if (biased === 0) {
    return { neg, mantissa: mantissaBits, exponent: -1074 };
  }
  return { neg, mantissa: mantissaBits | (1n << 52n), exponent: biased - 1075 };
}

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/**
 * H2: rounds |x| × 10^decimals half to even on the exact binary value of x,
 * returning the scaled magnitude as an integer.
 */
function scaledHalfEven(x: number, decimals: number): { neg: boolean; scaled: bigint } {
  const { neg, mantissa, exponent } = exactParts(x);
  let numerator = mantissa * pow10(decimals);
  let denominator = 1n;
  if (exponent >= 0) {
    numerator <<= BigInt(exponent);
  } else {
    denominator = 1n << BigInt(-exponent);
  }
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const twice = remainder * 2n;
  if (twice > denominator || (twice === denominator && quotient % 2n === 1n)) {
    quotient += 1n;
  }
  return { neg, scaled: quotient };
}

/** The digits of x rounded half to even to `decimals` places, as a plain ASCII string. */
export function fixedAscii(x: number, decimals: number): string {
  if (!Number.isFinite(x)) return String(x);
  const { neg, scaled } = scaledHalfEven(x, decimals);
  const digits = scaled.toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const frac = decimals > 0 ? digits.slice(digits.length - decimals) : '';
  const sign = neg && scaled !== 0n ? '-' : '';
  return decimals > 0 ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
}

/** H2: the numeric value of x rounded half to even to `decimals` places. */
export function roundTo(x: number, decimals: number): number {
  if (!Number.isFinite(x)) return x;
  const value = Number(fixedAscii(x, decimals));
  return value === 0 ? 0 : value;
}

/** Machine form: plain ASCII, no separators, `-0` written `0`. */
export function machineNumber(x: number): string {
  if (Object.is(x, -0)) return '0';
  return String(x);
}

function group(whole: string): string {
  const digits = whole.startsWith('-') ? whole.slice(1) : whole;
  const sign = whole.startsWith('-') ? '-' : '';
  if (digits.length < 4) return whole;
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    const fromEnd = digits.length - i;
    if (i > 0 && fromEnd % 3 === 0) out += THIN_SPACE;
    out += digits[i];
  }
  return sign + out;
}

function displaySign(ascii: string): string {
  return ascii.startsWith('-') ? MINUS + ascii.slice(1) : ascii;
}

/** H2 displayed number: exactly `decimals` decimals, grouped, with U+2212 for minus. */
export function display(x: number, decimals: number): string {
  const ascii = fixedAscii(x, decimals);
  const dot = ascii.indexOf('.');
  const whole = dot === -1 ? ascii : ascii.slice(0, dot);
  const frac = dot === -1 ? '' : ascii.slice(dot);
  return displaySign(group(whole)) + frac;
}

/** H2 displayed number: at most `decimals` decimals, trailing zeros dropped. */
export function displayAtMost(x: number, decimals: number): string {
  const ascii = fixedAscii(x, decimals);
  let trimmed = ascii;
  if (trimmed.includes('.')) {
    trimmed = trimmed.replace(/0+$/, '').replace(/\.$/, '');
  }
  const dot = trimmed.indexOf('.');
  const whole = dot === -1 ? trimmed : trimmed.slice(0, dot);
  const frac = dot === -1 ? '' : trimmed.slice(dot);
  return displaySign(group(whole)) + frac;
}

/** H2: a number followed by U+202F and its measurement unit. */
export function withUnit(text: string, unit: string): string {
  return `${text}${NNBSP}${unit}`;
}

/** A volume in mm³ with exactly two decimals. */
export function volumeMm3(volume: number): string {
  return withUnit(display(volume, 2), 'mm³');
}

/** A bounding box written `<x> × <y> × <z> mm`, each at most 2 decimals. */
export function bboxText(bbox: readonly [number, number, number] | readonly number[]): string {
  const [x, y, z] = bbox;
  return `${displayAtMost(x, 2)} × ${displayAtMost(y, 2)} × ${withUnit(displayAtMost(z, 2), 'mm')}`;
}

/** H2: one significant figure, half to even, for cost band ends. */
export function oneSignificantFigure(x: number): number {
  if (x === 0) return 0;
  const magnitude = Math.floor(Math.log10(Math.abs(x)));
  const decimals = -magnitude;
  if (decimals >= 0) return roundTo(x, decimals);
  const factor = 10 ** -decimals;
  return roundTo(x / factor, 0) * factor;
}

/** Money: `$` directly followed by the figure, at most 2 decimals. */
export function money(x: number): string {
  return `$${displayAtMost(x, 2)}`;
}

/** H2: significant-figure rendering for the dimension leader figure. */
export function significantFigures(x: number, figures: number): string {
  if (x === 0) return '0';
  const magnitude = Math.floor(Math.log10(Math.abs(x)));
  const decimals = Math.max(0, figures - 1 - magnitude);
  return displayAtMost(x, decimals);
}

/** H1: values the page computes keep at most 3 decimals so they pass the grammar again. */
export function clampToGrammar(x: number): number {
  return roundTo(x, 3);
}

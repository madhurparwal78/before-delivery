// House rules H1 (number grammar) and H2 (rounding and displayed numbers): the single place both are decided.

export const NNBSP = " ";
const THIN = " ";
export const MINUS = "−";

const GRAMMAR = /^-?(0|[1-9][0-9]*)(\.[0-9]{1,3})?$/;

/** The value of a plain decimal, or null when the text is outside the number grammar. -0 is 0. */
export function parseDecimal(text: string): number | null {
  if (!GRAMMAR.test(text)) return null;
  const n = Number(text);
  return n === 0 ? 0 : n;
}

export function isGrammatical(text: string): boolean {
  return GRAMMAR.test(text);
}

/** |x| as mant * 2^exp, exactly. */
function decompose(x: number): { negative: boolean; mant: bigint; exp: number } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const biased = (hi >>> 20) & 0x7ff;
  const fraction = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  return biased === 0
    ? { negative: hi >>> 31 === 1, mant: fraction, exp: -1074 }
    : { negative: hi >>> 31 === 1, mant: fraction | (1n << 52n), exp: biased - 1075 };
}

/** |x| × 10^places rounded half to even on the exact binary value. */
function scaledHalfEven(x: number, places: number): bigint {
  const { mant, exp } = decompose(x);
  const numerator = mant * 10n ** BigInt(places);
  if (exp >= 0) return numerator << BigInt(exp);
  const shift = BigInt(-exp);
  let quotient = numerator >> shift;
  const twice = (numerator - (quotient << shift)) << 1n;
  const half = 1n << shift;
  if (twice > half || (twice === half && (quotient & 1n) === 1n)) quotient += 1n;
  return quotient;
}

/** x with exactly `places` decimals, half to even, ASCII minus (no "-0"). */
export function fixed(x: number, places: number): string {
  const units = scaledHalfEven(x, places);
  const digits = units.toString().padStart(places + 1, "0");
  const whole = digits.slice(0, digits.length - places);
  const text = places > 0 ? `${whole}.${digits.slice(digits.length - places)}` : whole;
  return units !== 0n && x < 0 ? `-${text}` : text;
}

/** x rounded half to even to `places` decimals, as a number (never -0). */
export function roundHalfEven(x: number, places: number): number {
  const n = Number(fixed(x, places));
  return n === 0 ? 0 : n;
}

function group(whole: string): string {
  let out = "";
  for (let i = 0; i < whole.length; i++) {
    if (i > 0 && (whole.length - i) % 3 === 0) out += THIN;
    out += whole[i];
  }
  return whole.length >= 4 ? out : whole;
}

/** A displayed number: U+2212 minus, U+2009 between thousands, exactly `places` decimals. */
export function display(x: number, places: number): string {
  const text = fixed(x, places);
  const negative = text.startsWith("-");
  const [whole, fraction] = (negative ? text.slice(1) : text).split(".");
  return `${negative ? MINUS : ""}${group(whole ?? "0")}${fraction === undefined ? "" : `.${fraction}`}`;
}

/** A number inside a message: at most `max` decimals, trailing zeros dropped. */
export function trimmed(x: number, max = 2): string {
  const text = fixed(x, max);
  const cut = text.includes(".") ? text.replace(/\.?0+$/, "") : text;
  return display(Number(cut), cut.includes(".") ? cut.length - cut.indexOf(".") - 1 : 0);
}

function withUnit(figure: string, unit: string): string {
  return `${figure}${NNBSP}${unit}`;
}

/** A volume in mm³: always exactly 2 decimals. */
export function volumeText(volume: number): string {
  return withUnit(display(volume, 2), "mm³");
}

/** `a × b × c mm`: each dimension at most 2 decimals; only the last number takes the unit. */
export function bboxText(bbox: readonly [number, number, number] | readonly number[]): string {
  const [x = 0, y = 0, z = 0] = bbox;
  return `${trimmed(x)} × ${trimmed(y)} × ${withUnit(trimmed(z), "mm")}`;
}

/** x to `figures` significant figures, half to even, trailing zeros dropped. */
export function significant(x: number, figures: number): string {
  if (x === 0) return "0";
  const places = figures - 1 - Math.floor(Math.log10(Math.abs(x)));
  if (places < 0) {
    const scale = 10 ** -places;
    return String(roundHalfEven(x / scale, 0) * scale);
  }
  const text = fixed(x, places);
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

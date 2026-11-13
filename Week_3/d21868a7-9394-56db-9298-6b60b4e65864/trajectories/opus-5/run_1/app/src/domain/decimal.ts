/**
 * Exact decimal arithmetic for ML and ML/day quantities.
 * A quantity is held as a bigint count of thousandths, so no binary floating
 * point ever touches a volume, a cap or a rate.
 */
export type Ml = bigint;

export const ZERO: Ml = 0n;
const SCALE = 1000n;

/** floor(num / den) for a positive denominator. */
export function divFloor(num: bigint, den: bigint): bigint {
  const q = num / den;
  return num % den !== 0n && num < 0n ? q - 1n : q;
}

/** num / den rounded to the nearest integer, halves rounded up. */
function divRound(num: bigint, den: bigint): bigint {
  return divFloor(2n * num + den, 2n * den);
}

/** Rounds a rational count of thousandths to a whole thousandth, halves up. */
export function roundMl(num: bigint, den: bigint): Ml {
  return divRound(num, den);
}

export function fromWhole(value: number): Ml {
  return BigInt(value) * SCALE;
}

/** Parses an ML value from an API request: a decimal string or a JSON number. */
export function parseMl(input: unknown): Ml | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return parseMlText(formatNumber(input));
  }
  if (typeof input === 'string') return parseMlText(input.trim());
  return null;
}

function formatNumber(value: number): string {
  // A JSON number is only accepted with at most three decimals, so a plain
  // decimal rendering is exact for every accepted input.
  const text = String(value);
  return text.includes('e') || text.includes('E') ? value.toFixed(10) : text;
}

function parseMlText(text: string): Ml | null {
  const match = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(text);
  if (!match) return null;
  const [, sign, whole, fraction = ''] = match;
  const thousandths = BigInt(whole as string) * SCALE + BigInt((fraction + '000').slice(0, 3));
  return sign === '-' ? -thousandths : thousandths;
}

/** Renders a quantity the one way the API and every screen show it. */
export function formatMl(value: Ml): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / SCALE;
  const fraction = (abs % SCALE).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

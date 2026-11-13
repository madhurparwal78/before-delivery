// Exact decimal arithmetic on integers. A decimal value is scaled to `scale`
// digits (cents: 2, per-share prices: 4). Never binary floating point.

export interface Decimal {
  scale: number;
  unscaled: bigint; // value = unscaled / 10^scale, may be negative
}

export function makeDecimal(unscaled: bigint, scale: number): Decimal {
  return { unscaled, scale };
}

export function fromString(text: string, scale: number): Decimal | null {
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  if (frac.length > scale) return null;
  const padded = frac.padEnd(scale, '0');
  return { unscaled: BigInt(whole + padded), scale };
}

export function decimalToString(d: Decimal): string {
  const sign = d.unscaled < 0n ? '-' : '';
  const abs = d.unscaled < 0n ? -d.unscaled : d.unscaled;
  if (d.scale === 0) return sign + abs.toString();
  const divisor = 10n ** BigInt(d.scale);
  const whole = abs / divisor;
  const frac = (abs % divisor).toString().padStart(d.scale, '0');
  return `${sign}${whole}.${frac}`;
}

export function rescale(d: Decimal, scale: number): Decimal {
  if (scale === d.scale) return d;
  if (scale > d.scale) {
    return { unscaled: d.unscaled * 10n ** BigInt(scale - d.scale), scale };
  }
  return { unscaled: d.unscaled / 10n ** BigInt(d.scale - scale), scale };
}

export function mulScaled(a: Decimal, b: Decimal): bigint {
  // exact product as an integer scaled to a.scale + b.scale
  return a.unscaled * b.unscaled;
}

// Divide exact rational (numerator/denominator, both bigint) at `scale` digits,
// rounding half-up away from zero. denominator must be positive.
export function divRoundHalfUp(numerator: bigint, denominator: bigint, scale: number): Decimal {
  const factor = 10n ** BigInt(scale);
  const neg = numerator < 0n;
  const num = neg ? -numerator : numerator;
  const scaled = num * factor;
  const q = scaled / denominator;
  const r = scaled % denominator;
  const round = 2n * r >= denominator ? q + 1n : q;
  return { unscaled: neg ? -round : round, scale };
}

// Divide exact rational, rounding down (toward zero for positive inputs).
export function divRoundDown(numerator: bigint, denominator: bigint, scale: number): Decimal {
  const factor = 10n ** BigInt(scale);
  const neg = numerator < 0n;
  const num = neg ? -numerator : numerator;
  const q = (num * factor) / denominator;
  return { unscaled: neg ? -q : q, scale };
}

// Multiply two decimals, half-up at the target scale.
export function mulHalfUp(a: Decimal, b: Decimal, scale: number): Decimal {
  return divRoundHalfUp(mulScaled(a, b), 10n ** BigInt(a.scale + b.scale), scale);
}

export function toCents(d: Decimal): bigint {
  const r = rescale(d, 2);
  return r.unscaled;
}

export function divCeil(numerator: bigint, denominator: bigint): bigint {
  const neg = numerator < 0n;
  const num = neg ? -numerator : numerator;
  const q = num / denominator;
  const r = num % denominator;
  const v = r === 0n ? q : q + 1n;
  return neg ? -v : v;
}

export function sumDecimals(values: Decimal[]): Decimal {
  if (values.length === 0) return { unscaled: 0n, scale: 2 };
  const scale = Math.max(...values.map((v) => v.scale));
  let acc = 0n;
  for (const v of values) acc += rescale(v, scale).unscaled;
  return { unscaled: acc, scale };
}

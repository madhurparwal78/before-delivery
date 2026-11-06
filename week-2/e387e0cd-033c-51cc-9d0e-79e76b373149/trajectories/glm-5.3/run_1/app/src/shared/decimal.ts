// Exact decimal arithmetic for money and crypto amounts. Never uses binary
// floating point. Amounts are scaled integers (BigInt) with a scale.
export type Decimal = { sign: 1 | -1; digits: bigint; scale: number };

export function newDecimal(sign: 1 | -1, digits: bigint, scale: number): Decimal {
  return { sign, digits, scale };
}

export function parseDecimal(text: string): Decimal | null {
  if (typeof text !== 'string' || text.length === 0) return null;
  let rest = text;
  let sign: 1 | -1 = 1;
  if (rest[0] === '+' || rest[0] === '-') {
    if (rest[0] === '-') sign = -1;
    rest = rest.slice(1);
  }
  let intPart = rest;
  let fracPart = '';
  const dot = rest.indexOf('.');
  if (dot >= 0) {
    intPart = rest.slice(0, dot);
    fracPart = rest.slice(dot + 1);
    if (fracPart.includes('.')) return null;
  }
  if (intPart.length === 0 && fracPart.length === 0) return null;
  if (intPart.length > 0 && !/^\d+$/.test(intPart)) return null;
  if (fracPart.length > 0 && !/^\d+$/.test(fracPart)) return null;
  const digits = BigInt((intPart || '0') + fracPart);
  if (digits === 0n) sign = 1;
  return { sign, digits, scale: fracPart.length };
}

export function formatDecimal(d: Decimal): string {
  const s = d.digits.toString();
  if (d.scale === 0) return (d.sign < 0n ? '-' : '') + s;
  let str: string;
  if (s.length <= d.scale) {
    str = '0'.repeat(d.scale - s.length + 1) + s;
  } else {
    str = s;
  }
  const intPart = str.slice(0, str.length - d.scale);
  const fracPart = str.slice(str.length - d.scale);
  return (d.sign < 0 && d.digits !== 0n ? '-' : '') + intPart + '.' + fracPart;
}

/** Rescale to a smaller scale, rounding half up. */
export function rescaleHalfUp(d: Decimal, scale: number): Decimal {
  if (scale === d.scale) return d;
  if (scale < d.scale) {
    const drop = d.scale - scale;
    const divisor = 10n ** BigInt(drop);
    const rem = d.digits % divisor;
    const q = d.digits / divisor;
    const half = divisor / 2n;
    const rounded = rem >= half ? q + 1n : q;
    const sign: 1 | -1 = rounded === 0n ? 1 : d.sign;
    return { sign, digits: rounded, scale };
  }
  return { sign: d.sign, digits: d.digits * 10n ** BigInt(scale - d.scale), scale };
}

export function mulDecimals(a: Decimal, b: Decimal): Decimal {
  return { sign: a.sign === b.sign ? 1 : -1, digits: a.digits * b.digits, scale: a.scale + b.scale };
}

export function eqZero(d: Decimal): boolean {
  return d.digits === 0n;
}

export function isGreaterThanZero(d: Decimal): boolean {
  return d.sign > 0 && d.digits !== 0n;
}

/** Compare magnitude ignoring sign: returns positive if a > b after aligning scales. */
export function absCompare(a: Decimal, b: Decimal): number {
  const scale = Math.max(a.scale, b.scale);
  const av = scaleUp(a, scale);
  const bv = scaleUp(b, scale);
  const sa = a.sign < 0 && a.digits !== 0n ? -1n : 1n;
  const sb = b.sign < 0 && b.digits !== 0n ? -1n : 1n;
  const x = av * sa;
  const y = bv * sb;
  return x === y ? 0 : x > y ? 1 : -1;
}

export function scaleUp(d: Decimal, scale: number): bigint {
  return scale >= d.scale ? d.digits * 10n ** BigInt(scale - d.scale) : d.digits / 10n ** BigInt(d.scale - scale);
}

/** The product of an amount (in the asset's decimals) and a rate in cents per
 * whole unit is itself in cents with the asset's scale; a whole cent is the
 * product rounded half up to scale 0. */
export function toCentsHalfUp(d: Decimal): bigint {
  const r = rescaleHalfUp(d, 0);
  const v = r.digits;
  return r.sign < 0 ? -v : v;
}

export function centsToDecimal(cents: bigint): Decimal {
  return { sign: cents < 0n ? -1 : 1, digits: cents < 0n ? -cents : cents, scale: 2 };
}

export function centsToUnitCentsDecimal(cents: bigint): Decimal {
  return { sign: cents < 0n ? -1 : 1, digits: cents < 0n ? -cents : cents, scale: 0 };
}

export function multiplyCents(amount: Decimal, rateCents: bigint): Decimal {
  return mulDecimals(amount, { sign: 1, digits: rateCents, scale: 0 });
}

export function bigIntToDecimal(n: bigint, scale: number): Decimal {
  return { sign: n < 0n ? -1 : 1, digits: n < 0n ? -n : n, scale };
}

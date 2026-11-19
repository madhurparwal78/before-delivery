// Exact decimal arithmetic with BigInt. No published figure ever passes through a float.
// A Decimal is a plain string over optional minus, digits and at most one dot.

export type Decimal = string;

export interface Scaled {
  d: bigint; // scaled integer (may be negative)
  s: number; // scale: value = d * 10^-s
}

const DEC_RE = /^-?(?:[0-9]+)(?:\.[0-9]+)?$/;

export function parse(a: Decimal): Scaled {
  if (!DEC_RE.test(a)) throw new Error(`bad decimal: ${a}`);
  let body = a;
  let neg = false;
  if (body.startsWith("-")) {
    neg = true;
    body = body.slice(1);
  }
  const dot = body.indexOf(".");
  const int = dot === -1 ? body : body.slice(0, dot);
  const frac = dot === -1 ? "" : body.slice(dot + 1);
  const d = BigInt(`${int}${frac}`) * (neg ? -1n : 1n);
  return { d, s: frac.length };
}

export function toStr(v: Scaled): Decimal {
  const neg = v.d < 0n;
  const mag = neg ? -v.d : v.d;
  const str = mag.toString();
  if (v.s === 0) return neg ? `-${str}` : str;
  const padded = str.padStart(v.s + 1, "0");
  const int = padded.slice(0, padded.length - v.s);
  const frac = padded.slice(padded.length - v.s);
  const trimmed = frac.replace(/0+$/, "");
  const body = trimmed.length === 0 ? int : `${int}.${trimmed}`;
  if (body === "0") return "0";
  return neg ? `-${body}` : body;
}

export function isDecimal(a: string): boolean {
  return DEC_RE.test(a);
}

function align(a: Scaled, b: Scaled): { ad: bigint; bd: bigint; s: number } {
  const s = Math.max(a.s, b.s);
  return {
    ad: a.d * 10n ** BigInt(s - a.s),
    bd: b.d * 10n ** BigInt(s - b.s),
    s,
  };
}

export function add(a: Decimal, b: Decimal): Decimal {
  const { ad, bd, s } = align(parse(a), parse(b));
  return toStr({ d: ad + bd, s });
}

export function sub(a: Decimal, b: Decimal): Decimal {
  return add(a, b.startsWith("-") ? b.slice(1) : `-${b}`);
}

export function mul(a: Decimal, b: Decimal): Decimal {
  const A = parse(a);
  const B = parse(b);
  return toStr({ d: A.d * B.d, s: A.s + B.s });
}

export function negate(a: Decimal): Decimal {
  return a.startsWith("-") ? a.slice(1) : a === "0" ? "0" : `-${a}`;
}

export function abs(a: Decimal): Decimal {
  return a.startsWith("-") ? a.slice(1) : a;
}

export function isZero(a: Decimal): boolean {
  return parse(a).d === 0n;
}

export function cmp(a: Decimal, b: Decimal): number {
  const { ad, bd } = align(parse(a), parse(b));
  if (ad === bd) return 0;
  return ad < bd ? -1 : 1;
}

/** Round half up (on the magnitude) to `scaleOut` fractional digits. Exact. */
export function roundHalfUp(a: Decimal, scaleOut: number): Decimal {
  const A = parse(a);
  if (A.s <= scaleOut) return toStr(A);
  const drop = A.s - scaleOut;
  const divisor = 10n ** BigInt(drop);
  const neg = A.d < 0n;
  const mag = neg ? -A.d : A.d;
  const q = mag / divisor;
  const r = mag % divisor;
  const bumped = r * 2n >= divisor ? q + 1n : q;
  return toStr({ d: neg ? -bumped : bumped, s: scaleOut });
}

/** Divide a/b rounded half-up (on the magnitude) to `outScale` fractional digits. Exact. */
export function divRound(a: Decimal, b: Decimal, outScale: number): Decimal {
  const A = parse(a);
  const B = parse(b);
  if (B.d === 0n) throw new Error("divide by zero");
  const numPow = outScale + B.s - A.s;
  let num = A.d;
  let den = B.d;
  if (numPow >= 0) num = num * 10n ** BigInt(numPow);
  else den = den * 10n ** BigInt(-numPow);
  const neg = num < 0n !== den < 0n;
  const n = num < 0n ? -num : num;
  const d = den < 0n ? -den : den;
  const q = n / d;
  const r = n % d;
  const bumped = r * 2n >= d ? q + 1n : q;
  return toStr({ d: neg ? -bumped : bumped, s: outScale });
}

export function sum(values: readonly Decimal[]): Decimal {
  let acc = "0";
  for (const v of values) acc = add(acc, v);
  return acc;
}

/** Half-up share of a part in a total, in percent with one decimal, as a decimal string. */
export function percentOf(part: Decimal, total: Decimal): Decimal {
  if (isZero(total)) return "0.0";
  const p = divRound(mul(part, "100"), total, 2);
  return roundHalfUp(p, 1);
}

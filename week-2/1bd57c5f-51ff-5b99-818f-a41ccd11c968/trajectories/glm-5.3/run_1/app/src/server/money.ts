/** Exact decimal string money handling: no binary floating-point is used for
 *  any money or quantity value. All arithmetic runs on scaled BigInt integers. */

export type Decimal = { int: bigint; scale: number };

export function parseDecimal(s: string): Decimal | null {
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (m === null) return null;
  const frac = m[2] ?? "";
  return { int: BigInt(m[1] + frac), scale: frac.length };
}

export function rescale(d: Decimal, scale: number): Decimal {
  if (d.scale === scale) return d;
  if (scale > d.scale) return { int: d.int * 10n ** BigInt(scale - d.scale), scale };
  // truncation toward zero; callers use div for rounding
  return { int: d.int / 10n ** BigInt(d.scale - scale), scale };
}

export function add(a: Decimal, b: Decimal): Decimal {
  const s = Math.max(a.scale, b.scale);
  return { int: rescale(a, s).int + rescale(b, s).int, scale: s };
}

export function negate(a: Decimal): Decimal {
  return { int: -a.int, scale: a.scale };
}

export function isZero(a: Decimal): boolean {
  return a.int === 0n;
}

export function isNegative(a: Decimal): boolean {
  return a.int < 0n;
}

export function mul(a: Decimal, b: Decimal): Decimal {
  return { int: a.int * b.int, scale: a.scale + b.scale };
}

/** Divides by a power of ten with banker's rounding (half to even). */
export function divPowTo(a: Decimal, pow: number): Decimal {
  const divisor = 10n ** BigInt(pow);
  const neg = a.int < 0n;
  const v = neg ? -a.int : a.int;
  const q = v / divisor;
  const r = v % divisor;
  const half = divisor / 2n;
  let out = q;
  if (r > half || (r === half && q % 2n === 1n)) out = q + 1n;
  return { int: neg ? -out : out, scale: a.scale - pow };
}

/** Rounds to the given decimal scale, half to even, and formats with that scale. */
export function roundTo(d: Decimal, scale: number): Decimal {
  const pow = d.scale - scale;
  if (pow <= 0) return rescale(d, scale);
  return divPowTo(d, pow);
}

export function fmt(a: Decimal): string {
  const neg = a.int < 0n;
  let s = (neg ? -a.int : a.int).toString().padStart(a.scale + 1, "0");
  const head = a.scale === 0 ? s : s.slice(0, s.length - a.scale);
  const frac = a.scale === 0 ? "" : s.slice(s.length - a.scale);
  return (neg ? "-" : "") + (a.scale === 0 ? head : `${head}.${frac}`);
}

export function fmtFixed(d: Decimal, scale: number): string {
  return fmt(roundTo(d, scale));
}

export function parseQuantity(s: string): Decimal | null {
  const d = parseDecimal(s);
  if (d === null) return null;
  if (d.scale > 3) return null;
  const scaled = rescale(d, 3);
  if (scaled.int === 0n) return null;
  if (scaled.int > 9999999n) return null;
  return scaled;
}

export function parseUnitCost(s: string): Decimal | null {
  const d = parseDecimal(s);
  if (d === null) return null;
  if (d.scale > 2) return null;
  const scaled = rescale(d, 2);
  if (scaled.int > 9999999n) return null;
  return scaled;
}

export function formatQuantity(d: Decimal): string {
  return fmt(rescale(d, 3));
}

export function formatUnitCost(d: Decimal): string {
  return fmt(rescale(d, 2));
}

/** line_total = quantity × unit_cost rounded half to even to cents, 0.00 when either is null. */
export function lineTotal(quantity: Decimal | null, unitCost: Decimal | null): Decimal {
  if (quantity === null || unitCost === null) return { int: 0n, scale: 2 };
  return roundTo(mul(quantity, unitCost), 2);
}

/** (items + change orders) × percent ÷ 100, half to even, 0.00 when the base is below zero. */
export function contingencyAmount(base: Decimal, percent: Decimal): Decimal {
  if (isNegative(base)) return { int: 0n, scale: 2 };
  const hundredth: Decimal = { int: percent.int, scale: percent.scale + 2 };
  return roundTo(mul(base, hundredth), 2);
}

/** Money with a thousands comma: $1,234.50, minus before the dollar sign. */
export function money(d: Decimal): string {
  const neg = d.int < 0n;
  const s = fmt(roundTo(d, 2));
  const m = /^-?(\d+)(?:\.(\d{2}))?$/.exec(s);
  if (m === null) return `$0.00`;
  let dollars = m[1] ?? "0";
  const cents = m[2] ?? "00";
  const withCommas = dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${withCommas}.${cents}`;
}

export function parseAmountField(s: string): { value: Decimal; display: string } | null {
  const d = parseDecimal(s);
  if (d === null || d.int === 0n) return null;
  if (d.scale > 2) return null;
  const scaled = rescale(d, 2);
  if (scaled.int > 9999999n) return null;
  return { value: scaled, display: fmt(scaled) };
}

export const ZERO_CENTS: Decimal = { int: 0n, scale: 2 };
export const ZERO_PERCENT: Decimal = { int: 0n, scale: 2 };

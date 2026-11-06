// Money and quantities as exact decimals. Values travel as decimal strings and are
// computed as BigInt counts of their smallest unit; binary floats never touch money.

type Parsed<T> = { ok: true; value: T } | { ok: false };

/** A decimal string as a BigInt count of 10^-scale units. */
function toScaled(text: string, scale: number): bigint {
  const negative = text.startsWith("-");
  const [whole = "0", frac = ""] = (negative ? text.slice(1) : text).split(".");
  const value = BigInt(whole + frac.padEnd(scale, "0"));
  return negative ? -value : value;
}

function fromScaled(value: bigint, scale: number): string {
  const digits = (value < 0n ? -value : value).toString().padStart(scale + 1, "0");
  const sign = value < 0n ? "-" : "";
  return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

/** Rounds n/d to an integer, halves to even (d > 0). */
function divHalfEven(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  const twice = 2n * (r < 0n ? -r : r);
  if (twice < d || (twice === d && q % 2n === 0n)) return q;
  return n < 0n ? q - 1n : q + 1n;
}

function parseDecimal(raw: unknown, pattern: RegExp, scale: number, min: bigint, max: bigint): Parsed<string> {
  if (typeof raw !== "string" || !pattern.test(raw)) return { ok: false };
  const value = toScaled(raw, scale);
  return value >= min && value <= max ? { ok: true, value: fromScaled(value, scale) } : { ok: false };
}

/** A quantity: null, or a string from 0.001 to 9999.999 with up to three decimals; canonical three decimals. */
export function parseQuantity(raw: unknown): Parsed<string | null> {
  return raw === null ? { ok: true, value: null } : parseDecimal(raw, /^\d+(\.\d{1,3})?$/, 3, 1n, 9_999_999n);
}

/** A unit cost: null, or a string from 0.00 to 99999.99 with up to two decimals; canonical two decimals. */
export function parseUnitCost(raw: unknown): Parsed<string | null> {
  return raw === null ? { ok: true, value: null } : parseDecimal(raw, /^\d+(\.\d{1,2})?$/, 2, 0n, 9_999_999n);
}

/** A contingency percent: a string from 0.00 to 25.00 with up to two decimals. */
export function parsePercent(raw: unknown): Parsed<string> {
  return parseDecimal(raw, /^\d+(\.\d{1,2})?$/, 2, 0n, 2_500n);
}

/** A change-order amount: a non-zero string from -99999.99 to 99999.99 with up to two decimals. */
export function parseAmount(raw: unknown): Parsed<string> {
  const parsed = parseDecimal(raw, /^-?\d+(\.\d{1,2})?$/, 2, -9_999_999n, 9_999_999n);
  return parsed.ok && toScaled(parsed.value, 2) === 0n ? { ok: false } : parsed;
}

/** Quantity times unit cost, exact, rounded half to even to cents; 0.00 when either is null. */
export function lineTotal(quantity: string | null, unitCost: string | null): string {
  if (quantity === null || unitCost === null) return "0.00";
  return fromScaled(divHalfEven(toScaled(quantity, 3) * toScaled(unitCost, 2), 1000n), 2);
}

/** The exact sum of two-decimal amounts. */
export function sumMoney(values: readonly string[]): string {
  return fromScaled(values.reduce((sum, v) => sum + toScaled(v, 2), 0n), 2);
}

/** base × percent ÷ 100, rounded half to even to cents; 0.00 when the base is below zero. */
export function contingencyOf(base: string, percent: string): string {
  const cents = toScaled(base, 2);
  if (cents < 0n) return "0.00";
  return fromScaled(divHalfEven(cents * toScaled(percent, 2), 10_000n), 2);
}

/** A two-decimal amount for display: "$1,234.50", "-$12.00". */
export function formatDollars(amount: string): string {
  const negative = amount.startsWith("-");
  const [whole = "0", frac = "00"] = (negative ? amount.slice(1) : amount).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${grouped}.${frac.padEnd(2, "0")}`;
}

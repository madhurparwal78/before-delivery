import { FARES, type Fare } from "../shared/domain.ts";

/** Tax-exclusive admission prices in cents (brief: Prices). */
const ADMISSION_PRICES: Record<Fare, number> = { regular: 1400, reduced: 1100, member: 1000, "member-guest": 1200, group: 950 };

export type PriceLine = { fare: Fare; quantity: number; unit_cents: number; subtotal_cents: number; gst_cents: number; qst_cents: number };
export type Totals = { lines: PriceLine[]; admission_cents: number; gst_cents: number; qst_cents: number; uplift_cents: number; total_cents: number };

/** Exact integer division of non-negative integers (no fractional step). */
function divide(numerator: number, denominator: number): number {
  return (numerator - (numerator % denominator)) / denominator;
}

/** Per-line GST and QST, half-up to the cent, once per line and per tax; QST is not charged on GST. */
function lineTaxes(subtotal: number): { gst: number; qst: number } {
  return { gst: divide(subtotal * 5 + 50, 100), qst: divide(subtotal * 9975 + 50000, 100000) };
}

/** Admission lines grouped by fare in the published fare order, plus the untaxed uplift. */
export function priceSeats(fares: Fare[], upliftCents: number): Totals {
  const lines: PriceLine[] = [];
  for (const fare of FARES) {
    const quantity = fares.filter((f) => f === fare).length;
    if (!quantity) continue;
    const subtotal = quantity * ADMISSION_PRICES[fare];
    const { gst, qst } = lineTaxes(subtotal);
    lines.push({ fare, quantity, unit_cents: ADMISSION_PRICES[fare], subtotal_cents: subtotal, gst_cents: gst, qst_cents: qst });
  }
  const sum = (key: "subtotal_cents" | "gst_cents" | "qst_cents"): number => lines.reduce((total, line) => total + line[key], 0);
  const admission = sum("subtotal_cents");
  const gst = sum("gst_cents");
  const qst = sum("qst_cents");
  return { lines, admission_cents: admission, gst_cents: gst, qst_cents: qst, uplift_cents: upliftCents, total_cents: admission + gst + qst + upliftCents };
}

/**
 * Group cost split: base share floor(T × seats ÷ S); the leftover cents go one each by largest
 * remainder, ties broken by listing order. Shares always sum to T.
 */
export function splitCost(total: number, seats: number[]): number[] {
  const count = seats.reduce((sum, n) => sum + n, 0);
  const base = seats.map((n) => divide(total * n, count));
  const remainders = seats.map((n, index) => ({ index, remainder: (total * n) % count }));
  let leftover = total - base.reduce((sum, n) => sum + n, 0);
  for (const { index } of [...remainders].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (leftover === 0) break;
    base[index] = (base[index] ?? 0) + 1;
    leftover -= 1;
  }
  return base;
}

/** Exact decimal text (`29.40`, `0E-9`, `25.000000000`) to integer cents. */
export function decimalToCents(text: string): number {
  const match = /^(-?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text.trim());
  if (!match) throw new Error(`not an amount: ${text}`);
  const [, sign, whole = "", fraction = "", exponent = "0"] = match;
  const digits = BigInt((whole + fraction) || "0");
  const scale = fraction.length - Number(exponent) - 2;
  const cents = scale <= 0 ? digits * 10n ** BigInt(-scale) : digits / 10n ** BigInt(scale);
  return Number(sign === "-" ? -cents : cents);
}

/** Integer cents to a dot-decimal literal (`2940` → `29.40`), for Kill Bill and the CSV. */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${divide(abs, 100)}.${String(abs % 100).padStart(2, "0")}`;
}

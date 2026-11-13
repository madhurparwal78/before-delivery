// Measuring and the firing fee, in exact integer arithmetic.
//   sizes   -> hundredths of the chosen unit
//   sides   -> whole half-inches after the round-up
//   cubic   -> eighths of a cubic inch (the product of three half-inch sides)
//   rates   -> ten-thousandths of a dollar per cubic inch
//   money   -> integer cents
import type { Plan, Quote, Sides, Unit } from "../shared/api";
import type { Shape } from "../shared/rules";

const SHAPES: readonly Shape[] = ["round", "rectangular", "plate"];
const PLANS: readonly Plan[] = ["bisque_and_glaze", "bisque_only", "glaze_only"];
const UNITS: readonly Unit[] = ["in", "cm"];

/** Largest rounded side: 23.0 in. */
const MAX_SIDE_HALVES = 46;
/** A plate counts as at least 1.5 in tall. */
const PLATE_FLOOR_HALVES = 3;

export type SizeKey = "length" | "width" | "diameter" | "height";

export function sizeKeys(shape: Shape): SizeKey[] {
  return shape === "rectangular" ? ["length", "width", "height"] : ["diameter", "height"];
}

export interface Measured {
  shape: Shape;
  /** rounded sides in halves, keyed like the request */
  sides: Partial<Record<SizeKey, number>>;
  cubicEighths: number;
}

const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

/** Parses one size into hundredths, or returns the field message for it. */
function hundredths(raw: unknown): number | string {
  if (raw === undefined || raw === null || raw === "") return "Enter a size above 0";
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : null;
  if (text === null || !NUMBER.test(text)) return "Enter a number with at most two decimals";
  if (Number(text) <= 0) return "Enter a size above 0";
  const [whole = "0", fraction = ""] = text.replace(/^\+/, "").split(".");
  if (fraction.length > 2) return "Enter a number with at most two decimals";
  return Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0"));
}

/** Round a size up to the next multiple of 0.5 in; centimetres are divided by exactly 2.54 first. */
function roundUpHalves(value: number, unit: Unit): number {
  // inches: value/100 in -> halves = ceil(value / 50); cm: value/254 in -> halves = ceil(value / 127)
  const per = unit === "cm" ? 127 : 50;
  return Math.ceil(value / per);
}

export function formatHalves(halves: number): string {
  return `${Math.floor(halves / 2)}.${halves % 2 === 0 ? "0" : "5"}`;
}

export function formatCubic(eighths: number): string {
  const thousandths = eighths * 125;
  return `${Math.floor(thousandths / 1000)}.${String(thousandths % 1000).padStart(3, "0")}`;
}

export function sidesOut(shape: Shape, sides: Partial<Record<SizeKey, number>>): Sides {
  const out: Sides = { height: formatHalves(sides.height ?? 0) };
  for (const key of sizeKeys(shape)) if (key !== "height") out[key] = formatHalves(sides[key] ?? 0);
  return out;
}

/**
 * Validates and measures a quote body. `heightLimitHalves` is the tallest post minus clearance.
 * Field messages are added to `fields`; the result is null when any size field failed.
 */
export function measure(
  body: Record<string, unknown>,
  heightLimitHalves: number,
  fields: Record<string, string>,
): (Measured & { unit: Unit; plan: Plan }) | null {
  const shape = SHAPES.find((s) => s === body.shape);
  const unit = UNITS.find((u) => u === body.unit);
  const plan = PLANS.find((p) => p === body.plan);
  if (!shape) fields.shape = "Choose a shape";
  if (!unit) fields.unit = "Choose cm or in";
  if (!plan) fields.plan = "Choose a firing plan";
  if (!shape) return null;
  const sides: Partial<Record<SizeKey, number>> = {};
  let ok = true;
  for (const key of sizeKeys(shape)) {
    const parsed = hundredths(body[key]);
    if (typeof parsed === "string") {
      fields[key] = parsed;
      ok = false;
      continue;
    }
    if (!unit) continue;
    let halves = roundUpHalves(parsed, unit);
    if (key === "height" && shape === "plate") halves = Math.max(halves, PLATE_FLOOR_HALVES);
    if (halves > MAX_SIDE_HALVES) {
      fields[key] = "Too large for the shelf: 23 in at most";
      ok = false;
    } else if (key === "height" && halves > heightLimitHalves) {
      fields[key] = `Too tall for any kiln: ${formatHalves(heightLimitHalves)} in at most`;
      ok = false;
    }
    sides[key] = halves;
  }
  if (!ok || !unit || !plan) return null;
  const across = shape === "rectangular" ? (sides.length ?? 0) * (sides.width ?? 0) : (sides.diameter ?? 0) ** 2;
  return { shape, unit, plan, sides, cubicEighths: across * (sides.height ?? 0) };
}

export interface RateSetRow {
  id: number;
  bisque_rate: string;
  glaze_rate: string;
  member_discount_percent: number;
  order_minimum_cents: number;
}

/** "0.0300" -> 300 ten-thousandths of a dollar. */
function rateUnits(rate: string): number {
  const [whole = "0", fraction = ""] = rate.split(".");
  return Number(whole) * 10000 + Number(fraction.padEnd(4, "0").slice(0, 4));
}

export function formatRate(units: number): string {
  return `${Math.floor(units / 10000)}.${String(units % 10000).padStart(4, "0")}`;
}

interface Fee {
  rateUnits: number;
  discountPercent: number;
  orderMinimumCents: number;
  minimumApplied: boolean;
  feeCents: number;
}

/**
 * Amount = cubic inches × rate per cubic inch × (100 − discount) ÷ 100, rounded once half-up to the
 * cent; the fee is the larger of that and the order minimum.
 */
export function fee(cubicEighths: number, plan: Plan, rates: RateSetRow, member: boolean): Fee {
  const bisque = rateUnits(rates.bisque_rate);
  const glaze = rateUnits(rates.glaze_rate);
  const rate = plan === "bisque_only" ? bisque : plan === "glaze_only" ? glaze : bisque + glaze;
  const discount = member ? rates.member_discount_percent : 0;
  // dollars = (eighths / 8) × (rate / 10^4) × (100 − d) / 100  ->  cents = eighths × rate × (100 − d) / 8·10^4
  const numerator = BigInt(cubicEighths) * BigInt(rate) * BigInt(100 - discount);
  const denominator = 80_000n;
  const amountCents = Number((numerator * 2n + denominator) / (denominator * 2n));
  const minimumApplied = rates.order_minimum_cents > amountCents;
  return {
    rateUnits: rate,
    discountPercent: discount,
    orderMinimumCents: rates.order_minimum_cents,
    minimumApplied,
    feeCents: minimumApplied ? rates.order_minimum_cents : amountCents,
  };
}

export function quoteOut(measured: Measured, charge: Fee, rateSetId: number): Quote {
  return {
    sides_in: sidesOut(measured.shape, measured.sides),
    cubic_inches: formatCubic(measured.cubicEighths),
    rate_per_cubic_inch: formatRate(charge.rateUnits),
    discount_percent: charge.discountPercent,
    order_minimum_cents: charge.orderMinimumCents,
    minimum_applied: charge.minimumApplied,
    fee_cents: charge.feeCents,
    rate_set_id: rateSetId,
  };
}

/** Kill Bill decimal amounts back to integer cents ("7.41", 7.41 -> 741). */
export function centsOf(amount: unknown): number {
  const text = typeof amount === "number" ? amount.toFixed(2) : String(amount ?? "0");
  const negative = text.trim().startsWith("-");
  const [whole = "0", fraction = ""] = text.replace(/^[+-]/, "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
  return negative ? -cents : cents;
}

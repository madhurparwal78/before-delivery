import { copy } from "./copy.ts";
import { fixed, over, type Rational, rational, roundHalfUp, roundUp, scaled, times, whole } from "./decimal.ts";
import { type Currency, printAmount, splitMilestones, toMinor } from "./money.ts";

const WASTE = rational("1.15");
const SQ_FT_IN_SQ_M = rational("0.09290304");
const QUARTERS_PER_METRE = 4n;

export type Lot = { lot: string; hides: number; averageSqFt: string } | { lot: string; metres: string };
export type LeatherLot = Extract<Lot, { hides: number }>;
export type FabricLot = Extract<Lot, { metres: string }>;

export function isLeatherLot(lot: Lot): lot is LeatherLot {
  return "hides" in lot;
}

/** Whole hides for a pattern area on a lot: area plus waste over the lot's average, rounded up. */
export function hidesNeeded(patternAreaSqFt: string, averageSqFt: string): number {
  return Number(roundUp(over(times(rational(patternAreaSqFt), WASTE), rational(averageSqFt))));
}

/** Fabric is sold in quarter metres rounded up. */
function quarterMetres(metres: string): string {
  const quarters = roundUp(times(rational(metres), whole(QUARTERS_PER_METRE)));
  return scaled(quarters * 25n, 2);
}

export function metresFigure(metres: string): string {
  return scaled(roundHalfUp(times(rational(metres), whole(100))), 2);
}

function hidesCopy(hides: number): string {
  return hides === 1 ? "1 hide" : `${hides} hides`;
}

/** A hold's or lot's amount with its unit: `2 hides`, `1 hide` or `7.50 m`. */
export function amountCopy(quantity: number | string): string {
  return typeof quantity === "number" ? hidesCopy(quantity) : `${quantity} m`;
}

/**
 * The last two steps of a lot check, shared by holds and estimates: no lot holding enough reads F-37 or F-38,
 * then a chosen lot too small while another is enough reads F-39.
 */
export function leatherLotRefusal(needed: (lot: LeatherLot) => number, chosen: LeatherLot, lots: readonly LeatherLot[], name: string): string | null {
  if (!lots.some((lot) => needed(lot) <= lot.hides)) {
    return copy("F-37", { n: needed(chosen), name, m: Math.max(...lots.map((lot) => lot.hides)) });
  }
  return needed(chosen) <= chosen.hides ? null : copy("F-39", { lot: chosen.lot, m: amountCopy(chosen.hides) });
}

export function fabricLotRefusal(metres: string, chosen: FabricLot, lots: readonly FabricLot[], name: string): string | null {
  const wanted = rational(metres);
  const holds = (lot: FabricLot): boolean => {
    const has = rational(lot.metres);
    return wanted.num * has.den <= has.num * wanted.den;
  };
  if (!lots.some(holds)) {
    const largest = lots.map((lot) => metresFigure(lot.metres)).sort((a, b) => Number(rational(b).num - rational(a).num))[0];
    return copy("F-38", { n: metresFigure(metres), name, m: largest ?? "0.00" });
  }
  return holds(chosen) ? null : copy("F-39", { lot: chosen.lot, m: amountCopy(metresFigure(chosen.metres)) });
}

export interface EstimateFigures {
  currency: Currency;
  labourRateMinor: bigint;
  materialMinor: bigint;
  labourMinor: bigint;
  subtotalMinor: bigint;
  taxPercent: number;
  taxMinor: bigint;
  totalMinor: bigint;
}

/** One rounding stage: material and labour lines half up on the exact value, subtotal their sum, tax half up, total their sum. */
export function workOutFigures(materialAmount: Rational, labourHours: string, labourRateMinor: bigint, currency: Currency, taxPercent: number): EstimateFigures {
  const materialMinor = toMinor(materialAmount, currency);
  const labourMinor = roundHalfUp(times(rational(labourHours), whole(labourRateMinor)));
  const subtotalMinor = materialMinor + labourMinor;
  const taxMinor = roundHalfUp({ num: subtotalMinor * BigInt(taxPercent), den: 100n });
  return { currency, labourRateMinor, materialMinor, labourMinor, subtotalMinor, taxPercent, taxMinor, totalMinor: subtotalMinor + taxMinor };
}

/** Leather is sold by the whole hide: hides × the lot's average × the price per sq ft. */
export function leatherAmount(hides: number, averageSqFt: string, price: string): Rational {
  return times(times(whole(hides), rational(averageSqFt)), rational(price));
}

function fabricAmount(metres: string, price: string): Rational {
  return times(rational(metres), rational(price));
}

export function displayFigures(figures: EstimateFigures, patternAreaSqFt: string | null) {
  const print = (minor: bigint) => printAmount(minor, figures.currency);
  return {
    material: print(figures.materialMinor),
    labour: print(figures.labourMinor),
    labourRate: print(figures.labourRateMinor),
    subtotal: print(figures.subtotalMinor),
    tax: print(figures.taxMinor),
    total: print(figures.totalMinor),
    milestones: splitMilestones(figures.totalMinor).map((milestone) => print(milestone.amountMinor)),
    area: patternAreaSqFt === null ? null : areaCopy(patternAreaSqFt),
  };
}

/** Areas show both units half up: `48.25 sq ft (4.48 m²)`. */
function areaCopy(sqFt: string): string {
  return `${sqFt} sq ft (${fixed(times(rational(sqFt), SQ_FT_IN_SQ_M), 2)} m²)`;
}

export function quarterHours(hours: string): boolean {
  const quarters = times(rational(hours), whole(QUARTERS_PER_METRE));
  return quarters.num % quarters.den === 0n;
}

const MAX_WHOLE_DIGITS = 7;

/** A decimal an estimate can carry: the figure's whole part stays within what minor units can store. */
export function withinAmountRange(text: string): boolean {
  return (text.split(".")[0] as string).length <= MAX_WHOLE_DIGITS;
}

export function isPositive(text: string): boolean {
  return rational(text).num > 0n;
}

interface EstimateMaterial {
  name: string;
  unit: "sqFt" | "metre";
  price: string;
}

export interface EstimateCharge {
  material: EstimateMaterial;
  lot: Lot;
  /** The pattern area for leather, the typed metres for fabric. */
  amount: string;
}

/** The two lot-check steps an estimate shares with a hold, on what the estimate would use. */
export function estimateLotRefusal(charge: EstimateCharge, lots: readonly Lot[]): string | null {
  const { lot, material, amount } = charge;
  if (isLeatherLot(lot)) {
    return leatherLotRefusal((each) => hidesNeeded(amount, each.averageSqFt), lot, lots.filter(isLeatherLot), material.name);
  }
  return fabricLotRefusal(quarterMetres(amount), lot, lots.filter((each): each is FabricLot => !isLeatherLot(each)), material.name);
}

export interface WorkedEstimate {
  hides: number | null;
  metres: string | null;
  patternAreaSqFt: string | null;
  figures: EstimateFigures;
}

/** The whole working of one estimate; `charge` is null for frame-only work. */
export function workOutEstimate(charge: EstimateCharge | null, labourHours: string, labourRateMinor: bigint, currency: Currency, taxPercent: number): WorkedEstimate {
  if (!charge) {
    return { hides: null, metres: null, patternAreaSqFt: null, figures: workOutFigures(whole(0), labourHours, labourRateMinor, currency, taxPercent) };
  }
  const { lot, material, amount } = charge;
  if (isLeatherLot(lot)) {
    const hides = hidesNeeded(amount, lot.averageSqFt);
    const line = leatherAmount(hides, lot.averageSqFt, material.price);
    return { hides, metres: null, patternAreaSqFt: amount, figures: workOutFigures(line, labourHours, labourRateMinor, currency, taxPercent) };
  }
  const metres = quarterMetres(amount);
  return { hides: null, metres, patternAreaSqFt: null, figures: workOutFigures(fabricAmount(metres, material.price), labourHours, labourRateMinor, currency, taxPercent) };
}

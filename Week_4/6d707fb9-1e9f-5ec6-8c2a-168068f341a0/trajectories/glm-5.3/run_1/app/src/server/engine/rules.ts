import { add, mul } from "./decimal.js";

/** The GTIN mod-10 check digit: the single place the check is decided. */
export function gtinCheckDigit(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = first12.charCodeAt(i) - 48;
    if (d < 0 || d > 9) throw new Error("bad gtin digits");
    sum += i % 2 === 0 ? d : d * 3;
  }
  return String((10 - (sum % 10)) % 10);
}

export type GtinProblem = "length" | "chars" | "digit" | null;

export interface GtinCheck {
  ok: boolean;
  problem: GtinProblem;
  expectedDigit: string | null;
}

export function checkGtin(gtin: string): GtinCheck {
  if (!/^[0-9]{13}$/.test(gtin)) {
    if (!/^[0-9]+$/.test(gtin)) return { ok: false, problem: "chars", expectedDigit: null };
    return { ok: false, problem: "length", expectedDigit: null };
  }
  const expected = gtinCheckDigit(gtin.slice(0, 12));
  if (gtin[12] === expected) return { ok: true, problem: null, expectedDigit: expected };
  return { ok: false, problem: "digit", expectedDigit: expected };
}

/** A fabric weight and area give the exact mass in grams. */
export function massFromWeightArea(gsm: string, areaM2: string): string {
  return mul(gsm, areaM2);
}

/** Fibre shares with one decimal must add up to exactly 100.0. */
export function fibresTotalOk(shares: readonly string[]): boolean {
  const total = shares.reduce((acc, s) => add(acc, s), "0");
  return total === "100.0" || total === "100" || total === "100.00" || total === "100.000";
}

/** kWh × 3.6 and m³ × 37.8 into exact MJ. */
export function energyToMj(value: string, unit: "kWh" | "MJ" | "m3"): string {
  if (unit === "MJ") return value;
  if (unit === "kWh") return mul(value, "3.6");
  return mul(value, "37.8");
}

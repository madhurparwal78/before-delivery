// The fare (brief: Fare). Every amount is integer paise.
import type { ClassCode, FareQuote, Quota } from "../../shared/api.js";
import { gstApplies, gstOn } from "./money.js";

const RATE_PAISE_PER_KM: Record<ClassCode, number> = { SL: 45, "3A": 120 };
const BASE_ROUNDING_PAISE = 500;
const RESERVATION_PAISE: Record<ClassCode, number> = { SL: 2000, "3A": 4000 };
const TATKAL_PAISE: Record<ClassCode, number> = { SL: 15000, "3A": 40000 };
const CHILD_AGE_LIMIT = 5;

interface AdultFare {
  beforeGst: number;
  gst: number;
  total: number;
}

export function adultFare(km: number, cls: ClassCode, quota: Quota): AdultFare {
  const base = Math.ceil((km * RATE_PAISE_PER_KM[cls]) / BASE_ROUNDING_PAISE) * BASE_ROUNDING_PAISE;
  const beforeGst = base + RESERVATION_PAISE[cls] + (quota === "TQ" ? TATKAL_PAISE[cls] : 0);
  const gst = gstApplies(cls) ? gstOn(beforeGst) : 0;
  return { beforeGst, gst, total: beforeGst + gst };
}

export function isChild(age: number): boolean {
  return age < CHILD_AGE_LIMIT;
}

/** A passenger's whole fare, GST included; children under five pay nothing. */
export function passengerFare(km: number, cls: ClassCode, quota: Quota, age: number): number {
  return isChild(age) ? 0 : adultFare(km, cls, quota).total;
}

export function fareQuote(km: number, cls: ClassCode, quota: Quota, ages: number[]): FareQuote {
  const fare = adultFare(km, cls, quota);
  const lines = ages.map((age, i) =>
    isChild(age)
      ? { label: `Passenger ${i + 1} — under five, no berth`, amount_paise: 0 }
      : { label: `Passenger ${i + 1} fare`, amount_paise: fare.beforeGst },
  );
  if (gstApplies(cls)) lines.push({ label: "GST 5%", amount_paise: fare.gst * ages.filter((a) => !isChild(a)).length });
  return { lines, total_paise: lines.reduce((sum, line) => sum + line.amount_paise, 0) };
}

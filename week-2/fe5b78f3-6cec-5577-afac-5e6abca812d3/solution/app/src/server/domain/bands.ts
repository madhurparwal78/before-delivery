// Deduction bands and their edges, the GST on a charge and the refund (brief: Cancellation deductions, GST on charges).
import type { Band, CancelledPassenger, ClassCode, Quota, StatusCode } from "../../shared/api.js";
import { HOUR_MS, MINUTE_MS } from "./clock.js";
import { isChild } from "./fare.js";
import { gstApplies, gstOn, roundHalfUp } from "./money.js";
import { isQueue } from "./status.js";

const CLERKAGE_PAISE = 6000;
const FLAT_PAISE: Record<ClassCode, number> = { SL: 12000, "3A": 18000 };
const RAC_CUTOFF_MS = 30 * MINUTE_MS;
const BANDS_WITH_GST = new Set<Band>(["flat", "quarter", "half", "clerkage", "party_clerkage", "rac_after_chart"]);

export interface BandContext {
  now: number;
  /** Decided by the chart instant rule (schedule.ts). */
  chartPrepared: boolean;
  /** Scheduled departure from the PNR's From stop. */
  departureAt: number;
  cls: ClassCode;
  quota: Quota;
  partConfirmedParty: boolean;
}

interface CancellingPassenger {
  number: number;
  age: number;
  fare: number;
  status: StatusCode;
}

/** The first band that applies, decided at the instant the request arrives. */
function bandOf(ctx: BandContext, p: CancellingPassenger): Band {
  const afterChart = ctx.chartPrepared;
  const untilDeparture = ctx.departureAt - ctx.now;
  if (isChild(p.age)) return "no_fare";
  if (p.status === "RAC" && afterChart && untilDeparture >= RAC_CUTOFF_MS) return "rac_after_chart";
  if ((p.status === "CNF" && afterChart) || (p.status === "RAC" && untilDeparture < RAC_CUTOFF_MS)) return "after_chart";
  if (ctx.partConfirmedParty) return "party_clerkage";
  if (p.status === "CNF" && ctx.quota === "TQ") return "tatkal_confirmed";
  if (p.status === "RAC" || isQueue(p.status)) return "clerkage";
  if (untilDeparture > 48 * HOUR_MS) return "flat";
  if (untilDeparture >= 12 * HOUR_MS) return "quarter";
  return "half";
}

function chargeOf(band: Band, fare: number, cls: ClassCode): number {
  switch (band) {
    case "flat":
      return FLAT_PAISE[cls];
    case "quarter":
      return Math.max(roundHalfUp(fare * 25, 100), FLAT_PAISE[cls]);
    case "half":
      return Math.max(roundHalfUp(fare * 50, 100), FLAT_PAISE[cls]);
    case "clerkage":
    case "party_clerkage":
    case "rac_after_chart":
      return CLERKAGE_PAISE;
    case "tatkal_confirmed":
    case "after_chart":
      return fare;
    case "no_fare":
    case "chart_full":
      return 0;
  }
}

/** Charge, GST, deduction and refund for one passenger; the deduction never exceeds the fare. */
function deductionFor(band: Band, fare: number, cls: ClassCode): Omit<CancelledPassenger, "number" | "band"> {
  let charge = chargeOf(band, fare, cls);
  const gst = gstApplies(cls) && BANDS_WITH_GST.has(band) ? gstOn(charge) : 0;
  if (charge + gst > fare) charge = fare - gst;
  const deduction = charge + gst;
  return { charge_paise: charge, gst_paise: gst, deduction_paise: deduction, refund_paise: fare - deduction };
}

/**
 * Before the chart, on a General PNR, a cancellation of every remaining passenger aged 5 or over that takes at least
 * one CNF and at least one RAC or waiting-list passenger (brief: Part-confirmed party).
 */
export function isPartConfirmedParty(
  quota: Quota,
  beforeChart: boolean,
  remainingAdults: { number: number; status: StatusCode }[],
  selected: number[],
): boolean {
  if (quota !== "GN" || !beforeChart) return false;
  if (!remainingAdults.every((p) => selected.includes(p.number))) return false;
  return remainingAdults.some((p) => p.status === "CNF") && remainingAdults.some((p) => p.status === "RAC" || isQueue(p.status));
}

export function quotePassengers(ctx: BandContext, cls: ClassCode, passengers: CancellingPassenger[]): CancelledPassenger[] {
  return passengers.map((p) => {
    const band = bandOf(ctx, p);
    return { number: p.number, band, ...deductionFor(band, p.fare, cls) };
  });
}

/** The chart's entry for a not-confirmed passenger: no charge, the whole fare back. */
export function chartFull(number: number, fare: number, cls: ClassCode): CancelledPassenger {
  return { number, band: "chart_full", ...deductionFor("chart_full", fare, cls) };
}

// The brief's arithmetic rules, each decided once: seat count, business-minute notice, the fee decision,
// billable minutes, seat amounts, mileage and uncovered minutes. Pure functions over integers.
import { DateTime } from "luxon";
import { AGENCY_ZONE } from "../shared/time.js";
import type { ChargeLine } from "./records.js";

/** An ASL assignment longer than 60 minutes is a team of two; everything else has one seat. */
export function seatCount(languageCode: string, durationMinutes: number): number {
  return languageCode === "asl" && durationMinutes > 60 ? 2 : 1;
}

/** `asl` for ASL, `spoken` for every other language. */
export function serviceLine(languageCode: string): "asl" | "spoken" {
  return languageCode === "asl" ? "asl" : "spoken";
}

/** Whole elapsed minutes from `from` to `to` that fall on Monday to Friday in Central time. */
export function businessMinutes(from: DateTime, to: DateTime): number {
  let cursor = from.setZone(AGENCY_ZONE);
  const end = to.setZone(AGENCY_ZONE);
  let milliseconds = 0;
  while (cursor < end) {
    const midnight = cursor.startOf("day").plus({ days: 1 });
    const stop = midnight < end ? midnight : end;
    if (cursor.weekday <= 5) milliseconds += stop.toMillis() - cursor.toMillis();
    cursor = stop;
  }
  return Math.floor(milliseconds / 60_000);
}

/** 48 business hours. A notice below this is late; exactly this is not. */
const LATE_NOTICE_MINUTES = 2880;

export function isLateNotice(noticeMinutes: number): boolean {
  return noticeMinutes < LATE_NOTICE_MINUTES;
}

/** The two-hour minimum every seat bills. */
export const MINIMUM_BILLABLE_MINUTES = 120;

/** The greater of 120 and the actual minutes rounded up to the next quarter hour. */
export function billableMinutes(actualMinutes: number): number {
  const rest = actualMinutes % 15;
  const rounded = rest === 0 ? actualMinutes : actualMinutes + 15 - rest;
  return Math.max(MINIMUM_BILLABLE_MINUTES, rounded);
}

/** hourly × minutes ÷ 60, rounded half-up to a whole cent, in integer arithmetic. */
export function seatAmountCents(hourlyRateCents: number, minutes: number): number {
  const numerator = hourlyRateCents * minutes;
  const remainder = numerator % 60;
  const quotient = (numerator - remainder) / 60;
  return remainder * 2 >= 60 ? quotient + 1 : quotient;
}

/** The free radius is 20 miles, so the first 40 round-trip miles are free. */
const FREE_ROUND_TRIP_MILES = 40;

export function mileage(roundTripMiles: number, centsPerMile: number): { billableMiles: number; mileageCents: number } {
  const billableMiles = Math.max(0, roundTripMiles - FREE_ROUND_TRIP_MILES);
  return { billableMiles, mileageCents: billableMiles * centsPerMile };
}

/** One line per late-cancelled seat: the two-hour minimum at the hourly rate, no mileage. */
export function lateCancellationLines(seats: number, hourlyRateCents: number): ChargeLine[] {
  return Array.from({ length: seats }, (_, index) => ({
    seat: index + 1,
    actual_minutes: null,
    billable_minutes: MINIMUM_BILLABLE_MINUTES,
    amount_cents: seatAmountCents(hourlyRateCents, MINIMUM_BILLABLE_MINUTES),
    round_trip_miles: 0,
    billable_miles: 0,
    mileage_cents: 0,
  }));
}

/** The sum of every line's amount and mileage. */
export function chargeTotal(lines: ReadonlyArray<ChargeLine>): number {
  return lines.reduce((sum, line) => sum + line.amount_cents + line.mileage_cents, 0);
}

/**
 * The fee decision for cancelling now: drafts never carry a fee; released, partially covered and covered
 * assignments carry the two-hour minimum on every seat when the notice is late.
 */
export function cancellationFee(
  status: string,
  noticeMinutes: number,
  seats: number,
  hourlyRateCents: number,
): { feeApplies: boolean; feeCents: number } {
  const feeApplies = status !== "draft" && isLateNotice(noticeMinutes);
  return { feeApplies, feeCents: feeApplies ? chargeTotal(lateCancellationLines(seats, hourlyRateCents)) : 0 };
}

/** Statuses whose open seats count as uncovered time. */
const UNCOVERED_STATUSES = new Set(["draft", "released", "partially_covered"]);

/** Sum of duration × open seats over the given assignments of one language and week. */
export function uncoveredMinutes(
  assignments: ReadonlyArray<{ status: string; durationMinutes: number; seats: ReadonlyArray<{ status: string }> }>,
): number {
  return assignments
    .filter((a) => UNCOVERED_STATUSES.has(a.status))
    .reduce((sum, a) => sum + a.durationMinutes * a.seats.filter((s) => s.status === "open").length, 0);
}

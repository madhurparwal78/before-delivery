/** Settlement dates by method, the settlement preview and the approval expiry rule. */
import { ACH_CUTOFF_HOUR, APPROVAL_BUSINESS_DAYS, PAYMENT_METHODS, WIRE_CUTOFF_HOUR, type PaymentMethod } from "../shared/rules.js";
import { businessDayOnOrAfter, businessDaysAfter, isBusinessDay, nextBusinessDay } from "./calendar.js";
import { addDays, newYorkHour, newYorkMidnight, newYorkTime } from "./clock.js";

const CUTOFF_HOURS: Partial<Record<PaymentMethod, number>> = { ach: ACH_CUTOFF_HOUR, wire: WIRE_CUTOFF_HOUR };

/** The effective date of a direct send or a final approval made at `instant`. */
export function settlementDate(method: PaymentMethod, instant: Date): string {
  const today = newYorkTime(instant);
  switch (method) {
    case "rtp":
      return today.date;
    case "check":
      return nextBusinessDay(today.date);
    default: {
      const cutoff = CUTOFF_HOURS[method] ?? ACH_CUTOFF_HOUR;
      return isBusinessDay(today.date) && today.hour < cutoff ? today.date : nextBusinessDay(today.date);
    }
  }
}

/** The effective date stored when a payment is scheduled for a chosen date. */
export function scheduledEffectiveDate(method: PaymentMethod, scheduledFor: string): string {
  return method === "rtp" ? scheduledFor : businessDayOnOrAfter(scheduledFor);
}

type SettlementDates = Record<PaymentMethod, string>;

interface SettlementPreview {
  settlementDates: SettlementDates;
  changeAt: Date;
}

function datesAt(instant: Date): SettlementDates {
  const found = {} as SettlementDates;
  for (const method of PAYMENT_METHODS) found[method] = settlementDate(method, instant);
  return found;
}

/** What a direct send would get now, and the earliest later instant at which any of those dates differs. */
export function settlementPreview(now: Date): SettlementPreview {
  const current = datesAt(now);
  const today = newYorkTime(now).date;
  const candidates = [
    newYorkHour(today, ACH_CUTOFF_HOUR),
    newYorkHour(today, WIRE_CUTOFF_HOUR),
    newYorkMidnight(addDays(today, 1)),
  ].filter((instant) => instant.getTime() > now.getTime());
  for (const instant of candidates) {
    const later = datesAt(instant);
    if (PAYMENT_METHODS.some((method) => later[method] !== current[method])) {
      return { settlementDates: current, changeAt: instant };
    }
  }
  throw new Error("settlement dates never change before the next New York midnight");
}

interface ApprovalDeadline {
  expiresAt: Date;
  approveBy: string;
}

/** A held payment expires at 00:00 New York time on the fifth business day after its New York creation date. */
export function approvalDeadline(createdAt: Date): ApprovalDeadline {
  const created = newYorkTime(createdAt).date;
  const expiryDate = businessDaysAfter(created, APPROVAL_BUSINESS_DAYS);
  return { expiresAt: newYorkMidnight(expiryDate), approveBy: addDays(expiryDate, -1) };
}

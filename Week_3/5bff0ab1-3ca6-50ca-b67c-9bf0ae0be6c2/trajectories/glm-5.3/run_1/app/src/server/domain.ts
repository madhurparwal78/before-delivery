// Each domain rule is decided in exactly one place: this file.
import {
  addDays,
  daysBetween,
  istDateOf,
  istStartOfDay,
  toIst,
} from "./clock";
import { CLOSED_DATES, CLOSED_WEEKDAY, HUBS, MODELS, modelById, hubById, FINISHES } from "./seed";
import { roadTaxPaise } from "./money";

// ---------- closed days (the brand's invented calendar) ----------

export function isClosedDay(hub: string, dateStr: string): boolean {
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (weekday === CLOSED_WEEKDAY) return true;
  return (CLOSED_DATES[hub] ?? []).includes(dateStr);
}

// The next open day at a hub, strictly after the given IST date.
export function nextOpenDay(hub: string, dateStr: string): string {
  let d = addDays(dateStr, 1);
  for (let i = 0; i < 60; i++) {
    if (!isClosedDay(hub, d)) return d;
    d = addDays(d, 1);
  }
  return d;
}

// ---------- on-road price make-up ----------

export interface Quote {
  stepEffectiveFrom: string;
  exFactoryPaise: number;
  gstPercent: number;
  gstPaise: number;
  exShowroomPaise: number;
  roadTaxPercent: number;
  roadTaxPaise: number;
  insurancePaise: number;
  onRoadPaise: number;
}

function stepInForce<T extends { effectiveFrom: string }>(steps: T[], nowMs: number): T {
  let best = steps[0];
  const today = istDateOf(nowMs);
  for (const s of steps) {
    if (daysBetween(s.effectiveFrom, today) >= 0) best = s;
  }
  return best;
}

export function roadTaxPercentFor(hub: string, nowMs: number): number {
  const seed = hubById(hub);
  if (!seed) return 0;
  return stepInForce(seed.roadTaxSteps, nowMs).percent;
}

// The quote in force for a model and hub on the app clock.
export function computeQuote(modelId: string, hubId: string, nowMs: number): Quote {
  const model = modelById(modelId);
  const hub = hubById(hubId);
  if (!model || !hub) {
    throw new Error(`unknown model or hub ${modelId}/${hubId}`);
  }
  const modelStep = stepInForce(model.steps, nowMs);
  const taxStep = stepInForce(hub.roadTaxSteps, nowMs);
  const exFactory = modelStep.exFactoryPaise;
  const gstPaise = Math.round((exFactory * model.gstPercent) / 100);
  const exShowroom = exFactory + gstPaise;
  const tax = roadTaxPaise(exShowroom, taxStep.percent);
  const onRoad = exShowroom + tax + model.insurancePaise;
  // stepEffectiveFrom is the later of the model's step date and the hub's road-tax step date.
  const stepEffectiveFrom = daysBetween(taxStep.effectiveFrom, modelStep.effectiveFrom) >= 0
    ? modelStep.effectiveFrom
    : taxStep.effectiveFrom;
  return {
    stepEffectiveFrom,
    exFactoryPaise: exFactory,
    gstPercent: model.gstPercent,
    gstPaise: gstPaise,
    exShowroomPaise: exShowroom,
    roadTaxPercent: taxStep.percent,
    roadTaxPaise: tax,
    insurancePaise: model.insurancePaise,
    onRoadPaise: onRoad,
  };
}

// ---------- price lock expiry ----------

const LOCK_END_HOUR = 18;
const LOCK_DAY_OFFSET = 2; // second calendar day after the IST issue date

// A lock ends at 18:00 IST on the second calendar day after its IST issue date.
// A lock issued at or after 18:00 IST counts from the next IST date.
// An expiry falling on a closed day at the lock's hub moves forward to the next open day.
export function computeLockExpiry(issuedAtMs: number, hub: string): number {
  const issueDate = istDateOf(issuedAtMs);
  const issueParts = toIst(issuedAtMs);
  let baseDate = addDays(issueDate, LOCK_DAY_OFFSET);
  if (issueParts.hour >= LOCK_END_HOUR) {
    baseDate = addDays(issueDate, LOCK_DAY_OFFSET + 1);
  }
  let expiryDate = baseDate;
  while (isClosedDay(hub, expiryDate)) {
    expiryDate = addDays(expiryDate, 1);
  }
  return istStartOfDay(expiryDate) + LOCK_END_HOUR * 3600000;
}

// ---------- test-ride slots ----------

export const SLOT_STARTS = [
  { h: 10, m: 0 },
  { h: 10, m: 45 },
  { h: 11, m: 30 },
  { h: 12, m: 15 },
  { h: 13, m: 0 },
  { h: 13, m: 45 },
  { h: 14, m: 30 },
  { h: 15, m: 15 },
  { h: 16, m: 0 },
  { h: 16, m: 45 },
  { h: 17, m: 30 },
  { h: 18, m: 15 },
];

export const SLOT_CUT_OFF_MS = 2 * 3600000;
export const BOOKING_WINDOW_DAYS = 14;

// Cut-off instant of a slot start, on the app clock.
export function slotCutOffMs(startMs: number): number {
  return startMs - SLOT_CUT_OFF_MS;
}

// Booking, moving and cancelling are allowed only while now is before start minus 2 hours.
export function pastCutOff(startMs: number, nowMs: number): boolean {
  return nowMs >= slotCutOffMs(startMs);
}

// A start is inside the bookable pattern only when it falls at a published time on an
// open day at that hub from today through 14 IST calendar days ahead.
export function slotStartFor(hub: string, dateStr: string, hhmm: string): number | null {
  const s = SLOT_STARTS.find((x) => `${x.h}:${x.m}` === hhmm);
  if (!s) return null;
  return istStartOfDay(dateStr) + s.h * 3600000 + s.m * 60000;
}

// Which published slot start, if any, an arbitrary instant falls on (same IST day).
export function slotStartAtInstant(hub: string, ms: number): { date: string; startMs: number } | null {
  const date = istDateOf(ms);
  const parts = toIst(ms);
  const minutes = parts.hour * 60 + parts.minute;
  const found = SLOT_STARTS.find((s) => s.h * 60 + s.m === minutes);
  if (!found || parts.second !== 0 || parts.ms !== 0) return null;
  if (isClosedDay(hub, date)) return null;
  return { date, startMs: istStartOfDay(date) + found.h * 3600000 + found.m * 60000 };
}

export function slotsForDay(hub: string, dateStr: string): number[] {
  if (isClosedDay(hub, dateStr)) return [];
  return SLOT_STARTS.map((s) => istStartOfDay(dateStr) + s.h * 3600000 + s.m * 60000);
}

// The bookable window: IST dates today through 14 calendar days ahead.
export function bookableDates(hub: string, nowMs: number): string[] {
  const today = istDateOf(nowMs);
  const out: string[] = [];
  for (let i = 0; i <= BOOKING_WINDOW_DAYS; i++) {
    const d = addDays(today, i);
    if (!isClosedDay(hub, d)) out.push(d);
  }
  return out;
}

// A well-formed startsAt is inside the pattern only on an open day in the window.
export function insideBookablePattern(hub: string, startMs: number, nowMs: number): boolean {
  const date = istDateOf(startMs);
  const parts = toIst(startMs);
  const minutes = parts.hour * 60 + parts.minute;
  if (!SLOT_STARTS.some((s) => s.h * 60 + s.m === minutes) || parts.second !== 0 || parts.ms !== 0) return false;
  if (isClosedDay(hub, date)) return false;
  const today = istDateOf(nowMs);
  const diff = daysBetween(today, date);
  return diff >= 0 && diff <= BOOKING_WINDOW_DAYS;
}

// ---------- delivery days ----------

export const DELIVERY_MIN_DAYS = 3;
export const DELIVERY_MAX_DAYS = 30;
export const DELIVERY_CLOSE_HOUR = 16; // each day closes for choosing at 16:00 IST the previous day
export const NORMAL_DELIVERY_CAPACITY = 4;

export function deliveryCapacity(hub: string, dateStr: string): number {
  return dateStr === "2026-11-06" ? 12 : NORMAL_DELIVERY_CAPACITY; // Dhanteras
}

// A delivery day must fall from 3 to 30 IST calendar days after the lock's IST issue date,
// on a day open at that hub.
export function insideDeliveryWindow(issueDate: string, dateStr: string): boolean {
  const diff = daysBetween(issueDate, dateStr);
  return diff >= DELIVERY_MIN_DAYS && diff <= DELIVERY_MAX_DAYS;
}

// Each day closes for choosing at 16:00 IST on the previous calendar day.
export function deliveryDayClosed(hub: string, dateStr: string, nowMs: number): boolean {
  if (isClosedDay(hub, dateStr)) return true;
  return nowMs >= istStartOfDay(dateStr) - (24 - DELIVERY_CLOSE_HOUR) * 3600000;
}

export function deliveryClosingMs(dateStr: string): number {
  return istStartOfDay(dateStr) - (24 - DELIVERY_CLOSE_HOUR) * 3600000;
}

// The 28 dates from 3 to 30 days after the lock's IST issue date, inclusive.
export function deliveryWindowDates(issueDate: string): string[] {
  const out: string[] = [];
  for (let i = DELIVERY_MIN_DAYS; i <= DELIVERY_MAX_DAYS; i++) {
    out.push(addDays(issueDate, i));
  }
  return out;
}

// ---------- licence ----------

export const MCWG = "MCWG";

// The number, after removing spaces and hyphens, is two letters then 13 digits.
export function normaliseLicence(s: string): string {
  return s.replace(/[ -]/g, "");
}

export function validLicenceNumber(s: string): boolean {
  return /^[A-Za-z]{2}\d{13}$/.test(normaliseLicence(s));
}

// licenceValidUntil must be on or after the ride's IST date.
export function licenceValidFor(licenceValidUntil: string, rideDate: string): boolean {
  return daysBetween(rideDate, licenceValidUntil) >= 0;
}

// ---------- units left ----------

export function unitsLeft(onHand: number, holds: number): number {
  return Math.max(0, onHand - holds);
}

// ---------- sessions ----------

export const SESSION_MS = 12 * 3600000;

// ---------- catalogue helpers ----------

export const ALL_MODEL_IDS = MODELS.map((m) => m.id);
export const ALL_FINISH_IDS = FINISHES.map((f) => f.id);
export const ALL_HUB_IDS = HUBS.map((h) => h.id);

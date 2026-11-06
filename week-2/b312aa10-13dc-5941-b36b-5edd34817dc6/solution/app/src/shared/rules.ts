// Domain rules shared by the server (which decides) and the browser (which quotes and offers
// only the legal actions). Each rule lives here once.

import { minutesOf, weekdayKey, type LocalDate, type LocalTime, type WeekdayKey } from "./time.js";

export type Status =
  | "held" | "confirmed" | "checked_in" | "completed" | "cancelled_free" | "cancelled_late" | "no_show" | "expired";
export type Role = "operator" | "shift_lead" | "member";
/** The brief's action names, used for `actions` and for `action` in an invalid_transition body. */
export type ManualAction = "confirm" | "cancel" | "check_in" | "check_out" | "no_show" | "move" | "release" | "waive_penalty";

export const OCCUPYING: readonly Status[] = ["held", "confirmed", "checked_in", "completed", "no_show"];
/** Bookings whose charge counts on invoices, utilisation and usage totals. */
export const COUNTED: readonly Status[] = ["confirmed", "checked_in", "completed", "no_show"];

const CHECK_IN_OPENS_MS = 60 * 60_000;
const CANCELLATION_CUTOFF_MS = 48 * 3_600_000;

export interface TransitionState {
  status: Status;
  startMs: number;
  conflict: boolean;
  penaltyWaived: boolean;
  /** The grace instant; the browser passes Infinity because the server has already applied it. */
  graceMs: number;
}

/** The 48-hour cutoff: a cancellation after cutoff (strictly later) is late. */
export function isLateCancellation(startMs: number, nowMs: number): boolean {
  return nowMs > startMs - CANCELLATION_CUTOFF_MS;
}

/** The status a manual action leads to, or null when the action is not legal right now. */
export function nextStatus(action: ManualAction, b: TransitionState, nowMs: number): Status | null {
  switch (action) {
    case "confirm":
      return b.status === "held" ? "confirmed" : null;
    case "cancel":
      if (b.status === "held") return "cancelled_free";
      if (b.status === "confirmed") return isLateCancellation(b.startMs, nowMs) ? "cancelled_late" : "cancelled_free";
      return null;
    case "release":
      return b.status === "confirmed" && b.conflict ? "cancelled_free" : null;
    case "move":
      return b.status === "confirmed" ? "confirmed" : null;
    case "check_in":
      return b.status === "confirmed" && nowMs >= b.startMs - CHECK_IN_OPENS_MS && nowMs < b.graceMs ? "checked_in" : null;
    case "no_show":
      return b.status === "confirmed" && nowMs >= b.startMs && nowMs < b.graceMs ? "no_show" : null;
    case "check_out":
      return b.status === "checked_in" ? "completed" : null;
    case "waive_penalty":
      return b.status === "cancelled_late" && !b.penaltyWaived ? "cancelled_late" : null;
  }
}

/** Which roles may attempt each manual action (others get 403 forbidden). */
export const ACTION_ROLES: Record<ManualAction, readonly Role[]> = {
  confirm: ["member"],
  cancel: ["member", "operator"],
  release: ["shift_lead", "operator"],
  move: ["shift_lead", "operator"],
  check_in: ["shift_lead", "operator"],
  check_out: ["shift_lead", "operator"],
  no_show: ["shift_lead", "operator"],
  waive_penalty: ["operator"],
};

export type OfferedAction = ManualAction;
/** The offered actions in the brief's fixed order. */
const OFFERED: readonly ManualAction[] = ["confirm", "cancel", "check_in", "check_out", "no_show", "move", "release", "waive_penalty"];

/**
 * The actions a caller may take on a booking at an instant (Business rules > Offered actions):
 * the transition table for the caller's role, ownership and the booking's status at that instant.
 * The operator cancels only confirmed bookings; a closed month leaves at most waive_penalty.
 * Checks that read other records (free time, out of service, hours, documents) are not judged here.
 */
export function offeredActions(b: TransitionState, role: Role, owner: boolean, nowMs: number, monthClosed: boolean): OfferedAction[] {
  const out: OfferedAction[] = [];
  for (const action of OFFERED) {
    if (!ACTION_ROLES[action].includes(role)) continue;
    if (role === "member" && !owner) continue;
    if (action === "cancel" && role === "operator" && b.status !== "confirmed") continue;
    if (monthClosed && action !== "waive_penalty") continue;
    if (nextStatus(action, b, nowMs) !== null) out.push(action);
  }
  return out;
}

/** Integer division rounded half away from zero (the published rounding rule). */
function divideRounded(numerator: number, denominator: number): number {
  const sign = numerator < 0 ? -1 : 1;
  const n = Math.abs(numerator);
  const q = (n - (n % denominator)) / denominator;
  return sign * (2 * (n % denominator) >= denominator ? q + 1 : q);
}

export function lateFeeCents(chargeCents: number): number {
  return divideRounded(chargeCents, 2);
}

export interface PeakWindow { days: WeekdayKey[]; start: LocalTime; end: LocalTime }
export interface HourlyRate { effectiveFrom: string; effectiveAt: string; offPeakHourlyCents: number; peakHourlyCents: number }
export interface ShelfRate { effectiveFrom: string; effectiveAt: string; shelfDayCents: number }

/**
 * The latest rate version whose effective instant is at or before the block's start instant; a
 * station has at most one version per effective instant.
 */
export function rateFor<R extends { effectiveAt: string }>(rates: readonly R[], blockStartMs: number): R | null {
  let best: R | null = null;
  for (const rate of rates) {
    const at = Date.parse(rate.effectiveAt);
    if (at <= blockStartMs && (!best || at > Date.parse(best.effectiveAt))) best = rate;
  }
  return best;
}

export type RateStatus = "past" | "current" | "scheduled";

/**
 * A rate version's status at an instant: `current` for the station's latest version in force,
 * `scheduled` for one not yet in force, `past` for every earlier one.
 */
export function rateStatus<R extends { effectiveAt: string }>(rate: R, rates: readonly R[], nowMs: number): RateStatus {
  if (Date.parse(rate.effectiveAt) > nowMs) return "scheduled";
  return rateFor(rates, nowMs) === rate ? "current" : "past";
}

interface HourlyPrice { chargeCents: number; quarters: number; peakQuarters: number }

/** Quarter hours split into peak and off-peak at the station's rates, rounded once to the cent. */
export function priceHourly(date: LocalDate, start: LocalTime, end: LocalTime, rate: HourlyRate, windows: readonly PeakWindow[]): HourlyPrice {
  const day = weekdayKey(date);
  let peakQuarters = 0;
  let quarters = 0;
  for (let t = minutesOf(start); t < minutesOf(end); t += 15) {
    quarters += 1;
    if (windows.some((w) => w.days.includes(day) && minutesOf(w.start) <= t && t + 15 <= endMinutes(w.end))) peakQuarters += 1;
  }
  const numerator = peakQuarters * rate.peakHourlyCents + (quarters - peakQuarters) * rate.offPeakHourlyCents;
  return { chargeCents: divideRounded(numerator, 4), quarters, peakQuarters };
}

export function priceShelf(days: number, rate: ShelfRate): number {
  return days * rate.shelfDayCents;
}

/** A peak window may run to 24:00, the end of the day. */
export function endMinutes(t: string): number {
  return t === "24:00" ? 1440 : minutesOf(t);
}

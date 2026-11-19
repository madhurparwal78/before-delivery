// Slots in restaurant time: the quarter-hour grid, the booking lead and the booking horizon.
import type { SlotReason } from "../../shared/api.js";
import { addDays } from "../../shared/calendar.js";
import { catalog } from "../catalog.js";
import { addMinutes } from "../clock.js";
import { lisbonDate, lisbonTime, slotInstant } from "../lisbon.js";

export function slotTimes(): string[] {
  return catalog().rules.slot_times;
}

export function isSlotTime(value: string): boolean {
  return slotTimes().includes(value);
}

interface SlotAvailability {
  bookable: boolean;
  reason: SlotReason | null;
}

/** Bookable when the start is at least 60 minutes after now (exactly 60 is allowed). */
export function slotAvailability(startsAt: Date, at: Date): SlotAvailability {
  if (startsAt <= at) return { bookable: false, reason: "past" };
  if (startsAt < addMinutes(at, catalog().rules.booking_lead_minutes)) return { bookable: false, reason: "too_late" };
  return { bookable: true, reason: null };
}

/** From today to today plus the horizon, in Lisbon. */
export function dateWithinHorizon(date: string, at: Date): boolean {
  const today = lisbonDate(at);
  return date >= today && date <= addDays(today, catalog().rules.booking_horizon_days);
}

/** The server's Lisbon time rounded down to the quarter hour, kept between the first and last slot. */
export function currentSlot(at: Date): string {
  const times = slotTimes();
  const first = times[0] ?? "";
  const last = times[times.length - 1] ?? "";
  const rounded = lisbonTime(at).replace(/(\d\d):(\d\d)/, (_, hour: string, minute: string) => {
    return `${hour}:${String(Math.floor(Number(minute) / 15) * 15).padStart(2, "0")}`;
  });
  if (rounded < first) return first;
  return rounded > last ? last : rounded;
}

/** Tonight's earliest bookable slot, or null once none is left. */
export function nextBookableSlot(at: Date): string | null {
  const today = lisbonDate(at);
  return slotTimes().find((time) => slotAvailability(slotInstant(today, time), at).bookable) ?? null;
}

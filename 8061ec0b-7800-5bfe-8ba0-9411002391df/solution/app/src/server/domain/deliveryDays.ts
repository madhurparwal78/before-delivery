// Delivery days and cutoffs: a school's delivery day D closes at 5:00 PM store time on the day before D.

import type { DeliveryDay } from "../../shared/api.js";
import { addDays, isoSecond, storeDateOf, storeWallClockInstant, weekdayOf } from "../../shared/storeTime.js";

const CUTOFF_HOUR = 17;

function cutoffOf(date: string): Date {
  return storeWallClockInstant(addDays(date, -1), CUTOFF_HOUR, 0);
}

/** The next `count` delivery days on `weekday` whose cutoff is strictly later than `at`. */
export function upcomingDeliveryDays(weekday: number, at: Date, count = 4): DeliveryDay[] {
  const days: DeliveryDay[] = [];
  for (let date = storeDateOf(at); days.length < count; date = addDays(date, 1)) {
    const cutoff = cutoffOf(date);
    if (weekdayOf(date) === weekday && cutoff.getTime() > at.getTime()) days.push({ date, cutoff_at: isoSecond(cutoff) });
  }
  return days;
}

/** The delivery day a reservation (or an exchange's successor) received at `at` gets. */
export function deliveryDateFor(weekday: number, at: Date): string {
  return upcomingDeliveryDays(weekday, at, 1)[0].date;
}

import {
  DELIVERY_CAPACITY_DHANTERAS,
  DELIVERY_CAPACITY_NORMAL,
  DELIVERY_CLOSE_HOUR_IST,
  DELIVERY_WINDOW_FROM_DAYS,
  DELIVERY_WINDOW_TO_DAYS,
  DHANTERAS_DATE,
  LOCK_EXPIRY_DAYS,
  LOCK_EXPIRY_HOUR_IST,
  RIDE_CUT_OFF_MINUTES,
  RIDE_WINDOW_DAYS,
  SLOT_MINUTES_FROM_MIDNIGHT,
  type HubId,
} from '../../shared/catalogue.js';
import {
  addIstDays,
  istDate,
  istDaysBetween,
  istInstant,
  istMinutesOfDay,
  istWeekday,
  labelDay,
  labelTimeIst,
} from '../clock.js';
import { referenceData } from '../db.js';

/** A hub's closed days, decided only here. */
export function isClosed(hub: HubId, date: string): boolean {
  const data = referenceData();
  if (data.closedWeekdays.get(hub)?.has(istWeekday(date))) return true;
  return data.closedDates.get(date)?.has(hub) ?? false;
}

/** Lock expiry: 18:00 IST on the second day after the issue date, moved past closed days. */
export function lockExpiry(hub: HubId, issuedAt: Date): Date {
  const issueDate = istDate(issuedAt);
  const base =
    istMinutesOfDay(issuedAt) >= LOCK_EXPIRY_HOUR_IST * 60 ? addIstDays(issueDate, 1) : issueDate;
  let date = addIstDays(base, LOCK_EXPIRY_DAYS);
  while (isClosed(hub, date)) date = addIstDays(date, 1);
  return istInstant(date, LOCK_EXPIRY_HOUR_IST * 60);
}

export function slotStarts(hub: HubId, date: string): Date[] {
  if (isClosed(hub, date)) return [];
  return SLOT_MINUTES_FROM_MIDNIGHT.map((minutes) => istInstant(date, minutes));
}

export function slotCutOff(startsAt: Date): Date {
  return new Date(startsAt.getTime() - RIDE_CUT_OFF_MINUTES * 60_000);
}

export function slotLabel(startsAt: Date): string {
  return labelTimeIst(startsAt);
}

export function rideDays(hub: HubId, now: Date): { date: string; dayLabel: string }[] {
  const today = istDate(now);
  const days: { date: string; dayLabel: string }[] = [];
  for (let offset = 0; offset <= RIDE_WINDOW_DAYS; offset += 1) {
    const date = addIstDays(today, offset);
    if (isClosed(hub, date)) continue;
    days.push({ date, dayLabel: labelDay(date, now) });
  }
  return days;
}

export function isDateInRideWindow(hub: HubId, date: string, now: Date): boolean {
  const delta = istDaysBetween(istDate(now), date);
  return delta >= 0 && delta <= RIDE_WINDOW_DAYS && !isClosed(hub, date);
}

/** A start is inside the bookable pattern only at a published time on an offered day. */
export function isBookableStart(hub: HubId, startsAt: Date, now: Date): boolean {
  const date = istDate(startsAt);
  if (!isDateInRideWindow(hub, date, now)) return false;
  const minutes = istMinutesOfDay(startsAt);
  if (startsAt.getTime() !== istInstant(date, minutes).getTime()) return false;
  return SLOT_MINUTES_FROM_MIDNIGHT.includes(minutes);
}

export function deliveryCapacity(date: string): number {
  return date === DHANTERAS_DATE ? DELIVERY_CAPACITY_DHANTERAS : DELIVERY_CAPACITY_NORMAL;
}

export function deliveryClosingInstant(date: string): Date {
  return istInstant(addIstDays(date, -1), DELIVERY_CLOSE_HOUR_IST * 60);
}

export function deliveryWindow(issuedAt: Date): string[] {
  const issueDate = istDate(issuedAt);
  const dates: string[] = [];
  for (let offset = DELIVERY_WINDOW_FROM_DAYS; offset <= DELIVERY_WINDOW_TO_DAYS; offset += 1) {
    dates.push(addIstDays(issueDate, offset));
  }
  return dates;
}

export function isDeliveryDateOffered(hub: HubId, issuedAt: Date, date: string): boolean {
  return deliveryWindow(issuedAt).includes(date) && !isClosed(hub, date);
}

export function isDeliveryDateClosed(hub: HubId, issuedAt: Date, date: string, now: Date): boolean {
  if (!isDeliveryDateOffered(hub, issuedAt, date)) return true;
  return now.getTime() >= deliveryClosingInstant(date).getTime();
}

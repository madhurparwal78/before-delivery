// The browser's kitchen clock. The server's time is estimated from the `now` of its latest
// /api/kitchen, /api/floor or /api/door response plus the time passed since that response arrived;
// the browser's own clock reading and zone never decide a date, button, countdown or clock text.

import type { Kitchen } from "../shared/api.js";
import { clockText, isoInZone, localDate, localMinute, zonedInstant } from "../shared/clock.js";

let reading = { server: 0, arrived: 0 };

export function observeServerTime(now: string): void {
  reading = { server: Date.parse(now), arrived: performance.now() };
}

export function kitchenNow(): number {
  return reading.server + (performance.now() - reading.arrived);
}

export function kitchenToday(k: Kitchen): string {
  return localDate(kitchenNow(), k.timeZone);
}

/** "05:00" from an ISO time that already carries the kitchen's offset. */
export function hhmm(isoTime: string): string {
  return isoTime.slice(11, 16);
}

/** The kitchen date of an ISO time with the kitchen's offset. */
export function dayOf(isoTime: string): string {
  return isoTime.slice(0, 10);
}

export function instantAt(k: Kitchen, date: string, minute: number): number {
  return zonedInstant(date, minute, k.timeZone);
}

export function isoAt(k: Kitchen, date: string, minute: number): string {
  return isoInZone(instantAt(k, date, minute), k.timeZone);
}

export function clockLine(k: Kitchen): string {
  return `Kitchen time ${clockText(localMinute(kitchenNow(), k.timeZone))} · ${k.timeZone}`;
}

/** Whole seconds left on a hold: rounded up, kept between 0 and the kitchen's hold time. */
export function holdSecondsLeft(holdExpiresAt: string, holdSeconds: number): number {
  return Math.min(holdSeconds, Math.max(0, Math.ceil((Date.parse(holdExpiresAt) - kitchenNow()) / 1000)));
}

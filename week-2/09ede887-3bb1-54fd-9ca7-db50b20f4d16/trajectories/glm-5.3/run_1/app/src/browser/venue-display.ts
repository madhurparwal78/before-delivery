/**
 * Venue-time display. Every page shows Port Ashby time whatever the browser's
 * own time zone: instants are converted with the venue zone's rules, and the
 * wall-clock times the API already carries are shown as they are.
 */

import { instantToVenueWall, venueAbbrevForDate, venueOffsetLabel, type Instant } from '../shared/venue.js';

/** `11:30 AM` for an instant, in venue time. */
export function venueClock(instant: string | Date): string {
  const ms: Instant = typeof instant === 'string' ? Date.parse(instant) : instant.getTime();
  const { wallClock } = instantToVenueWall(ms);
  return twelveHour(wallClock);
}

/** `Sat, Oct 31, 1:00 PM` for an instant, in venue time. */
export function venueStamp(instant: string | Date): string {
  const ms: Instant = typeof instant === 'string' ? Date.parse(instant) : instant.getTime();
  const { date, wallClock } = instantToVenueWall(ms);
  return `${venueWeekday(date)}, ${venueMonthDay(date)}, ${twelveHour(wallClock)}`;
}

/** `11:30 AM - 12:00 PM`, or one time when the start equals the end. */
export function venueRange(session: { start_local: string; end_local: string }): string {
  if (session.start_local === session.end_local) return wallClockText(session.start_local);
  return `${wallClockText(session.start_local)} - ${wallClockText(session.end_local)}`;
}

/** A venue wall-clock `HH:MM` shown as `11:30 AM`. */
export function wallClockText(hhmm: string): string {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  const wall = h! * 3600_000 + m! * 60_000;
  return twelveHour(wall);
}

function twelveHour(wallClock: number): string {
  const totalMinutes = Math.floor(wallClock / 60_000) % (24 * 60);
  let hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const suffix = hours < 12 ? 'AM' : 'PM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

function venueWeekday(date: string): string {
  const [y, mo, d] = date.split('-').map((x) => parseInt(x, 10));
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return names[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]!;
}

function venueMonthDay(date: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [, mo, d] = date.split('-').map((x) => parseInt(x, 10));
  return `${months[mo - 1]!} ${d}`;
}

/** The venue-time line for a day. */
export function venueLine(date: string): string {
  return `All times are Port Ashby time (${venueAbbrevForDate(date)}, UTC${venueOffsetLabel(date)}).`;
}

/** `Day 1 - Sat, Oct 31` for a day's date. */
export function dayTabLabel(date: string): string {
  return `${venueWeekday(date)}, ${venueMonthDay(date)}`;
}

/** `6,000,000` for the contest figures. */
export function grouped(value: number): string {
  return value.toLocaleString('en-US');
}

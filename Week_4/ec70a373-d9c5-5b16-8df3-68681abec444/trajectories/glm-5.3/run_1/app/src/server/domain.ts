import type { DbClient, Row } from './db.js';
import { clientQuery } from './db.js';
import { nowMs } from '../clock.js';
import { zoneDayStart, zoneInstant, datePlusDays, minutesOfInstant, dayIndexFromDate, dateFromDayIndex } from '../sitetime.js';
import { ApiError, validationError } from './errors.js';
import { isUuid, newReference, uuid } from './ids.js';
import { sanitationBufferMinutes, BOOKING_HORIZON_DAYS, HOLD_LIMIT, CHECK_IN_LEAD_MINUTES, NO_SHOW_DELAY_MINUTES } from './rules.js';
import { writeMovement, drawFromLots, returnToLots, recordBookingDraw } from './ledger.js';

export interface SiteRow extends Row {
  id: string;
  tenant_id: string;
  name: string;
  time_zone: string;
  address: string;
}

export interface StationRow extends Row {
  id: string;
  site_id: string;
  name: string;
  kind: string;
  display_order: number;
}

export interface BookingRow extends Row {
  id: string;
  tenant_id: string;
  site_id: string;
  station_id: string;
  member_id: string;
  series_id: string | null;
  reference: string;
  date: string;
  start_minute: number;
  end_minute: number;
  start_at: number;
  end_at: number;
  quarter_hours: number;
  status: string;
  hold_expires_at: number | null;
  refunded_qh: number | null;
  forfeited_qh: number | null;
  cancelled_by_name: string | null;
  cancellation_reason: string | null;
  checked_in_at: number | null;
  checked_in_by_name: string | null;
  no_show_by_name: string | null;
  checked_out_at: number | null;
  checked_out_by_name: string | null;
  late_qh: number | null;
  pack_applied_qh: number | null;
  overage: unknown;
  created_at: number;
}

export async function loadSite(client: DbClient, siteId: string): Promise<SiteRow | null> {
  if (!isUuid(siteId)) return null;
  const rows = await clientQuery<SiteRow>(client, `SELECT * FROM sites WHERE id = $1`, [siteId]);
  return rows[0] ?? null;
}

export async function loadStation(client: DbClient, stationId: string): Promise<StationRow | null> {
  if (!isUuid(stationId)) return null;
  const rows = await clientQuery<StationRow>(client, `SELECT * FROM stations WHERE id = $1`, [stationId]);
  return rows[0] ?? null;
}

export async function loadBooking(client: DbClient, bookingId: string): Promise<BookingRow | null> {
  if (!isUuid(bookingId)) return null;
  const rows = await clientQuery<BookingRow>(client, `SELECT * FROM bookings WHERE id = $1`, [bookingId]);
  return rows[0] ?? null;
}

/** The site-local date of the server clock. */
export function siteLocalDate(site: SiteRow, atMs: number): string {
  return dateFromInstantInZone(atMs, site.time_zone);
}

export function dateFromInstantInZone(atMs: number, zone: string): string {
  // Finding the site-local date of an instant with a short scan from the UTC day.
  const utcDate = new Date(atMs).toISOString().slice(0, 10);
  for (const candidate of [datePlusDays(utcDate, -1), utcDate, datePlusDays(utcDate, 1)]) {
    const start = zoneDayStart(candidate, zone);
    const next = zoneDayStart(datePlusDays(candidate, 1), zone);
    if (atMs >= start && atMs < next) return candidate;
  }
  return utcDate;
}

/** The minutes into the site-local day of an instant. */
export function minutesIntoSiteDay(site: SiteRow, atMs: number): number {
  const date = dateFromInstantInZone(atMs, site.time_zone);
  const start = zoneDayStart(date, site.time_zone);
  return Math.floor((atMs - start) / 60000);
}

/**
 * The next-day cutoff: bookings are refused for the site's current or an earlier date,
 * and for the site's next date once the site clock reaches 18:00.
 */
export function cutoffRefusal(site: SiteRow, date: string, atMs: number): boolean {
  const today = dateFromInstantInZone(atMs, site.time_zone);
  const todayIndex = dayIndexFromDate(today);
  const targetIndex = dayIndexFromDate(date);
  if (targetIndex <= todayIndex) return true;
  if (targetIndex === todayIndex + 1) {
    const start = zoneDayStart(today, site.time_zone);
    const minutes = Math.floor((atMs - start) / 60000);
    if (minutes >= 18 * 60) return true;
  }
  return false;
}

export function pastHorizon(site: SiteRow, date: string, atMs: number): boolean {
  const todayIndex = dayIndexFromDate(dateFromInstantInZone(atMs, site.time_zone));
  return dayIndexFromDate(date) > todayIndex + BOOKING_HORIZON_DAYS;
}

/** A member's valid-through certificate of insurance date, if any. */
export async function certificateValidThrough(client: DbClient, memberId: string): Promise<string | null> {
  const rows = await clientQuery<Row>(
    client,
    `SELECT GREATEST(u.coi_valid_through, (SELECT MAX(d.expiry_date) FROM documents d
        WHERE d.member_id = u.id AND d.type = 'certificate_of_insurance' AND d.status = 'verified')) AS valid_through
       FROM users u WHERE u.id = $1`,
    [memberId],
  );
  if (rows.length === 0) return null;
  const value = rows[0].valid_through;
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/** The certificate is valid now, and covers the booked date. */
export function certificateCovers(validThrough: string | null, siteZone: string, bookingDate: string, atMs: number): boolean {
  if (!validThrough) return false;
  const today = dateFromInstantInZone(atMs, siteZone);
  if (today > validThrough) return false;
  return bookingDate <= validThrough;
}

export function insuranceCoverageDates(
  validThrough: string | null,
  siteZone: string,
  dates: string[],
  atMs: number,
): string[] {
  if (!validThrough) return [...dates];
  const today = dateFromInstantInZone(atMs, siteZone);
  if (today > validThrough) return [...dates];
  return dates.filter((date) => date > validThrough);
}

/** The occupied span of a booking: its window plus the station's sanitation buffer. */
export function occupiedSpan(booking: BookingRow, bufferMinutes: number): { start: number; end: number } {
  return { start: Number(booking.start_at), end: Number(booking.end_at) + bufferMinutes * 60000 };
}

export function spansOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Live holds and confirmed or checked-in bookings occupy their station. */
export async function conflictsForWindow(
  client: DbClient,
  stationId: string,
  stationKind: string,
  window: { startAt: number; endAt: number },
  excludeBookingId?: string,
): Promise<BookingRow[]> {
  const bufferMs = sanitationBufferMinutes(stationKind) * 60000;
  const windowSpan = { start: window.startAt, end: window.endAt + bufferMs };
  const rows = await clientQuery<BookingRow>(
    client,
    `SELECT * FROM bookings WHERE station_id = $1 AND status IN ('held','confirmed','checked_in')`,
    [stationId],
  );
  const at = nowMs();
  const conflicts: BookingRow[] = [];
  for (const row of rows) {
    if (excludeBookingId && row.id === excludeBookingId) continue;
    if (row.status === 'held' && row.hold_expires_at !== null && Number(row.hold_expires_at) <= at) continue;
    if (spansOverlap(windowSpan, occupiedSpan(row, bufferMs))) conflicts.push(row);
  }
  return conflicts;
}

export interface ClaimWindow {
  date: string;
  startMinute: number;
  endMinute: number;
}

export function parseWindow(date: string, start: string, end: string): ClaimWindow {
  const dateMatch = /^\d{4}-\d{2}-\d{2}$/.exec(date);
  if (!dateMatch) throw validationError({ date: 'Enter a site-local date.' });
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
    throw validationError({ start: 'Pick quarter-hour times.', end: 'Pick quarter-hour times.' });
  }
  const startMinute = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5));
  const endMinuteRaw = Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5));
  if (startMinute % 15 !== 0 || endMinuteRaw % 15 !== 0) {
    throw validationError({ start: 'Pick quarter-hour times.', end: 'Pick quarter-hour times.' });
  }
  if (end === '24:00') {
    if (startMinute >= 1440) throw validationError({ start: 'Pick quarter-hour times.' });
    return { date, startMinute, endMinute: 1440 };
  }
  if (endMinuteRaw <= startMinute) {
    throw validationError({ end: 'The end must be after the start.' });
  }
  return { date, startMinute, endMinute: endMinuteRaw };
}

/** Wall-time resolution of a window, following the missing-and-repeated rule. */
export function resolveWindow(
  site: SiteRow,
  window: ClaimWindow,
): { startAt: number; endAt: number; quarterHours: number } {
  const zone = site.time_zone;
  const startAt = zoneInstant(window.date, zone, window.startMinute);
  const endAt = window.endMinute >= 1440
    ? zoneDayStart(datePlusDays(window.date, 1), zone)
    : zoneInstant(window.date, zone, window.endMinute);
  const quarterHours = Math.ceil((endAt - startAt) / 900000);
  return { startAt, endAt, quarterHours };
}

/** The missing hour of a spring-forward day, in site-local minutes. */
/** The missing local minutes of a spring-forward day, as [from, to) pairs. */
export function missingHourMinutes(site: SiteRow, date: string): Array<[number, number]> {
  const zone = site.time_zone;
  const gaps: Array<[number, number]> = [];
  let minute = 0;
  while (minute < 1440) {
    const instant = zoneInstant(date, zone, minute);
    const localMinute = minutesOfInstant(instant, zone) % 1440;
    if (localMinute > minute) {
      gaps.push([minute, localMinute]);
      minute = localMinute;
    } else {
      minute += 15;
    }
  }
  return gaps.filter((gap) => gap[1] > gap[0]);
}

export async function nextReference(client: DbClient, tenantId: string): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const reference = newReference();
    const existing = await clientQuery<Row>(
      client,
      `SELECT id FROM bookings WHERE tenant_id = $1 AND reference = $2`,
      [tenantId, reference],
    );
    if (existing.length === 0) return reference;
  }
  throw new Error('reference space exhausted');
}

export async function liveHolds(client: DbClient, memberId: string, atMs: number): Promise<BookingRow[]> {
  const rows = await clientQuery<BookingRow>(
    client,
    `SELECT * FROM bookings WHERE member_id = $1 AND status = 'held'`,
    [memberId],
  );
  return rows.filter((row) => row.hold_expires_at === null || Number(row.hold_expires_at) > atMs);
}

export async function expiredHoldsForStation(
  client: DbClient,
  stationId: string,
  atMs: number,
): Promise<BookingRow[]> {
  const rows = await clientQuery<BookingRow>(
    client,
    `SELECT * FROM bookings WHERE station_id = $1 AND status = 'held' AND hold_expires_at IS NOT NULL AND hold_expires_at <= $2`,
    [stationId, atMs],
  );
  return rows;
}

export interface HoldResult {
  booking: BookingRow;
}

/** One member's requests are serialised per member. */
const memberLocks = new Map<string, Promise<unknown>>();

export async function withMemberLock<T>(memberId: string, work: () => Promise<T>): Promise<T> {
  const previous = memberLocks.get(memberId) ?? Promise.resolve();
  const next = previous.then(work, work);
  memberLocks.set(memberId, next);
  try {
    return await next;
  } finally {
    if (memberLocks.get(memberId) === next) memberLocks.delete(memberId);
  }
}


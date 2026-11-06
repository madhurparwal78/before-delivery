import {
  addDays,
  isoInstant,
  kitchenToday,
  localInstant,
  minutesToHHMM,
  resolveWall,
  wallClock,
} from "./kitchenTime.js";
import { priceBooking } from "./pricing.js";
import { isUniqueViolation, rows, type Tx } from "./db.js";
import type { PriceSettings } from "../shared/hourPrice.js";
import { queueNotification, emailSubjects } from "./notify.js";

// Bookings: holds, series, confirmation, cancellation and displacement.
// One winner per slot (DP-19) is enforced by the station_occupancy exclusion
// constraint; everything here runs inside one transaction.

export type BookingSettings = PriceSettings & {
  bufferMinutes: number;
  overageUsdPerHour: number;
};

export type BookingInsert = {
  stationId: string;
  renterId: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  settings: BookingSettings;
  holdExpiresAt: Date | null;
  now: Date;
  seriesId: string;
};

export const settingsForDate = async (
  tx: Tx,
  stationId: string,
  date: string,
): Promise<BookingSettings | null> => {
  const found = await rows<{
    hour_weight: number;
    off_peak_percent: number;
    overage_usd_per_hour: string;
    buffer_minutes: number;
  }>(
    tx,
    `select hour_weight, off_peak_percent, overage_usd_per_hour::text, buffer_minutes
     from station_settings
     where station_id = $1 and effective_from <= $2
     order by effective_from desc limit 1`,
    [stationId, date],
  );
  if (found.length === 0) return null;
  const row = found[0]!;
  return {
    hourWeight: row.hour_weight,
    offPeakPercent: row.off_peak_percent,
    overageUsdPerHour: Number(row.overage_usd_per_hour),
    bufferMinutes: row.buffer_minutes,
  };
};

export const nextWeekDate = (date: string): string => addDays(date, 7);

export type OccConflict = {
  code: "slot_conflict";
  date: string;
  legal_end: string | null;
  blocked_by: "booking" | "buffer" | "maintenance";
  blocked_at: string;
};

export type BookingCreateError =
  | { code: "slot_conflict"; date: string; legal_end: string | null; blocked_by: "booking" | "buffer" | "maintenance"; blocked_at: string }
  | { code: "insufficient_hours"; balanceMinutes: number; neededMinutes: number };

export type BookingRow = {
  id: string;
  series_id: string;
  station_id: string;
  station_name: string;
  renter_id: string;
  status: string;
  date: string;
  start: string;
  end: string;
  starts_at: string;
  ends_at: string;
  buffer_minutes: number;
  buffer_ends_at: string;
  hour_weight: number;
  off_peak_percent: number;
  overage_usd_per_hour: string;
  minutes_debited: number;
  hold_expires_at: string | null;
  cancellation_cutoff_at: string;
  actual_start: string | null;
  actual_end: string | null;
  overage_units: number | null;
  overage_usd: string | null;
  created_at: string;
};

// The live status of a hold as the server's clock sees it. Takes any row shape
// so both typed rows and raw query records can be checked in one place.
export const effectiveStatus = (
  row: { status?: unknown; hold_expires_at?: unknown },
  now: Date,
): string => {
  const status = String(row.status ?? "");
  if (status === "hold") {
    const raw = row.hold_expires_at as string | Date | null | undefined;
    const expires = raw ? new Date(raw) : null;
    if (!expires || expires.getTime() <= now.getTime()) return "expired";
  }
  return status;
};

export const displayBooking = (row: Record<string, unknown>, now: Date): BookingRow => {
  const status = effectiveStatus(row, now);
  const rawDate = row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date);
  const date = rawDate.length > 10 ? rawDate.slice(0, 10) : rawDate;
  const startMin = row.start_min as number;
  const endMin = row.end_min as number;
  return {
    id: row.id as string,
    series_id: row.series_id as string,
    station_id: row.station_id as string,
    station_name: row.station_name as string,
    renter_id: row.renter_id as string,
    status,
    date,
    start: minutesToHHMM(startMin),
    end: minutesToHHMM(endMin),
    starts_at: isoInstant(new Date(row.starts_at as string)),
    ends_at: isoInstant(new Date(row.ends_at as string)),
    buffer_minutes: row.buffer_minutes as number,
    buffer_ends_at: isoInstant(new Date(row.buffer_ends_at as string)),
    hour_weight: row.hour_weight as number,
    off_peak_percent: row.off_peak_percent as number,
    overage_usd_per_hour: (row.overage_usd_per_hour as string) ?? String(row.overage_usd_per_hour ?? "0"),
    minutes_debited: row.minutes_debited as number,
    hold_expires_at: row.hold_expires_at ? isoInstant(new Date(row.hold_expires_at as string)) : null,
    cancellation_cutoff_at: isoInstant(new Date(row.cancellation_cutoff_at as string)),
    actual_start: (row.actual_start as string) ?? null,
    actual_end: (row.actual_end as string) ?? null,
    overage_units: (row.overage_units as number) ?? null,
    overage_usd: row.overage_usd ? String(row.overage_usd) : null,
    created_at: isoInstant(new Date(row.created_at as string)),
  };
};

// Wall-clock slot validation across DST (DP-24). Returns an error message for
// the field that carries it.
export const validateWallTimes = (date: string, startMinutes: number, endMinutes: number): string | null => {
  if (endMinutes <= startMinutes) return "End must be after start.";
  const startWall = resolveWall(date, startMinutes);
  const endWall = endMinutes === 1440 ? { first: localInstant(addDays(date, 1), 0) } : resolveWall(date, endMinutes);
  if (!startWall) return `That time does not exist on ${date} in the kitchen's time zone.`;
  if (!endWall || !endWall.first) return `That time does not exist on ${date} in the kitchen's time zone.`;
  return null;
};

// Converts a request into the series of weeks it names.
export const seriesDates = (date: string, repeatWeeks: number): string[] => {
  const dates: string[] = [];
  let cursor = date;
  for (let week = 0; week < repeatWeeks; week++) {
    dates.push(cursor);
    cursor = nextWeekDate(cursor);
  }
  return dates;
};

export const totalSeriesMinutes = (
  dates: readonly string[],
  startMinutes: number,
  endMinutes: number,
  settings: BookingSettings,
): number => {
  let total = 0;
  for (const date of dates) {
    const start = localInstant(date, startMinutes);
    const end = endMinutes === 1440 ? localInstant(addDays(date, 1), 0) : localInstant(date, endMinutes);
    if (!start || !end) continue;
    total += priceBooking(start, end, settings);
  }
  return total;
};

export const occupancyErrorOf = (err: unknown, stationId: string): boolean => isUniqueViolation(err, "station_occupancy_pkey");

export const queueDisplacementEmail = async (
  tx: Tx,
  to: string,
  stationName: string,
  date: string,
  reason: string,
  hours: number,
): Promise<void> => {
  await queueNotification(
    tx,
    "booking_displaced",
    to,
    emailSubjects.bookingDisplaced(stationName, date),
    `${stationName} is out of service on ${date}: ${reason}. ${hours.toFixed(2)} hours returned to your balance.`,
  );
};

export const todayOrThrow = (now: Date): string => kitchenToday(now);


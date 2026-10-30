// The library's seeded settings: calendar, late-fee schedule and borrowing limit. They arrive as seed data
// and are never edited, so they are read from PostgreSQL once at start.

import type { LateFeeRate, LibrarySettings } from "../../shared/api.js";
import { type LibraryCalendar, localDate, type Weekday } from "../../shared/calendar.js";
import { config } from "../config.js";
import { pool } from "../db.js";
import { rateOn } from "./latefee.js";

interface Library {
  name: string;
  calendar: LibraryCalendar;
  openingTime: string;
  schedule: LateFeeRate[];
  maxActivePerMember: number;
}

let loaded: Library | undefined;

export async function loadLibrary(): Promise<void> {
  const settings = await pool.query<{
    name: string;
    time_zone: string;
    open_days: Weekday[];
    opening_time: string;
    closing_time: string;
    max_active_per_member: number;
  }>("SELECT name, time_zone, open_days, opening_time, closing_time, max_active_per_member FROM library WHERE id = 1");
  const closed = await pool.query<{ day: string }>("SELECT day FROM closure_date ORDER BY day");
  const rates = await pool.query<LateFeeRate>("SELECT effective_from, cents_per_day FROM late_fee_rate ORDER BY effective_from");
  const row = settings.rows[0];
  if (!row) throw new Error("library settings are missing");
  loaded = {
    name: row.name,
    calendar: {
      timeZone: row.time_zone,
      openDays: row.open_days,
      closedDates: closed.rows.map((r) => r.day),
      closingTime: row.closing_time,
    },
    openingTime: row.opening_time,
    schedule: rates.rows,
    maxActivePerMember: row.max_active_per_member,
  };
}

export function library(): Library {
  if (!loaded) throw new Error("library settings are not loaded");
  return loaded;
}

/** Today's date in library time. */
export function today(now: Date): string {
  return localDate(now, library().calendar.timeZone);
}

export function librarySettings(now: Date): LibrarySettings {
  const lib = library();
  return {
    name: lib.name,
    time_zone: lib.calendar.timeZone,
    open_days: [...lib.calendar.openDays],
    closed_dates: [...lib.calendar.closedDates],
    opening_time: lib.openingTime,
    closing_time: lib.calendar.closingTime,
    late_fee_schedule: lib.schedule,
    late_fee_cents_per_day: rateOn(lib.schedule, today(now)),
    max_active_per_member: lib.maxActivePerMember,
    pickup_window_seconds: config.pickupWindowSeconds,
  };
}

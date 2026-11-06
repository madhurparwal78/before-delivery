// Stations, their effective-dated settings and the board's blocks for one kitchen day.

import type { BlockView, StationSettingsView, StationView, StationsResponse } from "../../shared/api.js";
import { KITCHEN_TIME_ZONE, MINUTES_PER_DAY, existingWallClockInstant, formatHHMM, isIsoDate } from "../../shared/kitchenTime.js";
import { formatCents } from "../../shared/hours.js";
import { iso, kitchenToday, now } from "../clock.js";
import { type Db, only, pool, rows } from "../db.js";
import type { JsonObject } from "../http/body.js";
import { FieldErrors, invalid } from "../http/errors.js";
import type { Caller } from "../http/session.js";
import { isStaff } from "../http/session.js";
import type { BookingStatus } from "../../shared/api.js";
import { occupiesStation, statusAt } from "../../shared/bookingStatus.js";

interface StationRow {
  id: string;
  name: string;
  position: number;
}

interface SettingsRow {
  station_id: string;
  effective_from: string;
  hour_weight: number;
  off_peak_percent: number;
  overage_cents_per_hour: number;
  buffer_minutes: number;
}

function settingsView(row: SettingsRow): StationSettingsView {
  return {
    station_id: row.station_id,
    effective_from: row.effective_from,
    hour_weight: row.hour_weight,
    off_peak_percent: row.off_peak_percent,
    overage_usd_per_hour: formatCents(row.overage_cents_per_hour),
    buffer_minutes: row.buffer_minutes,
  };
}

/** The settings row with the latest effective date on or before `date`: what a booking created then gets. */
function inForce(own: readonly SettingsRow[], date: string): SettingsRow {
  const row = own.filter((settings) => settings.effective_from <= date).at(-1);
  if (!row) throw new Error(`no station settings in force on ${date}`);
  return row;
}

export async function settingsInForce(db: Db, stationId: string, date: string): Promise<SettingsRow> {
  return inForce(await rows<SettingsRow>(db, "SELECT * FROM station_settings WHERE station_id = $1 ORDER BY effective_from", [stationId]), date);
}

function stationsInOrder(db: Db): Promise<StationRow[]> {
  return rows<StationRow>(db, "SELECT * FROM stations ORDER BY position");
}

/** The kitchen day [00:00, 24:00) as instants. */
function dayBounds(date: string): { from: number; to: number } {
  return { from: existingWallClockInstant(date, 0), to: existingWallClockInstant(date, MINUTES_PER_DAY) };
}

interface BlockRow {
  station_id: string;
  status: BookingStatus | null;
  hold_expires_at: Date | null;
  start_minute: number;
  end_minute: number;
  starts_at: Date;
  ends_at: Date;
  occupied_end: Date;
  renter_id: string | null;
  booking_id: string | null;
  business_name: string | null;
}

/** Every hold, confirmed/checked-in/completed booking and maintenance block whose occupied time touches the day. */
async function blocksOn(db: Db, date: string, caller: Caller): Promise<Map<string, BlockView[]>> {
  const { from, to } = dayBounds(date);
  const found = await rows<BlockRow>(
    db,
    `SELECT o.station_id, b.status, b.hold_expires_at,
            COALESCE(b.start_minute, m.start_minute) AS start_minute, COALESCE(b.end_minute, m.end_minute) AS end_minute,
            COALESCE(b.starts_at, m.starts_at) AS starts_at, COALESCE(b.ends_at, m.ends_at) AS ends_at,
            upper(o.occupied) AS occupied_end, b.renter_id, b.id AS booking_id, r.business_name
       FROM station_occupancy o
       LEFT JOIN bookings b ON b.id = o.booking_id
       LEFT JOIN renters r ON r.id = b.renter_id
       LEFT JOIN maintenance_blocks m ON m.id = o.maintenance_block_id
      WHERE o.occupied && tstzrange($1, $2)
      ORDER BY starts_at`,
    [iso(from), iso(to)],
  );
  const at = now();
  const byStation = new Map<string, BlockView[]>();
  for (const row of found) {
    const status = row.status && row.hold_expires_at ? statusAt(row.status, row.hold_expires_at.getTime(), at) : null;
    if (status !== null && !occupiesStation(status)) continue;
    const mine = row.renter_id !== null && row.renter_id === caller.renterId;
    const visible = isStaff(caller) || mine;
    const block: BlockView = {
      kind: status === null ? "maintenance" : status === "hold" ? "hold" : "booking",
      start: formatHHMM(row.start_minute),
      end: formatHHMM(row.end_minute),
      starts_at: iso(row.starts_at),
      ends_at: iso(row.ends_at),
      buffer_ends_at: iso(row.occupied_end),
      mine,
      booking_id: visible ? row.booking_id : null,
      renter_business_name: visible ? row.business_name : null,
    };
    byStation.set(row.station_id, [...(byStation.get(row.station_id) ?? []), block]);
  }
  return byStation;
}

export async function stationsForDay(caller: Caller, requested: string | null): Promise<StationsResponse> {
  const today = kitchenToday();
  if (requested !== null && !isIsoDate(requested)) throw invalid({ date: "Use a date like 2026-11-07." });
  const date = requested ?? today;
  const [stations, blocks, settings] = await Promise.all([
    stationsInOrder(pool),
    blocksOn(pool, date, caller),
    rows<SettingsRow>(pool, "SELECT * FROM station_settings ORDER BY station_id, effective_from"),
  ]);
  const views: StationView[] = stations.map((station) => {
    const own = settings.filter((row) => row.station_id === station.id);
    const current = settingsView(inForce(own, today));
    return {
      id: station.id,
      name: station.name,
      hour_weight: current.hour_weight,
      off_peak_percent: current.off_peak_percent,
      overage_usd_per_hour: current.overage_usd_per_hour,
      buffer_minutes: current.buffer_minutes,
      upcoming_settings: own.filter((row) => row.effective_from > today).map(settingsView),
      blocks: blocks.get(station.id) ?? [],
    };
  });
  return { date, time_zone: KITCHEN_TIME_ZONE, server_now: iso(now()), stations: views };
}

const WEIGHTS = [1, 2, 3];
const OFF_PEAK_PERCENTS = [50, 60, 70, 80, 90, 100];

/** Parses a money string from 0.00 to 500.00 into cents. */
function cents(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,3}\.\d{2}$/.test(value)) return null;
  const [whole, fraction] = value.split(".");
  const total = Number(whole) * 100 + Number(fraction);
  return total <= 50_000 ? total : null;
}

export async function saveSettings(stationId: string, body: JsonObject): Promise<StationSettingsView> {
  const errors = new FieldErrors();
  const effectiveFrom = typeof body.effective_from === "string" ? body.effective_from : "";
  if (!isIsoDate(effectiveFrom) || effectiveFrom < kitchenToday()) errors.add("effective_from", "Choose today or a later date.");
  const weight = body.hour_weight;
  if (typeof weight !== "number" || !WEIGHTS.includes(weight)) errors.add("hour_weight", "Hour weight is 1, 2 or 3.");
  const percent = body.off_peak_percent;
  if (typeof percent !== "number" || !OFF_PEAK_PERCENTS.includes(percent)) errors.add("off_peak_percent", "Off-peak percent is 50, 60, 70, 80, 90 or 100.");
  const overage = cents(body.overage_usd_per_hour);
  if (overage === null) errors.add("overage_usd_per_hour", "Enter an amount from 0.00 to 500.00.");
  const buffer = body.buffer_minutes;
  if (typeof buffer !== "number" || !Number.isInteger(buffer) || buffer < 0 || buffer > 120 || buffer % 15 !== 0) {
    errors.add("buffer_minutes", "Buffer is 0 to 120 minutes in steps of 15.");
  }
  if (!errors.empty) throw errors.error();
  const saved = await only<SettingsRow>(
    pool,
    `INSERT INTO station_settings (station_id, effective_from, hour_weight, off_peak_percent, overage_cents_per_hour, buffer_minutes)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (station_id, effective_from) DO UPDATE SET hour_weight = EXCLUDED.hour_weight,
       off_peak_percent = EXCLUDED.off_peak_percent, overage_cents_per_hour = EXCLUDED.overage_cents_per_hour,
       buffer_minutes = EXCLUDED.buffer_minutes
     RETURNING *`,
    [stationId, effectiveFrom, weight, percent, overage, buffer],
  );
  return settingsView(saved);
}


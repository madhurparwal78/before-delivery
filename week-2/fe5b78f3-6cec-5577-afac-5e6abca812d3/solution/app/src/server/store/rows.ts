// Row shapes read from Postgres, and the queries that load one booking.
import type { PoolClient, Pool } from "pg";
import type { ClassCode, FareLine, Gender, BerthPreference, PassengerStatus, Quota, StatusCode } from "../../shared/api.js";
import { VERSION_STEP } from "../domain/version.js";
import { notFound } from "../http/errors.js";

export type Db = Pool | PoolClient;

export interface BookingRow {
  pnr: string;
  account_id: string;
  email: string;
  train: string;
  run_date: string;
  class: ClassCode;
  quota: Quota;
  from_code: string;
  to_code: string;
  from_seq: number;
  to_seq: number;
  keep_in_one_coach: boolean;
  lower_berth_only: boolean;
  contact_phone: string;
  total_paise: number;
  fare_lines: FareLine[];
  version: number;
  chart_recorded: boolean;
  kb_payment_id: string;
}

export interface PassengerRow {
  pnr: string;
  number: number;
  name: string;
  age: number;
  gender: Gender;
  berth_preference: BerthPreference;
  fare_paise: number;
  booking_status: PassengerStatus;
  status: StatusCode;
  position: number | null;
  coach: string | null;
  berth: number | null;
  rac_place: number | null;
  queue_seq: number | null;
}

const BOOKING_COLUMNS = `b.pnr, b.account_id, a.email, b.train, b.run_date, b.class, b.quota, b.from_code, b.to_code,
  b.from_seq, b.to_seq, b.keep_in_one_coach, b.lower_berth_only, b.contact_phone, b.total_paise, b.fare_lines,
  b.version, b.chart_recorded, b.kb_payment_id`;

export async function bookingRow(db: Db, pnr: string, lock = false): Promise<BookingRow | undefined> {
  const { rows } = await db.query<BookingRow>(
    `SELECT ${BOOKING_COLUMNS} FROM bookings b JOIN accounts a ON a.id = b.account_id WHERE b.pnr = $1${lock ? " FOR UPDATE OF b" : ""}`,
    [pnr],
  );
  return rows[0];
}

/** Another account's PNR answers exactly as a PNR that does not exist (brief: DP-07). */
export async function ownedBookingRow(db: Db, pnr: string, accountId: string): Promise<BookingRow> {
  const row = /^\d{10}$/.test(pnr) ? await bookingRow(db, pnr) : undefined;
  if (!row || row.account_id !== accountId) throw notFound();
  return row;
}

export async function bookingsOnRun(db: Db, train: string, runDate: string): Promise<BookingRow[]> {
  const { rows } = await db.query<BookingRow>(
    `SELECT ${BOOKING_COLUMNS} FROM bookings b JOIN accounts a ON a.id = b.account_id
      WHERE b.train = $1 AND b.run_date = $2 ORDER BY b.seq`,
    [train, runDate],
  );
  return rows;
}

export async function passengerRows(db: Db, pnr: string): Promise<PassengerRow[]> {
  const { rows } = await db.query<PassengerRow>("SELECT * FROM passengers WHERE pnr = $1 ORDER BY number", [pnr]);
  return rows;
}

/** Every event on a PNR raises its version through here. */
export async function bumpVersion(db: Db, pnr: string): Promise<void> {
  await db.query("UPDATE bookings SET version = version + $2 WHERE pnr = $1", [pnr, VERSION_STEP]);
}

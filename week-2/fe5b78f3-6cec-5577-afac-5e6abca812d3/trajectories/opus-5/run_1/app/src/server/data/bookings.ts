import type { Database, Transaction } from '../db/pool';
import type { BerthPreference, Quota, TravelClass } from '../domain/berths';
import type { Gender } from '../domain/allotment';
import type { DeductionBand } from '../domain/bands';
import type { FareLine } from '../domain/fare';
import type { Paise } from '../domain/money';
import type { PassengerStatus } from '../domain/status';

export interface BookingRecord {
  readonly pnr: string;
  readonly account_id: string;
  readonly train_number: string;
  readonly run_date: string;
  readonly travel_class: TravelClass;
  readonly quota: Quota;
  readonly from_code: string;
  readonly to_code: string;
  readonly from_seq: number;
  readonly to_seq: number;
  readonly keep_in_one_coach: boolean;
  readonly lower_berth_only: boolean;
  readonly contact_phone: string;
  readonly total_paise: Paise;
  readonly fare_lines: readonly FareLine[];
  readonly version: number;
  readonly chart_applied: boolean;
  readonly killbill_payment_id: string | null;
  readonly created_at: Date;
}

export interface PassengerRecord {
  readonly pnr: string;
  readonly number: number;
  readonly name: string;
  readonly age: number;
  readonly gender: Gender;
  readonly berth_preference: BerthPreference;
  readonly fare_paise: Paise;
  readonly booking_status: PassengerStatus;
  readonly current_status: PassengerStatus;
}

export interface HistoryRecord {
  readonly pnr: string;
  readonly passenger_number: number;
  readonly at: Date;
  readonly from_label: string;
  readonly to_label: string;
}

export interface CancellationPassenger {
  readonly number: number;
  readonly band: DeductionBand;
  readonly charge_paise: Paise;
  readonly gst_paise: Paise;
  readonly deduction_paise: Paise;
  readonly refund_paise: Paise;
}

export interface CancellationRecord {
  readonly pnr: string;
  readonly number: number;
  readonly requested_at: Date;
  readonly refund_paise: Paise;
  readonly passengers: readonly CancellationPassenger[];
}

export interface RefundRecord {
  readonly pnr: string;
  readonly number: number;
  readonly reason: 'cancellation' | 'chart';
  readonly refund_paise: Paise;
  readonly status: 'pending' | 'issued';
  readonly issued_at: Date | null;
}

export interface TicketRecord {
  readonly pnr: string;
  readonly version: number;
  readonly kind: 'booked' | 'cancellation' | 'chart';
  readonly created_at: Date;
  readonly stored: boolean;
  readonly object_key: string;
  readonly etag: string | null;
}

const BOOKING_COLUMNS = `pnr, account_id, train_number, run_date::text as run_date, travel_class,
  quota, from_code, to_code, from_seq, to_seq, keep_in_one_coach, lower_berth_only, contact_phone,
  total_paise, fare_lines, version, chart_applied, killbill_payment_id, created_at`;

export async function findBooking(
  database: Database | Transaction,
  pnr: string,
): Promise<BookingRecord | null> {
  const rows = await database.query<BookingRecord>(
    `select ${BOOKING_COLUMNS} from bookings where pnr = $1`,
    [pnr],
  );
  return rows[0] ?? null;
}

export async function listAccountBookings(
  database: Database,
  accountId: string,
): Promise<BookingRecord[]> {
  return database.query<BookingRecord>(
    `select ${BOOKING_COLUMNS} from bookings where account_id = $1 order by created_at desc, pnr desc`,
    [accountId],
  );
}

export async function loadPassengers(
  database: Database | Transaction,
  pnr: string,
): Promise<PassengerRecord[]> {
  return database.query<PassengerRecord>(
    `select pnr, number, name, age, gender, berth_preference, fare_paise,
            booking_status, current_status
     from passengers where pnr = $1 order by number`,
    [pnr],
  );
}

export async function loadHistory(
  database: Database | Transaction,
  pnr: string,
): Promise<HistoryRecord[]> {
  return database.query<HistoryRecord>(
    `select pnr, passenger_number, at, from_label, to_label
     from passenger_history where pnr = $1 order by id`,
    [pnr],
  );
}

export async function loadCancellations(
  database: Database | Transaction,
  pnr: string,
): Promise<CancellationRecord[]> {
  return database.query<CancellationRecord>(
    `select pnr, number, requested_at, refund_paise, passengers
     from cancellations where pnr = $1 order by number`,
    [pnr],
  );
}

export async function loadRefunds(
  database: Database | Transaction,
  pnr: string,
): Promise<RefundRecord[]> {
  return database.query<RefundRecord>(
    `select pnr, number, reason, refund_paise, status, issued_at
     from refunds where pnr = $1 order by number`,
    [pnr],
  );
}

export async function loadTickets(
  database: Database | Transaction,
  pnr: string,
): Promise<TicketRecord[]> {
  return database.query<TicketRecord>(
    `select pnr, version, kind, created_at, stored, object_key, etag
     from tickets where pnr = $1 order by version`,
    [pnr],
  );
}

/** Each event raises the PNR's version by exactly one. */
export async function bumpVersion(tx: Transaction, pnr: string): Promise<void> {
  await tx.query('update bookings set version = version + 1 where pnr = $1', [pnr]);
}

export async function recordHistory(
  tx: Transaction,
  pnr: string,
  passengerNumber: number,
  at: number,
  fromLabel: string,
  toLabel: string,
): Promise<void> {
  await tx.query(
    `insert into passenger_history (pnr, passenger_number, at, from_label, to_label)
     values ($1, $2, to_timestamp($3 / 1000.0), $4, $5)`,
    [pnr, passengerNumber, at, fromLabel, toLabel],
  );
}

export async function setCurrentStatus(
  tx: Transaction,
  pnr: string,
  passengerNumber: number,
  status: PassengerStatus,
): Promise<void> {
  await tx.query(
    'update passengers set current_status = $3 where pnr = $1 and number = $2',
    [pnr, passengerNumber, JSON.stringify(status)],
  );
}

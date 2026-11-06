import { pool, type Queryable } from '../pool.js';
import type { BookingStatus, PayWith } from '../../domain/constants.js';
import type { BookingRecord, HoldRecord } from '../../domain/types.js';
import type { OccupiedSpan } from '../../domain/availability.js';

interface BookingRow {
  id: string;
  ref: string;
  hold_ref: string;
  tenant_id: string;
  station_id: string;
  booking_date: string;
  start_local: string;
  end_local: string;
  start_at: Date;
  end_at: Date;
  start_minute: number;
  end_minute: number;
  elapsed_minutes: number;
  status: BookingStatus;
  pay_with: PayWith | null;
  amount_cents: number | null;
  policy_version: number | null;
  notes: string;
  checked_in_at: Date | null;
  checked_out_at: Date | null;
  holdover_reported_minutes: number | null;
  holdover_billed_minutes: number | null;
  holdover_amount_cents: number | null;
  cancelled_at: Date | null;
  cancellation_late: boolean | null;
  cancellation_fee_cents: number | null;
  cancellation_fee_minutes: number | null;
  cancellation_fee_refunded: boolean;
  station_time_invoice_id: string | null;
  holdover_invoice_id: string | null;
  late_fee_invoice_id: string | null;
  created_at: Date;
}

interface HoldRow {
  ref: string;
  tenant_id: string;
  station_id: string;
  weeks: number;
  notes: string;
  created_at: Date;
  expires_at: Date;
  confirmed_at: Date | null;
  released_at: Date | null;
}

export function toBooking(row: BookingRow): BookingRecord {
  return {
    id: row.id,
    ref: row.ref,
    holdRef: row.hold_ref,
    tenantId: row.tenant_id,
    stationId: row.station_id,
    date: row.booking_date,
    startLocal: row.start_local,
    endLocal: row.end_local,
    startAt: row.start_at,
    endAt: row.end_at,
    startMinute: row.start_minute,
    endMinute: row.end_minute,
    elapsedMinutes: row.elapsed_minutes,
    status: row.status,
    payWith: row.pay_with,
    amountCents: row.amount_cents,
    policyVersion: row.policy_version,
    notes: row.notes,
    checkedInAt: row.checked_in_at,
    checkedOutAt: row.checked_out_at,
    holdoverReportedMinutes: row.holdover_reported_minutes,
    holdoverBilledMinutes: row.holdover_billed_minutes,
    holdoverAmountCents: row.holdover_amount_cents,
    cancelledAt: row.cancelled_at,
    cancellationLate: row.cancellation_late,
    cancellationFeeCents: row.cancellation_fee_cents,
    cancellationFeeMinutes: row.cancellation_fee_minutes,
    cancellationFeeRefunded: row.cancellation_fee_refunded,
    stationTimeInvoiceId: row.station_time_invoice_id,
    holdoverInvoiceId: row.holdover_invoice_id,
    lateFeeInvoiceId: row.late_fee_invoice_id,
    createdAt: row.created_at,
  };
}

function toHold(row: HoldRow): HoldRecord {
  return {
    ref: row.ref,
    tenantId: row.tenant_id,
    stationId: row.station_id,
    weeks: row.weeks,
    notes: row.notes,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    confirmedAt: row.confirmed_at,
    releasedAt: row.released_at,
  };
}

const LIVE_BLOCK = `(
  b.status IN ('confirmed','checked_in','completed')
  OR (b.status = 'held' AND h.released_at IS NULL AND h.confirmed_at IS NULL AND h.expires_at > $1)
)`;

export async function lockStation(db: Queryable, stationId: string): Promise<void> {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`station:${stationId}`]);
}

export async function lockTenantHours(db: Queryable, tenantId: string): Promise<void> {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`hours:${tenantId}`]);
}

export async function occupiedSpans(
  db: Queryable,
  stationId: string,
  now: Date,
  from: Date,
  to: Date,
): Promise<OccupiedSpan[]> {
  const result = await db.query<{ tenant_id: string; start_at: Date; end_at: Date }>(
    `SELECT b.tenant_id, b.start_at, b.end_at
       FROM bookings b JOIN holds h ON h.ref = b.hold_ref
      WHERE b.station_id = $2 AND ${LIVE_BLOCK}
        AND b.end_at > $3 AND b.start_at < $4`,
    [now, stationId, from, to],
  );
  return result.rows.map((row) => ({
    tenantId: row.tenant_id,
    startAt: row.start_at,
    endAt: row.end_at,
  }));
}

export async function blocksOnDate(
  date: string,
  now: Date,
): Promise<{ booking: BookingRecord; holdExpiresAt: Date | null }[]> {
  const result = await pool.query<BookingRow & { hold_expires_at: Date }>(
    `SELECT b.*, h.expires_at AS hold_expires_at
       FROM bookings b JOIN holds h ON h.ref = b.hold_ref
      WHERE b.booking_date = $2 AND ${LIVE_BLOCK}
      ORDER BY b.start_minute, b.ref`,
    [now, date],
  );
  return result.rows.map((row) => ({
    booking: toBooking(row),
    holdExpiresAt: row.status === 'held' ? row.hold_expires_at : null,
  }));
}

export async function insertHold(db: Queryable, hold: HoldRecord): Promise<void> {
  await db.query(
    `INSERT INTO holds (ref, tenant_id, station_id, weeks, notes, created_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [hold.ref, hold.tenantId, hold.stationId, hold.weeks, hold.notes, hold.createdAt, hold.expiresAt],
  );
}

export async function nextHoldRef(db: Queryable): Promise<string> {
  const result = await db.query<{ value: number }>("SELECT nextval('hold_ref_seq')::bigint AS value");
  return `SK-${result.rows[0]!.value}`;
}

export async function insertBooking(db: Queryable, booking: BookingRecord): Promise<void> {
  await db.query(
    `INSERT INTO bookings (id, ref, hold_ref, tenant_id, station_id, booking_date, start_local,
       end_local, start_at, end_at, start_minute, end_minute, elapsed_minutes, status, pay_with,
       amount_cents, policy_version, notes, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [
      booking.id,
      booking.ref,
      booking.holdRef,
      booking.tenantId,
      booking.stationId,
      booking.date,
      booking.startLocal,
      booking.endLocal,
      booking.startAt,
      booking.endAt,
      booking.startMinute,
      booking.endMinute,
      booking.elapsedMinutes,
      booking.status,
      booking.payWith,
      booking.amountCents,
      booking.policyVersion,
      booking.notes,
      booking.createdAt,
    ],
  );
}

export async function findHold(ref: string, db: Queryable = pool): Promise<HoldRecord | null> {
  const result = await db.query<HoldRow>('SELECT * FROM holds WHERE ref = $1', [ref]);
  const row = result.rows[0];
  return row ? toHold(row) : null;
}

export async function lockHold(db: Queryable, ref: string): Promise<HoldRecord | null> {
  const result = await db.query<HoldRow>('SELECT * FROM holds WHERE ref = $1 FOR UPDATE', [ref]);
  const row = result.rows[0];
  return row ? toHold(row) : null;
}

export async function bookingsForHold(ref: string, db: Queryable = pool): Promise<BookingRecord[]> {
  const result = await db.query<BookingRow>(
    'SELECT * FROM bookings WHERE hold_ref = $1 ORDER BY start_at',
    [ref],
  );
  return result.rows.map(toBooking);
}

export async function deleteHold(ref: string): Promise<void> {
  await pool.query('DELETE FROM holds WHERE ref = $1', [ref]);
}

export async function markHoldConfirmed(db: Queryable, ref: string, at: Date): Promise<void> {
  await db.query('UPDATE holds SET confirmed_at = $2 WHERE ref = $1', [ref, at]);
}

export async function findBooking(id: string, db: Queryable = pool): Promise<BookingRecord | null> {
  const result = await db.query<BookingRow>('SELECT * FROM bookings WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? toBooking(row) : null;
}

export async function lockBooking(db: Queryable, id: string): Promise<BookingRecord | null> {
  const result = await db.query<BookingRow>('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [id]);
  const row = result.rows[0];
  return row ? toBooking(row) : null;
}

export interface BookingFilters {
  tenantId: string | null;
  q: string | null;
  from: string;
  to: string;
  status: BookingStatus | null;
  stationId: string | null;
  limit: number | null;
}

export async function searchBookings(filters: BookingFilters): Promise<BookingRecord[]> {
  const values: unknown[] = [filters.from, filters.to];
  const clauses = [
    "b.status <> 'held'",
    'b.booking_date >= $1::date',
    'b.booking_date <= $2::date',
  ];
  if (filters.tenantId) {
    values.push(filters.tenantId);
    clauses.push(`b.tenant_id = $${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    clauses.push(`b.status = $${values.length}`);
  }
  if (filters.stationId) {
    values.push(filters.stationId);
    clauses.push(`b.station_id = $${values.length}`);
  }
  if (filters.q) {
    values.push(`%${filters.q.toLowerCase()}%`);
    const index = values.length;
    const searchable = filters.tenantId
      ? `(lower(b.ref) LIKE $${index} OR lower(b.notes) LIKE $${index})`
      : `(lower(b.ref) LIKE $${index} OR lower(b.notes) LIKE $${index} OR lower(t.business_name) LIKE $${index})`;
    clauses.push(searchable);
  }
  let sql = `SELECT b.* FROM bookings b JOIN tenants t ON t.id = b.tenant_id
             WHERE ${clauses.join(' AND ')} ORDER BY b.start_at, b.ref`;
  if (filters.limit !== null) {
    values.push(filters.limit);
    sql += ` LIMIT $${values.length}`;
  }
  const result = await pool.query<BookingRow>(sql, values);
  return result.rows.map(toBooking);
}

export async function updateBooking(
  db: Queryable,
  id: string,
  changes: Partial<{
    status: BookingStatus;
    checked_in_at: Date | null;
    checked_out_at: Date | null;
    holdover_reported_minutes: number;
    holdover_billed_minutes: number;
    holdover_amount_cents: number;
    cancelled_at: Date;
    cancellation_late: boolean;
    cancellation_fee_cents: number;
    cancellation_fee_minutes: number;
    cancellation_fee_refunded: boolean;
    station_time_invoice_id: string;
    holdover_invoice_id: string;
    late_fee_invoice_id: string;
  }>,
): Promise<void> {
  const entries = Object.entries(changes);
  if (entries.length === 0) return;
  const assignments = entries.map(([column], index) => `${column} = $${index + 2}`);
  await db.query(
    `UPDATE bookings SET ${assignments.join(', ')} WHERE id = $1`,
    [id, ...entries.map(([, value]) => value)],
  );
}

export async function confirmHoldBookings(
  db: Queryable,
  holdRef: string,
  payWith: PayWith,
  policyVersion: number,
  amounts: Map<string, number | null>,
): Promise<void> {
  for (const [bookingId, amountCents] of amounts) {
    await db.query(
      `UPDATE bookings SET status = 'confirmed', pay_with = $2, amount_cents = $3, policy_version = $4
        WHERE id = $1 AND hold_ref = $5`,
      [bookingId, payWith, amountCents, policyVersion, holdRef],
    );
  }
}

export interface InvoiceableBookings {
  stationTime: BookingRecord[];
  holdover: BookingRecord[];
  lateFee: BookingRecord[];
}

export async function invoiceableBookings(
  db: Queryable,
  tenantId: string,
  periodStartDate: string,
  periodEndDate: string,
  cancelledFrom: Date,
  cancelledTo: Date,
): Promise<InvoiceableBookings> {
  const stationTime = await db.query<BookingRow>(
    `SELECT * FROM bookings
      WHERE tenant_id = $1 AND pay_with = 'account' AND status IN ('completed','no_show')
        AND booking_date >= $2::date AND booking_date <= $3::date
        AND station_time_invoice_id IS NULL
      ORDER BY start_at, ref
      FOR UPDATE`,
    [tenantId, periodStartDate, periodEndDate],
  );
  const holdover = await db.query<BookingRow>(
    `SELECT * FROM bookings
      WHERE tenant_id = $1 AND COALESCE(holdover_billed_minutes, 0) > 0
        AND booking_date >= $2::date AND booking_date <= $3::date
        AND holdover_invoice_id IS NULL
      ORDER BY start_at, ref
      FOR UPDATE`,
    [tenantId, periodStartDate, periodEndDate],
  );
  const lateFee = await db.query<BookingRow>(
    `SELECT * FROM bookings
      WHERE tenant_id = $1 AND status = 'cancelled' AND pay_with = 'account'
        AND COALESCE(cancellation_fee_cents, 0) > 0 AND cancellation_fee_refunded = false
        AND cancelled_at >= $2 AND cancelled_at < $3
        AND late_fee_invoice_id IS NULL
      ORDER BY cancelled_at, ref
      FOR UPDATE`,
    [tenantId, cancelledFrom, cancelledTo],
  );
  return {
    stationTime: stationTime.rows.map(toBooking),
    holdover: holdover.rows.map(toBooking),
    lateFee: lateFee.rows.map(toBooking),
  };
}

export async function tenantHasOpenBookings(tenantId: string, now: Date): Promise<boolean> {
  const result = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM bookings b JOIN holds h ON h.ref = b.hold_ref
      WHERE b.tenant_id = $2
        AND (b.status IN ('confirmed','checked_in')
             OR (b.status = 'held' AND h.released_at IS NULL AND h.confirmed_at IS NULL AND h.expires_at > $1))`,
    [now, tenantId],
  );
  return (result.rows[0]?.count ?? 0) > 0;
}

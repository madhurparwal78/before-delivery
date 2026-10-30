import { type PoolClient } from 'pg';
import { pool, newId } from './db.js';
import { kitchenNow, instantInZone, KITCHEN_TZ, endOfKitchenDate, kitchenInstant } from './clock.js';
import { STATIONS } from '../shared/seed.js';
import {
  clockFromMinutes,
  costSplit,
  documentCoversDate,
  freeCancelCutoffDate,
  listAmountCents,
  lateCancellationFeeCents,
  minutesFromClock,
} from '../shared/rules.js';
import type { Booking, Document, Hold, Station, Transaction, User, CheckIn, CostSplit } from '../shared/types.js';

// ---------------------------------------------------------------------------
// Kitchen facts.
// ---------------------------------------------------------------------------

export function stationById(id: string): Station | undefined {
  return STATIONS.find((s) => s.id === id);
}

export function stationFor(booking: { station_id: string }): Station {
  const s = stationById(booking.station_id);
  if (!s) throw new Error(`unknown station ${booking.station_id}`);
  return s;
}

// ---------------------------------------------------------------------------
// Users, members, balances.
// ---------------------------------------------------------------------------

export interface MemberRow {
  id: string;
  business_name: string;
  contact_email: string;
}

export async function findUserByEmail(email: string, client?: PoolClient): Promise<{ id: string; password_hash: string; name: string; email: string; role: User['role']; member_id: string | null } | null> {
  const q = await (client ?? pool).query(
    `SELECT u.id, u.password_hash, u.name, u.email, u.role, u.member_id, m.business_name
     FROM users u LEFT JOIN members m ON m.id = u.member_id
     WHERE u.email = $1`,
    [email],
  );
  const row = q.rows[0] as
    | { id: string; password_hash: string; name: string; email: string; role: User['role']; member_id: string | null; business_name: string | null }
    | undefined;
  if (!row) return null;
  return { id: row.id, password_hash: row.password_hash, name: row.name, email: row.email, role: row.role, member_id: row.member_id };
}

export async function userById(id: string): Promise<User | null> {
  const q = await pool.query(
    `SELECT u.id, u.name, u.email, u.role, u.member_id, m.business_name
     FROM users u LEFT JOIN members m ON m.id = u.member_id
     WHERE u.id = $1`,
    [id],
  );
  const row = q.rows[0] as { id: string; name: string; email: string; role: User['role']; member_id: string | null; business_name: string | null } | undefined;
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role, member_id: row.member_id, business_name: row.business_name };
}

export async function memberById(id: string): Promise<MemberRow | null> {
  const q = await pool.query('SELECT id, business_name, contact_email FROM members WHERE id = $1', [id]);
  const row = q.rows[0] as MemberRow | undefined;
  return row ?? null;
}

export function userFromRow(row: { id: string; name: string; email: string; role: User['role']; member_id: string | null; business_name: string | null }): User {
  return { id: row.id, name: row.name, email: row.email, role: row.role, member_id: row.member_id, business_name: row.business_name };
}

export async function balanceMinutes(memberId: string, client?: PoolClient): Promise<number> {
  const q = await (client ?? pool).query(
    `SELECT COALESCE(SUM(e.minutes), 0)::int AS balance
     FROM ledger_entries e
     JOIN transactions t ON t.id = e.transaction_id
     WHERE e.account = $1`,
    [`member:${memberId}`],
  );
  return (q.rows[0] as { balance: number }).balance;
}

// ---------------------------------------------------------------------------
// Ledger transactions: each movement is one transaction of two entries that
// sum to zero. Transactions are never edited or deleted, only reversed.
// ---------------------------------------------------------------------------

export interface NewTransaction {
  id?: string;
  memberId: string;
  kind: Transaction['kind'];
  minutes: number;
  bookingId?: string | null;
  reason?: string | null;
  reverses?: string | null;
}

const KITCHEN_ACCOUNTS: Record<Transaction['kind'], string> = {
  opening: 'kitchen:issued',
  pack_purchase: 'kitchen:issued',
  adjustment: 'kitchen:issued',
  booking_debit: 'kitchen:used',
  cancellation_refund: 'kitchen:used',
  reversal: 'kitchen:issued',
};

export async function writeTransaction(client: PoolClient, tx: NewTransaction): Promise<Transaction> {
  const id = tx.id ?? newId('txn');
  const memberAccount = `member:${tx.memberId}`;
  const kitchenAccount = KITCHEN_ACCOUNTS[tx.kind];
  const now = instantInZone(kitchenNow().epochMillis, KITCHEN_TZ);
  const q = await client.query(
    `INSERT INTO transactions (id, member_id, kind, created_at, member_minutes, booking_id, reason, reverses, reversed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL) RETURNING id, kind, created_at, member_minutes, booking_id, reason, reverses, reversed_by`,
    [id, tx.memberId, tx.kind, now, tx.minutes, tx.bookingId ?? null, tx.reason ?? null, tx.reverses ?? null],
  );
  const row = q.rows[0] as { id: string; kind: Transaction['kind']; created_at: string; member_minutes: number; booking_id: string | null; reason: string | null; reverses: string | null; reversed_by: string | null };
  await client.query(
    `INSERT INTO ledger_entries (id, transaction_id, account, minutes) VALUES
      ($1, $2, $3, $4), ($5, $2, $6, $7)`,
    [newId('ent'), id, memberAccount, tx.minutes, newId('ent'), kitchenAccount, -tx.minutes],
  );
  return transactionFromRow(row, tx.memberId);
}

function transactionFromRow(row: { id: string; kind: Transaction['kind']; created_at: string; member_minutes: number; booking_id: string | null; reason: string | null; reverses: string | null; reversed_by: string | null }, memberId: string): Transaction {
  const memberAccount = `member:${memberId}`;
  const kitchenAccount = KITCHEN_ACCOUNTS[row.kind];
  return {
    id: row.id,
    kind: row.kind,
    created_at: toInstant(row.created_at),
    member_minutes: row.member_minutes,
    booking_id: row.booking_id,
    reason: row.reason,
    reverses: row.reverses,
    reversed_by: row.reversed_by,
    entries: [
      { account: memberAccount, minutes: row.member_minutes },
      { account: kitchenAccount, minutes: -row.member_minutes },
    ],
  };
}

function toInstant(value: string | Date): string {
  const epoch = typeof value === 'string' ? Date.parse(value) : value.getTime();
  return instantInZone(epoch, KITCHEN_TZ);
}

export async function ledgerForMember(memberId: string): Promise<{ balanceMinutes: number; transactions: Transaction[] }> {
  const q = await pool.query(
    `SELECT id, kind, created_at, member_minutes, booking_id, reason, reverses, reversed_by
     FROM transactions WHERE member_id = $1 ORDER BY created_at ASC, id ASC`,
    [memberId],
  );
  const transactions = (q.rows as { id: string; kind: Transaction['kind']; created_at: string; member_minutes: number; booking_id: string | null; reason: string | null; reverses: string | null; reversed_by: string | null }[]).map((row) =>
    transactionFromRow(row, memberId),
  );
  return { balanceMinutes: await balanceMinutes(memberId), transactions };
}

export async function transactionById(id: string): Promise<{ tx: Transaction; memberId: string } | null> {
  const q = await pool.query(
    'SELECT id, member_id, kind, created_at, member_minutes, booking_id, reason, reverses, reversed_by FROM transactions WHERE id = $1',
    [id],
  );
  const row = q.rows[0] as { id: string; member_id: string; kind: Transaction['kind']; created_at: string; member_minutes: number; booking_id: string | null; reason: string | null; reverses: string | null; reversed_by: string | null } | undefined;
  if (!row) return null;
  return { tx: transactionFromRow(row, row.member_id), memberId: row.member_id };
}

// ---------------------------------------------------------------------------
// Holds.
// ---------------------------------------------------------------------------

export interface HoldRow {
  id: string;
  member_id: string;
  station_id: string;
  date: string;
  start_min: number;
  end_min: number;
  tail_end_min: number;
  status: Hold['status'];
  created_at_epoch: number;
  expires_at_epoch: number;
}

export async function holdById(id: string): Promise<HoldRow | null> {
  const q = await pool.query('SELECT * FROM holds WHERE id = $1', [id]);
  const row = q.rows[0] as HoldRow & { created_at: Date; expires_at: Date } | undefined;
  if (!row) return null;
  return { ...row, created_at_epoch: row.created_at.getTime(), expires_at_epoch: row.expires_at.getTime() };
}

export function holdIsLive(hold: HoldRow, nowEpoch: number): boolean {
  return hold.status === 'live' && nowEpoch < hold.expires_at_epoch;
}

export function holdView(hold: HoldRow, balanceMinutes: number): Hold {
  const station = stationById(hold.station_id)!;
  return {
    id: hold.id,
    member_id: hold.member_id,
    station_id: hold.station_id,
    date: hold.date,
    start: clockFromMinutes(hold.start_min),
    end: clockFromMinutes(hold.end_min),
    tail_end: clockFromMinutes(hold.tail_end_min),
    status: hold.status,
    created_at: instantInZone(hold.created_at_epoch, KITCHEN_TZ),
    expires_at: instantInZone(hold.expires_at_epoch, KITCHEN_TZ),
    preview: costSplit(balanceMinutes, hold.start_min, hold.end_min, station),
  };
}

// ---------------------------------------------------------------------------
// Bookings.
// ---------------------------------------------------------------------------

export interface BookingRow {
  id: string;
  hold_id: string;
  member_id: string;
  station_id: string;
  date: string;
  start_min: number;
  end_min: number;
  tail_end_min: number;
  status: Booking['status'];
  payment: Booking['payment'];
  prepaid_minutes: number;
  overage_minutes: number;
  overage_amount_cents: number;
  list_amount_cents: number;
  fee_amount_cents: number | null;
  fee_status: string | null;
  free_cancel_until_epoch: number;
  confirmed_at_epoch: number;
  cancelled_at_epoch: number | null;
}

const BOOKING_SELECT = `SELECT b.*, m.business_name FROM bookings b JOIN members m ON m.id = b.member_id`;

interface BookingRowRaw extends Omit<BookingRow, 'free_cancel_until_epoch' | 'confirmed_at_epoch' | 'cancelled_at_epoch'> {
  business_name: string;
  free_cancel_until: Date;
  confirmed_at: Date;
  cancelled_at: Date | null;
}

function bookingFromRow(row: BookingRowRaw, checkIns: CheckIn[]): Booking {
  const station = stationById(row.station_id)!;
  return {
    id: row.id,
    hold_id: row.hold_id,
    member_id: row.member_id,
    business_name: row.business_name,
    station_id: row.station_id,
    station_name: station.name,
    date: row.date,
    start: clockFromMinutes(row.start_min),
    end: clockFromMinutes(row.end_min),
    tail_end: clockFromMinutes(row.tail_end_min),
    status: row.status,
    payment: row.payment,
    booked_minutes: row.end_min - row.start_min,
    prepaid_minutes: row.prepaid_minutes,
    overage_minutes: row.overage_minutes,
    overage_amount: money(row.overage_amount_cents),
    list_amount: money(row.list_amount_cents),
    free_cancel_until: instantInZone(row.free_cancel_until.getTime(), KITCHEN_TZ),
    fee:
      row.fee_amount_cents !== null && row.fee_status !== null
        ? { amount: money(row.fee_amount_cents), status: row.fee_status as Booking['fee'] extends null ? never : NonNullable<Booking['fee']>['status'] }
        : null,
    check_ins: checkIns,
    confirmed_at: instantInZone(row.confirmed_at.getTime(), KITCHEN_TZ),
    cancelled_at: row.cancelled_at ? instantInZone(row.cancelled_at.getTime(), KITCHEN_TZ) : null,
  };
}

function money(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const s = (abs / 100).toFixed(2);
  return neg && abs !== 0 ? '-' + s : s;
}

export async function bookingById(id: string): Promise<Booking | null> {
  const q = await pool.query(`${BOOKING_SELECT} WHERE b.id = $1`, [id]);
  const row = q.rows[0] as BookingRowRaw | undefined;
  if (!row) return null;
  return bookingFromRow(row, await checkInsFor([row.id]));
}

export async function checkInsFor(bookingIds: string[]): Promise<CheckIn[]> {
  if (bookingIds.length === 0) return [];
  const q = await pool.query(
    `SELECT c.id, c.booking_id, c.crew_cook_id, c.at, c.card_document_id, u.name AS crew_cook_name
     FROM check_ins c JOIN users u ON u.id = c.crew_cook_id
     WHERE c.booking_id = ANY($1) ORDER BY c.at ASC`,
    [bookingIds],
  );
  return (q.rows as { id: string; booking_id: string; crew_cook_id: string; at: Date; card_document_id: string; crew_cook_name: string }[]).map((r) => ({
    id: r.id,
    crew_cook_id: r.crew_cook_id,
    crew_cook_name: r.crew_cook_name,
    at: instantInZone(r.at.getTime(), KITCHEN_TZ),
    card_document_id: r.card_document_id,
  }));
}

// ---------------------------------------------------------------------------
// Documents and coverage.
// ---------------------------------------------------------------------------

export interface DocumentRow {
  id: string;
  member_id: string;
  kind: Document['kind'];
  crew_cook_id: string | null;
  expires_on: string;
  status: Document['status'];
  filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at_epoch: number;
  reviewed_at_epoch: number | null;
  rejection_reason: string | null;
}

export async function documentById(id: string): Promise<DocumentRow | null> {
  const q = await pool.query('SELECT * FROM documents WHERE id = $1', [id]);
  const row = q.rows[0] as (DocumentRow & { uploaded_at: Date; reviewed_at: Date | null }) | undefined;
  if (!row) return null;
  return { ...row, uploaded_at_epoch: row.uploaded_at.getTime(), reviewed_at_epoch: row.reviewed_at ? row.reviewed_at.getTime() : null };
}

export function documentView(row: DocumentRow, crewCookName: string | null): Document {
  return {
    id: row.id,
    member_id: row.member_id,
    kind: row.kind,
    crew_cook_id: row.crew_cook_id,
    crew_cook_name: crewCookName,
    expires_on: row.expires_on,
    status: row.status,
    filename: row.filename,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    uploaded_at: instantInZone(row.uploaded_at_epoch, KITCHEN_TZ),
    reviewed_at: row.reviewed_at_epoch ? instantInZone(row.reviewed_at_epoch, KITCHEN_TZ) : null,
    rejection_reason: row.rejection_reason,
  };
}

export function documentReadsExpired(row: { status: string; expires_on: string }, today: string): boolean {
  return row.status === 'approved' && row.expires_on < today;
}

/** Any one approved document of the right kind covering the date is enough. */
export async function coverageDocument(
  client: PoolClient | undefined,
  memberId: string,
  kind: Document['kind'],
  date: string,
  crewCookId?: string | null,
): Promise<DocumentRow | null> {
  const params: unknown[] = [memberId, kind, date];
  let whereCrew = '';
  if (kind === 'food_handler_card') {
    params.push(crewCookId ?? null);
    whereCrew = ' AND crew_cook_id = $4';
  }
  const q = await (client ?? pool).query(
    `SELECT * FROM documents
     WHERE member_id = $1 AND kind = $2 AND status = 'approved' AND expires_on >= $3${whereCrew}
     ORDER BY expires_on DESC LIMIT 1`,
    params,
  );
  const row = q.rows[0] as (DocumentRow & { uploaded_at: Date; reviewed_at: Date | null }) | undefined;
  if (!row) return null;
  return { ...row, uploaded_at_epoch: row.uploaded_at.getTime(), reviewed_at_epoch: row.reviewed_at ? row.reviewed_at.getTime() : null };
}

export function coversDate(expiresOn: string, date: string): boolean {
  return documentCoversDate(expiresOn, date);
}

// ---------------------------------------------------------------------------
// Booking costs, decided once and reused by every caller.
// ---------------------------------------------------------------------------

export function bookingCostSplit(balance: number, startMin: number, endMin: number, station: Station): CostSplit {
  return costSplit(balance, startMin, endMin, station);
}

export function bookingListAmountCents(station: Station, bookedMinutes: number): number {
  return listAmountCents(station, bookedMinutes);
}

export function bookingFeeCents(station: Station, bookedMinutes: number): number {
  return lateCancellationFeeCents(station, bookedMinutes);
}

/** The same kitchen wall-clock time two calendar days before the start. */
export function freeCancelUntil(date: string, startMin: number): number {
  const cutoffDate = freeCancelCutoffDate(date);
  return kitchenInstant(cutoffDate, startMin, 0);
}

export function parseClock(time: string): number {
  return minutesFromClock(time);
}

export function endOfDate(date: string): number {
  return endOfKitchenDate(date);
}

import type { BookingStatus, DocumentKind, HoldStatus } from '../../shared/types.js';
import { pool, query, queryOne, type Db } from '../db/pool.js';
import { notFound } from '../http/errors.js';
import type { Actor } from '../http/session.js';

export interface SiteRow {
  id: string;
  operator_id: string;
  name: string;
  time_zone: string;
  deposit_cents: number;
  cleaning_fee_cents: number;
}

export interface StationRow {
  id: string;
  site_id: string;
  name: string;
  rate_cents: number;
  time_zone: string;
  operator_id: string;
  deposit_cents: number;
  cleaning_fee_cents: number;
  site_name: string;
}

export interface RenterRow {
  id: string;
  operator_id: string;
  name: string;
  business: string;
  email: string;
  phone: string;
  home_site_id: string;
}

export interface BookingRow {
  id: string;
  hold_id: string | null;
  site_id: string;
  station_id: string;
  renter_id: string;
  status: BookingStatus;
  start_at: Date;
  end_at: Date;
  minutes: number;
  pack_minutes: number;
  card_minutes: number;
  card_cents: number;
  deposit_cents: number;
  time_paid: boolean;
  balance_due_by: Date | null;
  policy_version_id: string;
  confirmed_at: Date;
  checked_in_at: Date | null;
  checked_out_at: Date | null;
  overrun_minutes: number;
  overrun_cents: number;
  cleaning_fee_cents: number;
  card_refund_cents: number;
  deposit_refund_cents: number;
  station_name: string;
  rate_cents: number;
  renter_business: string;
  renter_name: string;
  renter_email: string;
  time_zone: string;
  site_name: string;
  site_deposit_cents: number;
  site_cleaning_fee_cents: number;
  notice_hours: number;
  effective_from: string;
}

export interface HoldRow {
  id: string;
  site_id: string;
  station_id: string;
  renter_id: string;
  status: HoldStatus;
  repeat_weeks: number;
  created_at: Date;
  expires_at: Date;
  station_name: string;
  rate_cents: number;
  time_zone: string;
  site_name: string;
  deposit_cents: number;
  renter_business: string;
  renter_name: string;
  renter_email: string;
  home_site_id: string;
}

export interface OccurrenceRow {
  seq: number;
  local_date: string;
  local_start: string;
  local_end: string;
  start_at: Date;
  end_at: Date;
  minutes: number;
}

export interface DocumentRow {
  id: string;
  renter_id: string;
  kind: DocumentKind;
  valid_from: string;
  expires_on: string;
  content_type: string;
  size_bytes: number;
  storage_key: string;
  uploaded_at: Date;
}

export const BOOKING_SELECT = `
  SELECT b.*, st.name AS station_name, st.rate_cents,
         r.business AS renter_business, r.name AS renter_name, r.email AS renter_email,
         s.time_zone, s.name AS site_name, s.deposit_cents AS site_deposit_cents,
         s.cleaning_fee_cents AS site_cleaning_fee_cents,
         pv.notice_hours, pv.effective_from
    FROM bookings b
    JOIN stations st ON st.id = b.station_id
    JOIN renters r ON r.id = b.renter_id
    JOIN sites s ON s.id = b.site_id
    JOIN policy_versions pv ON pv.id = b.policy_version_id`;

export const HOLD_SELECT = `
  SELECT h.*, st.name AS station_name, st.rate_cents, s.time_zone, s.name AS site_name,
         s.deposit_cents, r.business AS renter_business, r.name AS renter_name,
         r.email AS renter_email, r.home_site_id
    FROM holds h
    JOIN stations st ON st.id = h.station_id
    JOIN sites s ON s.id = h.site_id
    JOIN renters r ON r.id = h.renter_id`;

export async function siteInScope(actor: Actor, siteId: string): Promise<SiteRow> {
  if (!actor.site_ids.includes(siteId)) throw notFound();
  const row = await queryOne<SiteRow>(
    pool,
    'SELECT id, operator_id, name, time_zone, deposit_cents, cleaning_fee_cents FROM sites WHERE id = $1',
    [siteId],
  );
  if (!row) throw notFound();
  return row;
}

export async function stationInScope(actor: Actor, stationId: string): Promise<StationRow> {
  const row = await queryOne<StationRow>(
    pool,
    `SELECT st.id, st.site_id, st.name, st.rate_cents, s.time_zone, s.operator_id,
            s.deposit_cents, s.cleaning_fee_cents, s.name AS site_name
       FROM stations st JOIN sites s ON s.id = st.site_id WHERE st.id = $1`,
    [stationId],
  );
  if (!row || !actor.site_ids.includes(row.site_id)) throw notFound();
  return row;
}

export async function renterInScope(actor: Actor, renterId: string): Promise<RenterRow> {
  if (actor.role === 'renter' && renterId !== actor.renter_id) throw notFound();
  const row = await queryOne<RenterRow>(pool, 'SELECT * FROM renters WHERE id = $1', [renterId]);
  if (!row || row.operator_id !== actor.operator_id) throw notFound();
  return row;
}

export async function ownRenter(actor: Actor): Promise<RenterRow> {
  if (actor.renter_id === null) throw notFound();
  return renterInScope(actor, actor.renter_id);
}

export async function bookingInScope(
  actor: Actor,
  bookingId: string,
  db: Db = pool,
  forUpdate = false,
): Promise<BookingRow> {
  const row = await queryOne<BookingRow>(
    db,
    `${BOOKING_SELECT} WHERE b.id = $1${forUpdate ? ' FOR NO KEY UPDATE OF b' : ''}`,
    [bookingId],
  );
  if (!row) throw notFound();
  if (actor.role === 'renter' ? row.renter_id !== actor.renter_id : !actor.site_ids.includes(row.site_id)) {
    throw notFound();
  }
  return row;
}

export async function holdInScope(
  actor: Actor,
  holdId: string,
  db: Db = pool,
  forUpdate = false,
): Promise<HoldRow> {
  const row = await queryOne<HoldRow>(
    db,
    `${HOLD_SELECT} WHERE h.id = $1${forUpdate ? ' FOR NO KEY UPDATE OF h' : ''}`,
    [holdId],
  );
  if (!row) throw notFound();
  if (actor.role === 'renter' ? row.renter_id !== actor.renter_id : !actor.site_ids.includes(row.site_id)) {
    throw notFound();
  }
  return row;
}

export async function documentInScope(actor: Actor, documentId: string): Promise<DocumentRow> {
  const row = await queryOne<DocumentRow>(pool, 'SELECT * FROM documents WHERE id = $1', [documentId]);
  if (!row) throw notFound();
  await renterInScope(actor, row.renter_id);
  return row;
}

export async function occurrencesOf(db: Db, holdId: string): Promise<OccurrenceRow[]> {
  return query<OccurrenceRow>(
    db,
    `SELECT seq, local_date, local_start, local_end, start_at, end_at, minutes
       FROM hold_occurrences WHERE hold_id = $1 ORDER BY seq`,
    [holdId],
  );
}

export async function stationsOfSite(db: Db, siteId: string): Promise<StationRow[]> {
  return query<StationRow>(
    db,
    `SELECT st.id, st.site_id, st.name, st.rate_cents, s.time_zone, s.operator_id,
            s.deposit_cents, s.cleaning_fee_cents, s.name AS site_name
       FROM stations st JOIN sites s ON s.id = st.site_id
      WHERE st.site_id = $1 ORDER BY st.sort_order`,
    [siteId],
  );
}

/** The policy version in force at an instant for a site. */
export async function policyVersionAt(
  db: Db,
  siteId: string,
  at: Date,
): Promise<{ id: string; notice_hours: number; effective_from: string }> {
  const row = await queryOne<{ id: string; notice_hours: number; effective_from: string }>(
    db,
    `SELECT id, notice_hours, effective_from FROM policy_versions
      WHERE site_id = $1 AND effective_at <= $2
      ORDER BY effective_at DESC, created_at DESC LIMIT 1`,
    [siteId, at],
  );
  if (!row) throw new Error(`no policy version for site ${siteId}`);
  return row;
}

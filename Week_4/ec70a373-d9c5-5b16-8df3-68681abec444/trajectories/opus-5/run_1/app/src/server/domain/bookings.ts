import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { iso, isoOrNull, nowMs } from '../clock';
import { LOCK_BOOKING, LOCK_STATION, lock, one, query, tx } from '../db';
import type { BookingJson, BookingStatus, OverageJson, StationKind } from '../../shared/types';
import { holdIsLive, reportedStatus } from './rules';
import { minutesToWall } from '../../shared/tz';
import { recordMovement, returnToLots, expireReturnedHours, type LotAllocation } from './ledger';

export interface BookingRecord {
  id: string;
  tenant_id: string;
  site_id: string;
  station_id: string;
  station_name: string;
  station_kind: StationKind;
  member_id: string;
  business_name: string;
  member_user_id: string;
  member_email: string;
  home_site_id: string;
  reference: string;
  date_text: string;
  start_minutes: number;
  end_minutes: number;
  start_at: Date;
  end_at: Date;
  occupied_end_at: Date;
  quarters: number;
  status: BookingStatus;
  hold_expires_at: Date | null;
  series_id: string | null;
  refunded_quarters: number | null;
  forfeited_quarters: number | null;
  cancelled_by_user_id: string | null;
  cancelled_by_name: string | null;
  cancellation_reason: string | null;
  checked_in_at: Date | null;
  checked_in_by_user_id: string | null;
  checked_in_by_name: string | null;
  no_show_by_user_id: string | null;
  no_show_by_name: string | null;
  checked_out_at: Date | null;
  checked_out_by_user_id: string | null;
  checked_out_by_name: string | null;
  late_quarter_hours: number | null;
  pack_quarters_applied: number | null;
  overage: OverageJson | null;
  created_at: Date;
  site_time_zone: string;
  site_name: string;
  home_zone: string;
}

const BOOKING_SELECT = `
  select b.id, b.tenant_id, b.site_id, b.station_id, st.name as station_name, st.kind as station_kind,
         b.member_id, m.business_name, m.user_id as member_user_id, u.email as member_email,
         m.home_site_id,
         b.reference, to_char(b.booking_date, 'YYYY-MM-DD') as date_text,
         b.start_minutes, b.end_minutes, b.start_at, b.end_at, b.occupied_end_at, b.quarters,
         b.status, b.hold_expires_at, b.series_id, b.refunded_quarters, b.forfeited_quarters,
         b.cancelled_by_user_id, b.cancelled_by_name, b.cancellation_reason,
         b.checked_in_at, b.checked_in_by_user_id, b.checked_in_by_name,
         b.no_show_by_user_id, b.no_show_by_name,
         b.checked_out_at, b.checked_out_by_user_id, b.checked_out_by_name,
         b.late_quarter_hours, b.pack_quarters_applied, b.overage, b.created_at,
         s.time_zone as site_time_zone, s.name as site_name, hs.time_zone as home_zone
    from bookings b
    join stations st on st.id = b.station_id
    join members m on m.id = b.member_id
    join users u on u.id = m.user_id
    join sites s on s.id = b.site_id
    join sites hs on hs.id = m.home_site_id`;

export async function loadBooking(
  client: PoolClient,
  bookingId: string,
): Promise<BookingRecord | null> {
  return one<BookingRecord>(client, `${BOOKING_SELECT} where b.id = $1`, [bookingId]);
}

export async function loadBookingPool(bookingId: string): Promise<BookingRecord | null> {
  const found = await query<BookingRecord>(`${BOOKING_SELECT} where b.id = $1`, [bookingId]);
  return found.length === 0 ? null : (found[0] as BookingRecord);
}

export async function memberBookings(memberId: string): Promise<BookingRecord[]> {
  return query<BookingRecord>(
    `${BOOKING_SELECT} where b.member_id = $1 order by b.created_at desc, b.reference asc`,
    [memberId],
  );
}

export async function siteBookingsOnDate(
  siteId: string,
  date: string,
): Promise<BookingRecord[]> {
  return query<BookingRecord>(
    `${BOOKING_SELECT} where b.site_id = $1 and b.booking_date = $2
      order by b.start_at asc, b.reference asc`,
    [siteId, date],
  );
}

function person(userId: string | null, name: string | null): { user_id: string; name: string } | null {
  if (userId === null || name === null) return null;
  return { user_id: userId, name };
}

export function bookingJson(booking: BookingRecord, atMs: number): BookingJson {
  const holdExpires = booking.hold_expires_at === null ? null : booking.hold_expires_at.getTime();
  return {
    id: booking.id,
    reference: booking.reference,
    site_id: booking.site_id,
    station_id: booking.station_id,
    station_name: booking.station_name,
    member_id: booking.member_id,
    business_name: booking.business_name,
    date: booking.date_text,
    start: minutesToWall(booking.start_minutes),
    end: minutesToWall(booking.end_minutes),
    start_at: iso(booking.start_at),
    end_at: iso(booking.end_at),
    hours: booking.quarters / 4,
    status: reportedStatus(booking.status, holdExpires, atMs),
    hold_expires_at: isoOrNull(booking.hold_expires_at),
    series_id: booking.series_id,
    refunded_hours: booking.refunded_quarters === null ? null : booking.refunded_quarters / 4,
    forfeited_hours: booking.forfeited_quarters === null ? null : booking.forfeited_quarters / 4,
    cancelled_by: person(booking.cancelled_by_user_id, booking.cancelled_by_name),
    cancellation_reason: booking.cancellation_reason,
    checked_in_at: isoOrNull(booking.checked_in_at),
    checked_in_by: person(booking.checked_in_by_user_id, booking.checked_in_by_name),
    no_show_by: person(booking.no_show_by_user_id, booking.no_show_by_name),
    checked_out_at: isoOrNull(booking.checked_out_at),
    checked_out_by: person(booking.checked_out_by_user_id, booking.checked_out_by_name),
    late_quarter_hours: booking.late_quarter_hours,
    pack_hours_applied:
      booking.pack_quarters_applied === null ? null : booking.pack_quarters_applied / 4,
    overage: booking.overage,
    created_at: iso(booking.created_at),
  };
}

/** Occupied spans overlap when they share any stretch of time. */
export async function hasConflict(
  client: PoolClient,
  stationId: string,
  startAtMs: number,
  occupiedEndMs: number,
  atMs: number,
): Promise<boolean> {
  const found = await one<{ exists: boolean }>(
    client,
    `select exists (
       select 1 from bookings
        where station_id = $1
          and (status in ('confirmed','checked_in') or (status = 'held' and hold_expires_at > $4))
          and start_at < $3
          and occupied_end_at > $2
     ) as exists`,
    [
      stationId,
      new Date(startAtMs).toISOString(),
      new Date(occupiedEndMs).toISOString(),
      new Date(atMs).toISOString(),
    ],
  );
  return found?.exists === true;
}

export async function liveHoldCount(
  client: PoolClient,
  memberId: string,
  atMs: number,
): Promise<number> {
  const found = await one<{ count: string }>(
    client,
    `select count(*) as count from bookings
      where member_id = $1 and status = 'held' and hold_expires_at > $2`,
    [memberId, new Date(atMs).toISOString()],
  );
  return Number(found?.count ?? 0);
}

const REFERENCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export async function nextReference(client: PoolClient, tenantId: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const bytes = randomBytes(6);
    let candidate = 'PL-';
    for (const byte of bytes) {
      candidate += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length] as string;
    }
    const clash = await one<{ exists: boolean }>(
      client,
      'select exists (select 1 from bookings where tenant_id = $1 and reference = $2) as exists',
      [tenantId, candidate],
    );
    if (clash?.exists !== true) return candidate;
  }
  throw new Error('could not mint a booking reference');
}

export type BookingAction =
  | 'confirm'
  | 'release'
  | 'cancel_member'
  | 'cancel_manager'
  | 'check_in'
  | 'no_show'
  | 'check_out';

export type TransitionVerdict = 'ok' | 'invalid_transition' | 'hold_expired';

/** The one place the booking state machine's legality is decided. */
export function transitionVerdict(
  action: BookingAction,
  status: BookingStatus,
  holdExpiresAtMs: number | null,
  atMs: number,
): TransitionVerdict {
  const live = holdIsLive(holdExpiresAtMs, atMs);
  const effective: BookingStatus = status === 'held' && !live ? 'expired' : status;
  switch (action) {
    case 'confirm':
      if (effective === 'held') return 'ok';
      if (effective === 'expired') return 'hold_expired';
      return 'invalid_transition';
    case 'release':
      return effective === 'held' ? 'ok' : 'invalid_transition';
    case 'cancel_member':
      return effective === 'held' || effective === 'confirmed' ? 'ok' : 'invalid_transition';
    case 'cancel_manager':
      return effective === 'confirmed' ? 'ok' : 'invalid_transition';
    case 'check_in':
      return effective === 'confirmed' ? 'ok' : 'invalid_transition';
    case 'no_show':
      return effective === 'confirmed' ? 'ok' : 'invalid_transition';
    case 'check_out':
      return effective === 'checked_in' ? 'ok' : 'invalid_transition';
  }
}

export interface MemberForLedger {
  id: string;
  tenant_id: string;
  home_zone: string;
}

/** The hold's single hold_release movement, with its hours back in the lots it drew from. */
export async function releaseHeldBooking(
  client: PoolClient,
  booking: BookingRecord,
  member: MemberForLedger,
  atMs: number,
  options: { status: 'expired' | 'cancelled'; actorUserId: string | null; actorName: string | null },
): Promise<LotAllocation[]> {
  const allocations = await returnToLots(client, booking.id, booking.quarters);
  await recordMovement(client, {
    tenantId: booking.tenant_id,
    memberId: booking.member_id,
    kind: 'hold_release',
    quarters: booking.quarters,
    createdAtMs: atMs,
    actor:
      options.actorUserId === null || options.actorName === null
        ? null
        : { userId: options.actorUserId, name: options.actorName, role: 'member' },
    bookingId: booking.id,
    lots: allocations,
  });
  await expireReturnedHours(client, member, allocations, atMs);
  await client.query(
    `update bookings set status = $2, refunded_quarters = $3, forfeited_quarters = 0,
       cancelled_by_user_id = $4, cancelled_by_name = $5
      where id = $1`,
    [
      booking.id,
      options.status,
      booking.quarters,
      options.actorUserId,
      options.actorName,
    ],
  );
  return allocations;
}

/**
 * Expires every hold that has reached its instant, exactly once across processes, before
 * any answer can depend on it.
 */
export async function sweepExpiredHolds(): Promise<void> {
  const at = nowMs();
  const due = await query<{ id: string }>(
    `select id from bookings where status = 'held' and hold_expires_at <= $1 limit 200`,
    [new Date(at).toISOString()],
  );
  for (const row of due) {
    await tx(async (client) => {
      await lock(client, LOCK_BOOKING, row.id);
      const booking = await loadBooking(client, row.id);
      if (booking === null || booking.status !== 'held') return;
      if (holdIsLive(booking.hold_expires_at?.getTime() ?? null, nowMs())) return;
      const expiredAt = booking.hold_expires_at?.getTime() ?? nowMs();
      await releaseHeldBooking(
        client,
        booking,
        { id: booking.member_id, tenant_id: booking.tenant_id, home_zone: booking.home_zone },
        expiredAt,
        { status: 'expired', actorUserId: null, actorName: null },
      );
    });
  }
}

export async function lockStation(client: PoolClient, stationId: string): Promise<void> {
  await lock(client, LOCK_STATION, stationId);
}

export async function lockBooking(client: PoolClient, bookingId: string): Promise<void> {
  await lock(client, LOCK_BOOKING, bookingId);
}

export interface InsertBookingInput {
  tenantId: string;
  siteId: string;
  stationId: string;
  memberId: string;
  reference: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  startAtMs: number;
  endAtMs: number;
  occupiedEndMs: number;
  quarters: number;
  status: 'held' | 'confirmed';
  holdExpiresAtMs: number | null;
  seriesId: string | null;
  createdAtMs: number;
}

export async function insertBooking(
  client: PoolClient,
  input: InsertBookingInput,
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `insert into bookings (id, tenant_id, site_id, station_id, member_id, reference, booking_date,
       start_minutes, end_minutes, start_at, end_at, occupied_end_at, quarters, status,
       hold_expires_at, series_id, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      id,
      input.tenantId,
      input.siteId,
      input.stationId,
      input.memberId,
      input.reference,
      input.date,
      input.startMinutes,
      input.endMinutes,
      new Date(input.startAtMs).toISOString(),
      new Date(input.endAtMs).toISOString(),
      new Date(input.occupiedEndMs).toISOString(),
      input.quarters,
      input.status,
      input.holdExpiresAtMs === null ? null : new Date(input.holdExpiresAtMs).toISOString(),
      input.seriesId,
      new Date(input.createdAtMs).toISOString(),
    ],
  );
  return id;
}

export interface StationRecord {
  id: string;
  site_id: string;
  tenant_id: string;
  name: string;
  kind: StationKind;
  time_zone: string;
}

export async function stationRecord(stationId: string): Promise<StationRecord | null> {
  const found = await query<StationRecord>(
    `select st.id, st.site_id, st.tenant_id, st.name, st.kind, s.time_zone
       from stations st join sites s on s.id = st.site_id where st.id = $1`,
    [stationId],
  );
  return found.length === 0 ? null : (found[0] as StationRecord);
}


import type { PoolClient } from 'pg';
import { ApiError, statusWord } from './errors.js';
import { formatHours, formatInstant, monthOf } from './time.js';
import { blockLabel } from './copy.js';
import { isoDate, type BookingRow } from './booking.js';
import { offeredActions } from './booking.js';
import { hourBank } from './hourbank.js';
import type { KitchenRow, PersonRow } from './context.js';
import { rateStatus, type RateVersionRow, type StationRow } from './pricing.js';
import type { DocumentRow } from './documents.js';

export interface StationNameIndex {
  [stationId: string]: StationRow;
}

export async function stationIndex(client: PoolClient, kitchenId: string): Promise<StationNameIndex> {
  const result = await client.query<StationRow>(`SELECT * FROM stations WHERE kitchen_id=$1 ORDER BY lane_order`, [kitchenId]);
  const index: StationNameIndex = {};
  for (const row of result.rows) index[row.id] = row;
  return index;
}

export async function businessName(client: PoolClient, memberId: string): Promise<string> {
  const result = await client.query<{ business_name: string }>(`SELECT business_name FROM members WHERE id=$1`, [memberId]);
  if (result.rows.length === 0) throw new ApiError('not_found');
  return result.rows[0].business_name;
}

export async function billingStatusFor(client: PoolClient, bookingId: string): Promise<'billed' | 'pending_billing' | 'not_billed'> {
  const result = await client.query<{ count: string; recorded: string }>(
    `SELECT count(*)::text AS count, count(*) FILTER (WHERE recorded)::text AS recorded FROM kb_items WHERE booking_id=$1`,
    [bookingId],
  );
  const row = result.rows[0];
  if (Number(row.count) === 0) return 'not_billed';
  return Number(row.recorded) === Number(row.count) ? 'billed' : 'pending_billing';
}

/** The full booking shape, as staff and the owning member see it. */
export async function bookingObject(
  client: PoolClient,
  booking: BookingRow,
  caller: { id: string; role: string; member_id: string | null },
  kitchen: Pick<KitchenRow, 'id' | 'time_zone'>,
  now: Date,
  graceSeconds: number,
): Promise<Record<string, unknown>> {
  const business = await businessName(client, booking.member_id);
  const closed = await monthClosed(client, booking.kitchen_id, monthOf(isoDate(booking.local_date)));
  const billing = await billingStatusFor(client, booking.id);
  const station = await client.query<{ name: string }>(`SELECT name FROM stations WHERE id=$1`, [booking.station_id]);
  return {
    id: booking.id,
    memberId: booking.member_id,
    businessName: business,
    stationId: booking.station_id,
    stationName: station.rows[0]?.name ?? booking.station_id,
    kind: booking.kind,
    localDate: isoDate(booking.local_date),
    localStart: booking.local_start,
    localEnd: booking.local_end,
    days: booking.days,
    start: formatInstant(booking.start_at, kitchen.time_zone),
    end: formatInstant(booking.end_at, kitchen.time_zone),
    status: booking.status,
    billingStatus: booking.status === 'held' || booking.status === 'expired' ? 'not_billed' : billing,
    hours: Number(booking.hours),
    peakHours: Number(booking.peak_hours),
    chargeCents: booking.charge_cents,
    penaltyCents: booking.penalty_cents,
    penaltyWaived: booking.penalty_waived,
    conflict: booking.conflict,
    seriesId: booking.series_id,
    notes: booking.notes,
    holdExpiresAt: booking.hold_expires_at ? formatInstant(booking.hold_expires_at, kitchen.time_zone) : null,
    confirmedAt: booking.confirmed_at ? formatInstant(booking.confirmed_at, kitchen.time_zone) : null,
    actions: offeredActions(booking, { personId: caller.id, role: caller.role as 'operator' | 'shift_lead' | 'member', memberId: caller.member_id }, now, graceSeconds, closed),
    version: booking.version,
  };
}

/** Another member's block on a shared board: "booked" shape, no business name. */
export function bookedObject(booking: BookingRow, kitchen: KitchenRow): Record<string, unknown> {
  return {
    id: booking.id,
    stationId: booking.station_id,
    localDate: isoDate(booking.local_date),
    localStart: booking.local_start,
    localEnd: booking.local_end,
    days: booking.days,
    start: formatInstant(booking.start_at, kitchen.time_zone),
    end: formatInstant(booking.end_at, kitchen.time_zone),
    status: 'booked',
  };
}

export async function monthClosed(client: PoolClient, kitchenId: string, month: string): Promise<boolean> {
  const result = await client.query<{ closed: boolean }>(
    `SELECT closed FROM invoice_state WHERE kitchen_id=$1 AND month=$2`,
    [kitchenId, month],
  );
  return result.rows[0]?.closed === true;
}

export async function hourBankObject(client: PoolClient, memberId: string, month: string): Promise<Record<string, unknown>> {
  const bank = await hourBank(client, memberId, month);
  return {
    month: bank.month,
    allowanceHours: bank.allowanceHours,
    usedHours: bank.usedHours,
    balanceHours: bank.balanceHours,
  };
}

export function rateObject(version: RateVersionRow, versions: RateVersionRow[], now: Date, kind: 'hourly' | 'shelf'): Record<string, unknown> {
  const base: Record<string, unknown> = {
    effectiveFrom: version.effective_from_local,
    effectiveAt: formatInstant(version.effective_at, 'UTC'),
    status: rateStatus(version, versions, now),
  };
  if (kind === 'hourly') {
    base.offPeakHourlyCents = version.off_peak_cents;
    base.peakCents = version.peak_cents;
  } else {
    base.shelfDayCents = version.shelf_day_cents;
  }
  return base;
}

export async function stationObject(
  client: PoolClient,
  station: StationRow,
  now: Date,
): Promise<Record<string, unknown>> {
  const versions = (
    await client.query<RateVersionRow>(`SELECT * FROM rate_versions WHERE station_id=$1 ORDER BY effective_at`, [station.id])
  ).rows;
  const current = [...versions].reverse().find((v) => v.effective_at.getTime() <= now.getTime()) ?? null;
  return {
    id: station.id,
    name: station.name,
    kind: station.kind,
    capacity: station.capacity,
    currentRate: current ? rateObject(current, versions, now, station.kind) : null,
    rates: versions.map((v) => rateObject(v, versions, now, station.kind)),
  };
}

export function documentObject(doc: DocumentRow, business: string, today: string): Record<string, unknown> {
  const status = doc.superseded ? 'superseded' : doc.approved_at ? expiryStatusOf(doc, today) : 'submitted';
  return {
    id: doc.id,
    memberId: doc.member_id,
    businessName: business,
    type: doc.type,
    expiryDate: doc.expiry_date,
    status,
    current: false,
    fileName: doc.file_name,
    contentType: doc.content_type,
    sizeBytes: doc.size_bytes,
    uploadedAt: formatInstant(doc.uploaded_at, 'UTC'),
    approvedAt: doc.approved_at ? formatInstant(doc.approved_at, 'UTC') : null,
    version: doc.version,
  };
}

function expiryStatusOf(doc: DocumentRow, today: string): 'approved' | 'expiring' | 'expired' {
  const a = Date.parse(`${doc.expiry_date}T12:00:00Z`);
  const b = Date.parse(`${today}T12:00:00Z`);
  const d = Math.round((a - b) / 86400000);
  if (d < 0) return 'expired';
  if (d <= 14) return 'expiring';
  return 'approved';
}

export { statusWord, formatHours, blockLabel };

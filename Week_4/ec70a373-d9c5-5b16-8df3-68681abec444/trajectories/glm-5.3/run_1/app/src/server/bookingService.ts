import type { DbClient, Row } from './db.js';
import { clientQuery } from './db.js';
import type { AppContext, SessionUser } from './context.js';
import { memberById } from './context.js';
import { nowMs } from '../clock.js';
import { datePlusDays, localDateOfInstant, weekdayName, zoneDayStart, zoneInstant } from '../sitetime.js';
import { ApiError } from './errors.js';
import { uuid } from './ids.js';
import {
  certificateCovers,
  certificateValidThrough,
  conflictsForWindow,
  cutoffRefusal,
  loadSite,
  loadStation,
  liveHolds,
  nextReference,
  parseWindow,
  pastHorizon,
  resolveWindow,
  type BookingRow,
  type SiteRow,
} from './domain.js';
import {
  drawFromLots,
  loadLots,
  memberBalances,
  recordBookingDraw,
  returnToLots,
  writeMovement,
} from './ledger.js';
import { HOLD_LIMIT, BOOKING_HORIZON_DAYS } from './rules.js';
import { queueMail } from './mail.js';
import { bookingWire, minutesToTime, lotsWire } from './wire.js';
import type { Json } from '../types.js';
import { EXPIRING_SOON_DAYS } from './rules.js';

export interface HoldInput {
  stationId: string;
  date: string;
  start: string;
  end: string;
}

export async function createHold(
  ctx: AppContext,
  client: DbClient,
  actor: SessionUser,
  input: HoldInput,
): Promise<{ body: Json; bookingId: string }> {
  const station = await loadStation(client, input.stationId);
  if (!station || station.site_id === null) throw new ApiError(404, 'not_found', 'There is nothing here.');
  const site = await loadSite(client, station.site_id);
  if (!site || site.tenant_id !== actor.tenantId) throw new ApiError(404, 'not_found', 'There is nothing here.');
  const member = await memberById(client, actor.userId);
  if (!member) throw new ApiError(404, 'not_found', 'There is nothing here.');
  const at = nowMs();

  const window = parseWindow(input.date, input.start, input.end);
  if (pastHorizon(site, window.date, at)) {
    throw new ApiError(422, 'validation', 'That date is too far ahead.', { fields: { date: 'Choose a date within 90 days.' } });
  }
  const validThrough = await certificateValidThrough(client, actor.userId);
  if (!certificateCovers(validThrough, site.time_zone, window.date, at)) {
    throw new ApiError(422, 'certificate_expired', 'The certificate of insurance does not cover that date.');
  }
  if (cutoffRefusal(site, window.date, at)) {
    throw new ApiError(422, 'cutoff', 'That date is closed for booking.');
  }
  const holds = await liveHolds(client, actor.userId, at);
  if (holds.length >= HOLD_LIMIT) {
    throw new ApiError(422, 'hold_limit', 'You already hold 3 windows. Confirm or release one first.');
  }
  const resolved = resolveWindow(site, window);
  const balance = await memberBalances(client, actor.userId);
  if (resolved.quarterHours > balance.availableQh) {
    throw new ApiError(422, 'insufficient_hours', 'Not enough pack hours for this window. Buy a pack to continue.');
  }
  const conflicts = await conflictsForWindow(
    client,
    station.id,
    station.kind,
    { startAt: resolved.startAt, endAt: resolved.endAt },
  );
  if (conflicts.length > 0) {
    throw new ApiError(409, 'slot_taken', 'Someone else just claimed that window.');
  }
  const bookingId = uuid();
  const reference = await nextReference(client, site.tenant_id);
  const holdExpiresAt = at + ctx.env.HOLD_TTL_SECONDS * 1000;
  await clientQuery(
    client,
    `INSERT INTO bookings (id, tenant_id, site_id, station_id, member_id, series_id, reference, date,
       start_minute, end_minute, start_at, end_at, quarter_hours, status, hold_expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9, $10, $11, $12, 'held', $13, $14)`,
    [
      bookingId,
      site.tenant_id,
      site.id,
      station.id,
      actor.userId,
      reference,
      window.date,
      window.startMinute,
      window.endMinute,
      resolved.startAt,
      resolved.endAt,
      resolved.quarterHours,
      holdExpiresAt,
      at,
    ],
  );
  const draws = await drawFromLots(client, actor.userId, resolved.quarterHours);
  await recordBookingDraw(client, bookingId, draws);
  await writeMovement(client, {
    memberId: actor.userId,
    tenantId: site.tenant_id,
    kind: 'booking_debit',
    fromAccount: 'available',
    toAccount: 'committed',
    quarterHours: resolved.quarterHours,
    bookingId,
    actor: { userId: actor.userId, name: actor.name, role: 'member' },
    atMs: at,
    lots: draws,
  });
  const row = (await clientQuery<Row>(client, `SELECT * FROM bookings WHERE id = $1`, [bookingId]))[0];
  const wire = bookingWire(row as unknown as BookingRow, station.name, String(member.business_name ?? ''));
  const balances = await balancesFor(client, actor.userId);
  return { body: { booking: wire, balances } as unknown as Json, bookingId };
}

export async function balancesFor(client: DbClient, memberId: string): Promise<Json> {
  const balance = await memberBalances(client, memberId);
  const lots = await loadLots(client, memberId);
  const member = await memberById(client, memberId);
  let zone = 'UTC';
  if (member?.site_id) {
    const site = await clientQuery<Row>(client, `SELECT time_zone FROM sites WHERE id = $1`, [member.site_id]);
    if (site.length > 0) zone = String(site[0].time_zone);
  }
  const today = localDateOfInstant(nowMs(), zone);
  return {
    available_hours: balance.availableQh / 4,
    committed_hours: balance.committedQh / 4,
    lots: lotsWire(lots, today, EXPIRING_SOON_DAYS),
  };
}



export async function cancelBooking(
  ctx: AppContext,
  client: DbClient,
  actor: SessionUser,
  booking: BookingRow,
  reason: string | null,
  at: number,
): Promise<{ body: Json }> {
  void ctx;
  const isHeld = booking.status === 'held';
  const live = isHeld && (booking.hold_expires_at === null || Number(booking.hold_expires_at) > at);
  if (isHeld) {
    if (!live) throw new ApiError(409, 'hold_expired', 'That hold has expired.');
    if (actor.role !== 'member') throw new ApiError(409, 'invalid_transition', 'A kitchen manager cannot cancel a held booking.');
  } else if (booking.status !== 'confirmed') {
    throw new ApiError(409, 'invalid_transition', 'That booking cannot be cancelled.');
  }
  const updated = await clientQuery<Row>(
    client,
    `UPDATE bookings SET status = 'cancelled', cancelled_by_user = $2, cancelled_by_name = $3,
       cancellation_reason = $4, refunded_qh = $5, forfeited_qh = $6, hold_expires_at = NULL
     WHERE id = $1 AND status = $7 RETURNING *`,
    [
      booking.id,
      actor.userId,
      actor.name,
      reason,
      isHeld ? booking.quarter_hours : 0,
      isHeld ? 0 : 0,
      booking.status,
    ],
  );
  if (updated.length === 0) throw new ApiError(409, 'invalid_transition', 'That booking changed elsewhere.');
  let refundedQh: number;
  let forfeitedQh: number;
  if (isHeld) {
    refundedQh = Number(booking.quarter_hours);
    forfeitedQh = 0;
    const returns = await returnToLots(client, booking.member_id, booking.id, refundedQh);
    await writeMovement(client, {
      memberId: booking.member_id,
      tenantId: booking.tenant_id,
      kind: 'hold_release',
      fromAccount: 'committed',
      toAccount: 'available',
      quarterHours: refundedQh,
      bookingId: booking.id,
      actor: { userId: actor.userId, name: actor.name, role: actor.role },
      atMs: at,
      lots: returns,
    });
    await followExpiredReturns(ctx, client, booking.member_id, booking.tenant_id, returns, at);
  } else {
    const split = forfeitSplit(Number(booking.quarter_hours), at - Number(booking.start_at));
    refundedQh = split.refundedQh;
    forfeitedQh = split.forfeitedQh;
    await clientQuery(
      client,
      `UPDATE bookings SET refunded_qh = $2, forfeited_qh = $3 WHERE id = $1`,
      [booking.id, refundedQh, forfeitedQh],
    );
    if (refundedQh > 0) {
      const returns = await returnToLots(client, booking.member_id, booking.id, refundedQh);
      await writeMovement(client, {
        memberId: booking.member_id,
        tenantId: booking.tenant_id,
        kind: 'cancel_refund',
        fromAccount: 'committed',
        toAccount: 'available',
        quarterHours: refundedQh,
        bookingId: booking.id,
        actor: { userId: actor.userId, name: actor.name, role: actor.role },
        atMs: at,
        lots: returns,
      });
      await followExpiredReturns(ctx, client, booking.member_id, booking.tenant_id, returns, at);
    }
    if (forfeitedQh > 0) {
      await writeMovement(client, {
        memberId: booking.member_id,
        tenantId: booking.tenant_id,
        kind: 'forfeit',
        fromAccount: 'committed',
        toAccount: 'forfeited',
        quarterHours: forfeitedQh,
        bookingId: booking.id,
        actor: { userId: actor.userId, name: actor.name, role: actor.role },
        atMs: at,
        lots: [],
      });
    }
  }
  const row = (await clientQuery<Row>(client, `SELECT * FROM bookings WHERE id = $1`, [booking.id]))[0];
  const station = await loadStation(client, booking.station_id);
  const member = await memberById(client, booking.member_id);
  const wire = bookingWire(row as unknown as BookingRow, String(station?.name ?? ''), String(member?.business_name ?? ''));
  const body: Record<string, Json> = {
    booking: wire as unknown as Json,
    refunded_hours: refundedQh / 4,
    forfeited_hours: forfeitedQh / 4,
  };
  if (actor.role === 'member') {
    body.balances = (await balancesFor(client, booking.member_id)) as unknown as Json;
  }
  const email = await memberEmail(client, booking.member_id);
  const site = await loadSite(client, booking.site_id);
  const staffLine = actor.role === 'kitchen_manager' ? `Cancelled by ${site?.name ?? ''} staff. Reason: ${reason ?? ''}` : undefined;
  await queueMail(client, booking.tenant_id, {
    kind: 'booking_cancelled',
    to: email,
    station: String(station?.name ?? ''),
    date: booking.date,
    start: minutesToTime(Number(booking.start_minute)),
    end: minutesToTime(Number(booking.end_minute)),
    refunded: refundedQh,
    forfeited: forfeitedQh,
    staffLine,
  });
  return { body: body as Json };
}

/** The forfeit split by elapsed notice, with half the quarter hours rounded up. */
export function forfeitSplit(quarterHours: number, noticeMs: number): { refundedQh: number; forfeitedQh: number } {
  if (noticeMs >= 72 * 3600000) {
    return { refundedQh: quarterHours, forfeitedQh: 0 };
  }
  if (noticeMs >= 48 * 3600000) {
    const forfeited = Math.ceil(quarterHours / 2);
    return { refundedQh: quarterHours - forfeited, forfeitedQh: forfeited };
  }
  return { refundedQh: 0, forfeitedQh: quarterHours };
}

async function followExpiredReturns(
  ctx: AppContext,
  client: DbClient,
  memberId: string,
  tenantId: string,
  returns: Array<{ lotId: number; purchaseId: string | null; quarterHours: number }>,
  at: number,
): Promise<void> {
  for (const item of returns) {
    const lotRows = await clientQuery<Row>(client, `SELECT valid_through FROM lots WHERE id = $1`, [item.lotId]);
    const lot = lotRows[0];
    if (!lot || lot.valid_through === null) continue;
    const member = await memberById(client, memberId);
    let zone = 'UTC';
    if (member?.site_id) {
      const site = await clientQuery<Row>(client, `SELECT time_zone FROM sites WHERE id = $1`, [member.site_id]);
      if (site.length > 0) zone = String(site[0].time_zone);
    }
    const expiryInstant = zoneDayStart(datePlusDays(String(lot.valid_through).slice(0, 10), 1), zone);
    if (at >= expiryInstant) {
      await clientQuery(client, `UPDATE lots SET remainder_qh = GREATEST(0, remainder_qh - $1) WHERE id = $2`, [item.quarterHours, item.lotId]);
      await writeMovement(client, {
        memberId,
        tenantId,
        kind: 'pack_expiry',
        fromAccount: 'available',
        toAccount: 'expired',
        quarterHours: item.quarterHours,
        actor: null,
        atMs: at,
        lots: [item],
      });
    }
  }
  void ctx;
}

export async function memberEmail(client: DbClient, memberId: string): Promise<string> {
  const rows = await clientQuery<Row>(client, `SELECT email FROM users WHERE id = $1`, [memberId]);
  return String(rows[0].email);
}

export interface SeriesInput {
  stationId: string;
  firstDate: string;
  start: string;
  end: string;
  weeks: number;
}

export async function createSeries(
  ctx: AppContext,
  client: DbClient,
  actor: SessionUser,
  input: SeriesInput,
): Promise<{ body: Json; seriesId: string }> {
  const station = await loadStation(client, input.stationId);
  if (!station) throw new ApiError(404, 'not_found', 'There is nothing here.');
  const site = await loadSite(client, station.site_id);
  if (!site || site.tenant_id !== actor.tenantId) throw new ApiError(404, 'not_found', 'There is nothing here.');
  const member = await memberById(client, actor.userId);
  if (!member) throw new ApiError(404, 'not_found', 'There is nothing here.');
  const at = nowMs();
  const window = parseWindow(input.firstDate, input.start, input.end);
  if (pastHorizon(site, window.date, at)) {
    throw new ApiError(422, 'validation', 'That date is too far ahead.', { fields: { first_date: 'Choose a date within 90 days.' } });
  }
  const lastDate = datePlusDays(window.date, 7 * (input.weeks - 1));
  if (pastHorizon(site, lastDate, at)) {
    throw new ApiError(422, 'validation', 'That series runs too far ahead.', { fields: { weeks: 'Choose fewer weeks.' } });
  }
  const validThrough = await certificateValidThrough(client, actor.userId);
  const dates: string[] = [];
  for (let i = 0; i < input.weeks; i += 1) dates.push(datePlusDays(window.date, 7 * i));
  const uncovered = validThrough === null
    ? dates.slice()
    : (await coverageGaps(validThrough, site.time_zone, dates, at));
  if (uncovered.length > 0) {
    throw new ApiError(422, 'certificate_expired', 'The certificate of insurance does not cover every occurrence.', {
      extra: { dates: uncovered },
    });
  }
  if (cutoffRefusal(site, window.date, at)) {
    throw new ApiError(422, 'cutoff', 'That date is closed for booking.');
  }
  const resolvedEach = dates.map((date) => resolveWindow(site, { date, startMinute: window.startMinute, endMinute: window.endMinute }));
  const totalQh = resolvedEach.reduce((sum, item) => sum + item.quarterHours, 0);
  const balance = await memberBalances(client, actor.userId);
  if (totalQh > balance.availableQh) {
    throw new ApiError(422, 'insufficient_hours', 'Not enough pack hours for this series. Buy a pack to continue.');
  }
  const conflictingDates: string[] = [];
  for (let i = 0; i < dates.length; i += 1) {
    const conflicts = await conflictsForWindow(client, station.id, station.kind, {
      startAt: resolvedEach[i].startAt,
      endAt: resolvedEach[i].endAt,
    });
    if (conflicts.length > 0) conflictingDates.push(dates[i]);
  }
  if (conflictingDates.length > 0) {
    throw new ApiError(409, 'series_conflict', 'Some weeks are taken.', { extra: { dates: conflictingDates } });
  }
  const seriesId = uuid();
  await clientQuery(
    client,
    `INSERT INTO series (id, station_id, weekday, start_minute, end_minute, weeks) VALUES ($1, $2, $3, $4, $5, $6)`,
    [seriesId, station.id, new Date(window.date + 'T00:00:00Z').getUTCDay(), window.startMinute, window.endMinute, input.weeks],
  );
  const reference = await nextReference(client, site.tenant_id);
  const bookingRows: Row[] = [];
  for (let i = 0; i < dates.length; i += 1) {
    const bookingId = uuid();
    await clientQuery(
      client,
      `INSERT INTO bookings (id, tenant_id, site_id, station_id, member_id, series_id, reference, date,
         start_minute, end_minute, start_at, end_at, quarter_hours, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'confirmed', $14)`,
      [
        bookingId,
        site.tenant_id,
        site.id,
        station.id,
        actor.userId,
        seriesId,
        reference,
        dates[i],
        window.startMinute,
        window.endMinute,
        resolvedEach[i].startAt,
        resolvedEach[i].endAt,
        resolvedEach[i].quarterHours,
        at,
      ],
    );
    const draws = await drawFromLots(client, actor.userId, resolvedEach[i].quarterHours);
    await recordBookingDraw(client, bookingId, draws);
    await writeMovement(client, {
      memberId: actor.userId,
      tenantId: site.tenant_id,
      kind: 'booking_debit',
      fromAccount: 'available',
      toAccount: 'committed',
      quarterHours: resolvedEach[i].quarterHours,
      bookingId,
      actor: { userId: actor.userId, name: actor.name, role: 'member' },
      atMs: at,
      lots: draws,
    });
    const row = (await clientQuery<Row>(client, `SELECT * FROM bookings WHERE id = $1`, [bookingId]))[0];
    bookingRows.push(row);
  }
  const wires = bookingRows.map((row) => bookingWire(row as unknown as BookingRow, station.name, String(member.business_name ?? '')));
  const balances = await balancesFor(client, actor.userId);
  const email = await memberEmail(client, actor.userId);
  await queueMail(client, site.tenant_id, {
    kind: 'series_booked',
    to: email,
    station: station.name,
    weekday: weekdayName(window.date),
    start: minutesToTime(window.startMinute),
    end: minutesToTime(window.endMinute),
    weeks: input.weeks,
    dates,
    totalHours: totalQh / 4,
  });
  return {
    body: {
      series: {
        id: seriesId,
        station_id: station.id,
        weekday: new Date(window.date + 'T00:00:00Z').getUTCDay(),
        start: minutesToTime(window.startMinute),
        end: minutesToTime(window.endMinute),
        weeks: input.weeks,
      },
      bookings: wires as unknown as Json[],
      balances,
    } as unknown as Json,
    seriesId,
  };
}

async function coverageGaps(validThrough: string, zone: string, dates: string[], at: number): Promise<string[]> {
  const today = localDateOfInstant(nowMs(), zone);
  if (today > validThrough) return [...dates];
  return dates.filter((date) => date > validThrough);
}

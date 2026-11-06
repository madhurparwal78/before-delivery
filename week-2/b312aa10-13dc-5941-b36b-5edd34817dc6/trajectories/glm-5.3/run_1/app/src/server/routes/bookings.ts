import type { AuthedRequest } from '../api-core.js';
import { callerOf, forbidden } from '../api-core.js';
import { ApiError, monthName } from '../errors.js';
import { withContentionRetry } from '../db.js';
import { parseJsonBody, type Handler, type RouteContext } from '../pipeline.js';
import { requireIdempotencyKey, bodyFingerprint, checkIdempotency, storeIdempotentResponse } from '../idempotency.js';
import {
  addDays,
  formatHours,
  monthOf,
  resolveLocal,
  resolvedInstant,
  todayInZone,
  isLocalDate,
  wallClockHours,
} from '../time.js';
import { bookingObject, hourBankObject, monthClosed } from '../serialize.js';
import {
  applyLapses,
  getBooking,
  invalidTransition,
  shelfDaysFull,
  timeIsFree,
  type BookingRow,
} from '../booking.js';
import { priceBlock, rateForBlock, type PeakWindow, type RateVersionRow, type StationRow } from '../pricing.js';
import { currentDocument, documentTypeName, type DocumentType } from '../documents.js';
import { recordLedgerPair } from '../ledgerpair.js';
import { lockMemberMonth, ledgerSum } from '../hourbank.js';
import { blockLabel, confirmEmailBody } from '../copy.js';
import { codePoints, newId, normaliseText } from '../util.js';
import { getPersonEmail } from './helpers.js';
import type { PoolClient } from 'pg';

const nowDate = (): Date => new Date();

interface Caller {
  person: { id: string; member_id: string | null; role: string };
  kitchen: { id: string; time_zone: string; peak_windows: PeakWindow[]; required_documents: string[] };
}

async function loadStation(client: PoolClient, kitchenId: string, stationId: string): Promise<StationRow> {
  const result = await client.query<StationRow>(`SELECT * FROM stations WHERE id=$1 AND kitchen_id=$2`, [stationId, kitchenId]);
  if (result.rows.length === 0) throw new ApiError('not_found');
  return result.rows[0];
}

async function stationNameOf(client: PoolClient, stationId: string): Promise<string> {
  const result = await client.query<{ name: string }>(`SELECT name FROM stations WHERE id=$1`, [stationId]);
  return result.rows[0]?.name ?? stationId;
}

const QUARTER_TIME = /^([01]\d|2[0-3]):[0-5][0-9]$/;
const END_TIME = /^(([01]\d|2[0-3]):[0-5][0-9]|24:00)$/;

const HOLD_KEYS_HOURLY = ['stationId', 'date', 'start', 'end', 'repeatWeeks', 'notes'];
const HOLD_KEYS_SHELF = ['stationId', 'date', 'days', 'notes'];
const MOVE_KEYS_HOURLY = ['stationId', 'date', 'start', 'end', 'version'];
const MOVE_KEYS_SHELF = ['stationId', 'date', 'days', 'version'];

function checkKeys(body: Record<string, unknown>, allowed: string[], errors: Record<string, string>): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) errors[key] = 'This field cannot be set.';
  }
}

function isQuarterTime(t: string): boolean {
  return QUARTER_TIME.test(t) && Number(t.slice(3)) % 15 === 0;
}

function isEndTime(t: string): boolean {
  return END_TIME.test(t) && (t === '24:00' || Number(t.slice(3)) % 15 === 0);
}

/** Resolve a local wall time; a time that does not exist answers 422 on its field. */
function resolveOrError(localDate: string, hhmm: string, tz: string, field: string, errors: Record<string, string>): Date | null {
  const resolved = resolveLocal(localDate, hhmm, tz);
  if (!resolved.ok) {
    errors[field] = `${hhmm} does not exist on ${localDate} in ${tz} (clocks go forward).`;
    return null;
  }
  return resolved.instant;
}

function blockEndInstant(localDate: string, localEnd: string | null, days: number | null, kind: string, tz: string): Date {
  if (kind === 'shelf') {
    return resolvedInstant(resolveLocal(addDays(addDays(localDate, (days ?? 1) - 1), 1), '00:00', tz));
  }
  if (localEnd === '24:00') {
    return resolvedInstant(resolveLocal(addDays(localDate, 1), '00:00', tz));
  }
  return resolvedInstant(resolveLocal(localDate, localEnd ?? '00:00', tz));
}

function blockStartInstant(localDate: string, localStart: string | null, tz: string): Date {
  return resolvedInstant(resolveLocal(localDate, localStart ?? '00:00', tz));
}

/** Document rule: an approved document of each required type covering the whole block. */
async function documentCheck(
  client: PoolClient,
  memberId: string,
  requiredTypes: string[],
  today: string,
  blockFirstDate: string,
  kind: string,
  days: number | null,
): Promise<string | null> {
  const lastDay = kind === 'shelf' ? addDays(blockFirstDate, (days ?? 1) - 1) : blockFirstDate;
  for (const type of requiredTypes) {
    const doc = await currentDocument(client, memberId, type as DocumentType, today);
    if (!doc) return `Upload an approved ${documentTypeName(type as DocumentType)} before booking.`;
    if (lastDay > doc.row.expiry_date) {
      return `Your ${documentTypeName(type as DocumentType)} expires on ${doc.row.expiry_date}, before this block.`;
    }
  }
  return null;
}

/** Hours needed in a month against the ledger alone; returns the balance when it falls short. */
async function hoursShort(
  client: PoolClient,
  memberId: string,
  month: string,
  addedHours: number,
): Promise<number | null> {
  const member = await client.query<{ allowance_hours: number }>(`SELECT allowance_hours FROM members WHERE id=$1`, [memberId]);
  const used = await ledgerSum(client, memberId, month);
  const balance = Math.max(0, member.rows[0].allowance_hours - used);
  if (balance < addedHours) return balance;
  return null;
}

async function priceFor(
  client: PoolClient,
  station: StationRow,
  windows: PeakWindow[],
  kind: 'hourly' | 'shelf',
  localDate: string,
  localStart: string | null,
  localEnd: string | null,
  days: number | null,
  startInstant: Date,
): Promise<{ chargeCents: number; hours: number; peakHours: number }> {
  const versions = (await client.query<RateVersionRow>(`SELECT * FROM rate_versions WHERE station_id=$1`, [station.id])).rows;
  const version = rateForBlock(versions, startInstant);
  return priceBlock({ kind, days, localDate, localStart, localEnd, version, windows });
}

/** Confirms and moves for one member and month are settled one at a time; a close never interleaves. */
async function lockMonths(client: PoolClient, kitchenId: string, memberIds: string[], months: string[]): Promise<void> {
  const sortedMembers = [...new Set(memberIds)].sort();
  const sortedMonths = [...new Set(months)].sort();
  for (const memberId of sortedMembers) {
    for (const month of sortedMonths) {
      await lockMemberMonth(client, memberId, month);
    }
  }
  for (const month of sortedMonths) {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2))`, [`month:${kitchenId}`, month]);
  }
}

// ---------------------------------------------------------------------------
// POST /api/bookings — hold
// ---------------------------------------------------------------------------
export const createHold: Handler = async (req, res, ctx) => {
  const caller = callerOf(req);
  if (caller.person.role !== 'member' || !caller.person.member_id) throw forbidden();
  const key = requireIdempotencyKey(req.headers['idempotency-key'] as string | undefined);
  const body = parseJsonBody(req.rawBody) as Record<string, unknown>;
  const fingerprint = bodyFingerprint(body);
  await withContentionRetry(async (client) => {
    const replay = await checkIdempotency(client, caller.person.id, key, 'POST', '/api/bookings', fingerprint);
    if (replay) {
      res.status(replay.status).json(JSON.parse(replay.body));
      return;
    }
    const result = await performHold(client, { person: caller.person, kitchen: caller.kitchen }, body, ctx);
    const responseBody = JSON.stringify(result.body);
    await storeIdempotentResponse(client, caller.person.id, key, result.status, responseBody);
    res.status(result.status).json(JSON.parse(responseBody));
  });
};

interface HoldShape {
  stationId: string;
  date: string;
  start: string | null;
  end: string | null;
  days: number | null;
  repeatWeeks: number;
  notes: string;
}

async function performHold(
  client: PoolClient,
  caller: Caller,
  body: Record<string, unknown>,
  ctx: RouteContext,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const tz = caller.kitchen.time_zone;
  const instant = nowDate();
  const today = todayInZone(instant, tz);
  const stationId = typeof body.stationId === 'string' ? body.stationId : '';
  const station = stationId ? await loadStation(client, caller.kitchen.id, stationId).catch(() => null) : null;
  const errors: Record<string, string> = {};
  const allowedKeys = station?.kind === 'shelf' ? HOLD_KEYS_SHELF : HOLD_KEYS_HOURLY;
  checkKeys(body, allowedKeys, errors);
  const kind: 'hourly' | 'shelf' = station?.kind === 'shelf' ? 'shelf' : 'hourly';
  const req: HoldShape = {
    stationId,
    date: typeof body.date === 'string' ? body.date : '',
    start: kind === 'hourly' && typeof body.start === 'string' ? body.start : null,
    end: kind === 'hourly' && typeof body.end === 'string' ? body.end : null,
    days: kind === 'shelf' && typeof body.days === 'number' ? body.days : null,
    repeatWeeks: body.repeatWeeks === undefined ? 1 : Number(body.repeatWeeks),
    notes: body.notes === undefined ? '' : String(body.notes),
  };
  if (!station) errors.stationId = 'This field is required.';
  if (!isLocalDate(req.date)) errors.date = 'Use a date in the form YYYY-MM-DD.';
  if (kind === 'hourly') {
    if (req.start === null || !isQuarterTime(req.start)) errors.start = 'Times must fall on the quarter hour.';
    if (req.end === null || !isEndTime(req.end)) errors.end = 'Times must fall on the quarter hour.';
    if (!errors.start && !errors.end) {
      const hours = wallClockHours(req.start!, req.end!);
      if (hours <= 0) errors.end = 'End must be after start on the same day.';
      else if (hours < 1) errors.end = 'A block must be at least 1 hour.';
      else if (hours > 12) errors.end = 'A block can be at most 12 hours.';
    }
  } else {
    if (req.days === null || !Number.isInteger(req.days) || req.days < 1 || req.days > 31) {
      errors.days = 'Shelf bookings run 1 to 31 days.';
    }
  }
  if (body.repeatWeeks !== undefined && (!Number.isInteger(req.repeatWeeks) || req.repeatWeeks < 1 || req.repeatWeeks > 12)) {
    errors.repeatWeeks = 'Repeat for 1 to 12 weeks.';
  }
  if (codePoints(normaliseText(req.notes)) > 500) errors.notes = 'Notes can be at most 500 characters.';

  if (!errors.date && !errors.start && !errors.end && !errors.days && isLocalDate(req.date)) {
    const startInst = kind === 'hourly' ? resolveOrError(req.date, req.start!, tz, 'start', errors) : resolveOrError(req.date, '00:00', tz, 'date', errors);
    const endInst = kind === 'hourly' ? resolveOrError(req.date, req.end!, tz, 'end', errors) : blockEndInstant(req.date, null, req.days, 'shelf', tz);
    if (startInst && endInst) {
      if (endInst.getTime() <= instant.getTime()) {
        errors[kind === 'hourly' ? 'end' : 'date'] = 'This block has already ended.';
      } else {
        const limit = new Date(Date.parse(`${today}T12:00:00Z`) + 180 * 86400000);
        if (Date.parse(`${req.date}T12:00:00Z`) > limit.getTime()) errors.date = 'Bookings open 180 days ahead.';
      }
    }
  }
  if (Object.keys(errors).length > 0) throw new ApiError('validation_failed', { errors });

  const weeks: string[] = [];
  for (let i = 0; i < req.repeatWeeks; i++) weeks.push(addDays(req.date, i * 7));

  const months = [...new Set(weeks.map(monthOf))].sort();
  for (const month of months) {
    if (await monthClosed(client, caller.kitchen.id, month)) {
      throw new ApiError('month_closed', {}, (n) => (n === 'monthName' ? monthName(month) : ''));
    }
  }
  await lockMonths(client, caller.kitchen.id, [caller.person.member_id!], months);

  const takenEntries: Record<string, unknown>[] = [];
  if (kind === 'hourly') {
    for (const week of weeks) {
      const free = await timeIsFree(client, station!.id, blockStartInstant(week, req.start, tz), blockEndInstant(week, req.end, null, 'hourly', tz));
      if (!free) takenEntries.push({ stationId: station!.id, stationName: station!.name, date: week, start: req.start, end: req.end });
    }
  } else {
    const days: string[] = [];
    for (let d = 0; d < (req.days ?? 1); d++) days.push(addDays(req.date, d));
    const full = await shelfDaysFull(client, station!.id, station!.capacity ?? 1, days);
    for (const day of full) takenEntries.push({ stationId: station!.id, stationName: station!.name, date: day, start: null, end: null });
  }
  if (takenEntries.length > 0) {
    const first = takenEntries[0] as { stationName: string; date: string; start: string | null };
    const message = kind === 'shelf' ? `${first.stationName} ${first.date} was taken.` : `${first.stationName} ${first.start} block was taken.`;
    throw new ApiError(
      'block_taken',
      { taken: takenEntries },
      (n) => (n === 'station' ? first.stationName : n === 'start' ? (kind === 'shelf' ? first.date : (first.start ?? '')) : ''),
      message,
    );
  }

  const lateErrors: Record<string, string> = {};
  for (const week of weeks) {
    const overlap = await client.query<{ id: string }>(
      `SELECT id FROM out_of_service_windows WHERE station_id=$1 AND start_at < $3 AND end_at > $2`,
      [station!.id, blockStartInstant(week, req.start, tz), blockEndInstant(week, req.end, req.days, kind, tz)],
    );
    if (overlap.rows.length > 0) lateErrors.stationId = `${station!.name} is out of service then.`;
  }
  const docError = await documentCheck(client, caller.person.member_id!, caller.kitchen.required_documents, today, req.date, kind, req.days);
  if (docError) lateErrors.documents = docError;
  if (kind === 'hourly') {
    const byMonth = new Map<string, number>();
    for (const week of weeks) {
      const m = monthOf(week);
      byMonth.set(m, (byMonth.get(m) ?? 0) + wallClockHours(req.start!, req.end!));
    }
    for (const [month, hours] of [...byMonth.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const balance = await hoursShort(client, caller.person.member_id!, month, hours);
      if (balance !== null) {
        lateErrors.hours = `That needs ${formatHours(hours)} hours; you have ${formatHours(balance)} left for ${monthName(month)}.`;
        break;
      }
    }
  }
  if (Object.keys(lateErrors).length > 0) throw new ApiError('validation_failed', { errors: lateErrors });

  const seriesId = req.repeatWeeks > 1 ? newId('ser') : null;
  const bookingsOut: Record<string, unknown>[] = [];
  for (const week of weeks) {
    const startAt = blockStartInstant(week, req.start, tz);
    const endAt = blockEndInstant(week, req.end, req.days, kind, tz);
    const price = await priceFor(client, station!, caller.kitchen.peak_windows, kind, week, req.start, req.end, req.days, startAt);
    const id = newId('bkg');
    await client.query(
      `INSERT INTO bookings (id, kitchen_id, member_id, station_id, kind, local_date, local_start, local_end, days, start_at, end_at, status, series_id, notes, hold_expires_at, charge_cents, hours, peak_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'held',$12,$13,$14,$15,$16,$17)`,
      [
        id, caller.kitchen.id, caller.person.member_id, station!.id, kind, week, req.start, req.end, req.days,
        startAt, endAt, seriesId, normaliseText(req.notes),
        new Date(instant.getTime() + ctx.config.holdTtlSeconds * 1000),
        price.chargeCents, price.hours, price.peakHours,
      ],
    );
    const row = await getBooking(client, id);
    bookingsOut.push(await bookingObject(client, row!, caller.person, caller.kitchen, instant, ctx.config.noShowGraceSeconds));
  }
  return { status: 201, body: { bookings: bookingsOut, seriesId } };
}

// ---------------------------------------------------------------------------
// POST /api/bookings/{id}/confirm
// ---------------------------------------------------------------------------
export const confirmBooking: Handler = async (req, res, ctx) => {
  const caller = callerOf(req);
  const key = requireIdempotencyKey(req.headers['idempotency-key'] as string | undefined);
  const bookingId = String(req.params.id);
  const body = parseJsonBody(req.rawBody);
  const fingerprint = bodyFingerprint(body);
  await withContentionRetry(async (client) => {
    const booking = await getBooking(client, bookingId);
    if (!booking || booking.kitchen_id !== caller.kitchen.id) throw new ApiError('not_found');
    if (caller.person.role !== 'member') throw forbidden();
    if (booking.member_id !== caller.person.member_id) throw new ApiError('not_found');
    const replay = await checkIdempotency(client, caller.person.id, key, 'POST', `/api/bookings/${bookingId}/confirm`, fingerprint);
    if (replay) {
      res.status(replay.status).json(JSON.parse(replay.body));
      return;
    }
    const result = await performConfirm(client, { person: caller.person, kitchen: caller.kitchen }, booking, ctx, new Map());
    const responseBody = JSON.stringify(result.body);
    await storeIdempotentResponse(client, caller.person.id, key, result.status, responseBody);
    res.status(result.status).json(JSON.parse(responseBody));
  });
};

/** Confirms a held ticket, pricing the block again at confirm. */
async function performConfirm(
  client: PoolClient,
  caller: Caller,
  existing: BookingRow,
  ctx: RouteContext,
  postedMemo: Map<string, true>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const tz = caller.kitchen.time_zone;
  const instant = nowDate();
  const today = todayInZone(instant, tz);
  const bookingId = existing.id;
  await applyLapses(client, bookingId, instant, ctx.config.noShowGraceSeconds);
  const fresh = (await getBooking(client, bookingId))!;
  const seriesWeeks = fresh.series_id
    ? (await client.query<BookingRow>(`SELECT * FROM bookings WHERE series_id=$1 AND status='held' ORDER BY local_date`, [fresh.series_id])).rows
    : [fresh];
  const months = [...new Set(seriesWeeks.map((w) => monthOf(w.local_date)))].sort();
  await lockMonths(client, caller.kitchen.id, [fresh.member_id], months);

  if (fresh.status !== 'held') {
    if (fresh.status === 'expired') {
      const free = await timeIsFree(client, fresh.station_id, fresh.start_at, fresh.end_at);
      const stationName = await stationNameOf(client, fresh.station_id);
      if (!free) {
        throw new ApiError(
          'block_taken',
          { taken: [{ stationId: fresh.station_id, stationName, date: fresh.local_date, start: fresh.local_start, end: fresh.local_end }] },
          (n) => (n === 'station' ? stationName : n === 'start' ? (fresh.local_start ?? '') : ''),
        );
      }
      throw new ApiError('hold_expired', {}, (n) =>
        n === 'blockLabel'
          ? blockLabel({ stationName, kind: fresh.kind, localDate: fresh.local_date, localStart: fresh.local_start, localEnd: fresh.local_end, days: fresh.days })
          : '',
      );
    }
    throw invalidTransition(fresh, 'confirm');
  }
  for (const month of months) {
    if (await monthClosed(client, caller.kitchen.id, month)) {
      throw new ApiError('month_closed', {}, (n) => (n === 'monthName' ? monthName(month) : ''));
    }
  }
  const lateErrors: Record<string, string> = {};
  const monthHours = new Map<string, number>();
  for (const week of seriesWeeks) {
    if (week.kind === 'hourly') {
      const m = monthOf(week.local_date);
      monthHours.set(m, (monthHours.get(m) ?? 0) + Number(week.hours));
    }
    const overlap = await client.query<{ id: string }>(
      `SELECT id FROM out_of_service_windows WHERE station_id=$1 AND start_at < $3 AND end_at > $2`,
      [week.station_id, week.start_at, week.end_at],
    );
    if (overlap.rows.length > 0) lateErrors.stationId = `${await stationNameOf(client, week.station_id)} is out of service then.`;
    const docError = await documentCheck(client, week.member_id, caller.kitchen.required_documents, today, week.local_date, week.kind, week.days);
    if (docError) lateErrors.documents = docError;
  }
  for (const [month, hours] of [...monthHours.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const balance = await hoursShort(client, fresh.member_id, month, hours);
    if (balance !== null) {
      lateErrors.hours = `That needs ${formatHours(hours)} hours; you have ${formatHours(balance)} left for ${monthName(month)}.`;
      break;
    }
  }
  if (Object.keys(lateErrors).length > 0) throw new ApiError('validation_failed', { errors: lateErrors });

  const kbItemIds: string[] = [];
  const confirmed: BookingRow[] = [];
  const emails: Record<string, unknown>[] = [];
  for (const week of seriesWeeks) {
    const station = await loadStation(client, caller.kitchen.id, week.station_id);
    const price = await priceFor(client, station, caller.kitchen.peak_windows, week.kind, week.local_date, week.local_start, week.local_end, week.days, week.start_at);
    const updated = await client.query<BookingRow>(
      `UPDATE bookings SET status='confirmed', confirmed_at=$2, charge_cents=$3, hours=$4, peak_hours=$5, version=version+1
       WHERE id=$1 RETURNING *`,
      [week.id, instant, price.chargeCents, price.hours, price.peakHours],
    );
    const row = updated.rows[0];
    confirmed.push(row);
    const label = blockLabel({ stationName: station.name, kind: row.kind, localDate: row.local_date, localStart: row.local_start, localEnd: row.local_end, days: row.days });
    const kbResult = await recordLedgerPair(client, row, {
      hours: row.kind === 'hourly' ? Number(row.hours) : 0,
      ledgerKind: 'confirm',
      kbItems: [{ kind: 'booking', bookingId: row.id, description: `Booking ${row.id} ${label}`, amountCents: row.charge_cents }],
    });
    kbItemIds.push(...kbResult);
    const business = (await client.query<{ business_name: string }>(`SELECT business_name FROM members WHERE id=$1`, [row.member_id])).rows[0].business_name;
    const email = await getPersonEmail(client, row.member_id);
    emails.push({
      kind: 'mail',
      to: email,
      subject: `Booking confirmed: ${label}`,
      body: confirmEmailBody(
        business,
        { stationName: station.name, kind: row.kind, localDate: row.local_date, localStart: row.local_start, localEnd: row.local_end, days: row.days },
        row.id,
        row.charge_cents,
        monthOf(row.local_date),
        row.kind === 'hourly' ? Number(row.hours) : null,
      ),
    });
  }
  for (const email of emails) {
    await client.query(`INSERT INTO outbox (id, kind, payload) VALUES ($1,'mail',$2::jsonb)`, [newId('out'), JSON.stringify(email)]);
  }

  let pending = false;
  if (await ctx.killbill.reachable()) {
    try {
      await deliverKbItems(client, ctx, kbItemIds, postedMemo);
    } catch {
      pending = true;
    }
  } else {
    pending = true;
  }
  if (pending) {
    await client.query(`INSERT INTO outbox (id, kind, payload) VALUES ($1,'kb_record',$2::jsonb)`, [
      newId('out'),
      JSON.stringify({ itemIds: kbItemIds }),
    ]);
  }
  const out: Record<string, unknown>[] = [];
  for (const row of confirmed) {
    const freshRow = (await getBooking(client, row.id))!;
    out.push(await bookingObject(client, freshRow, caller.person, caller.kitchen, instant, ctx.config.noShowGraceSeconds));
  }
  const bank = await hourBankObject(client, fresh.member_id, monthOf(fresh.local_date));
  return { status: pending ? 202 : 200, body: { bookings: out, hourBank: bank } };
}

/** Delivers kb_items to Kill Bill and marks them recorded. Items are grouped
 * by member and month, so each Kill Bill draft invoice holds one month's items
 * and can be attributed to that month at close.
 */
export async function deliverKbItems(
  client: PoolClient,
  ctx: RouteContext,
  itemIds: string[],
  postedMemo: Map<string, true>,
): Promise<void> {
  const items = (await client.query<{ id: string; member_id: string; month: string; description: string; amount_cents: number; recorded: boolean }>(
    `SELECT id, member_id, month, description, amount_cents, recorded FROM kb_items WHERE id = ANY($1)`,
    [itemIds],
  )).rows;
  if (items.length === 0) return;
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    if (item.recorded || postedMemo.has(item.id)) continue;
    const key = `${item.member_id}:${item.month}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  for (const [key, group] of groups) {
    const memberId = key.split(':')[0];
    const account = await ensureKbAccount(client, ctx, memberId);
    const charges = group.filter((i) => i.amount_cents >= 0);
    const credits = group.filter((i) => i.amount_cents < 0);
    if (charges.length > 0) {
      await ctx.killbill.addCharges(account, charges.map((i) => ({ description: i.description, amount: i.amount_cents / 100, itemDetails: `lineboard:${i.id}` })));
    }
    if (credits.length > 0) {
      await ctx.killbill.addCredits(account, credits.map((i) => ({ description: i.description, amount: (-i.amount_cents) / 100, itemDetails: `lineboard:${i.id}` })));
    }
    for (const item of group) postedMemo.set(item.id, true);
  }
  await client.query(`UPDATE kb_items SET recorded=true, recorded_at=now() WHERE id = ANY($1)`, [itemIds]);
}

export async function ensureKbAccount(client: PoolClient, ctx: RouteContext, memberId: string): Promise<string> {
  const existing = await client.query<{ kb_account_id: string }>(`SELECT kb_account_id FROM kb_accounts WHERE member_id=$1`, [memberId]);
  if (existing.rows.length > 0) return existing.rows[0].kb_account_id;
  const business = (await client.query<{ business_name: string }>(`SELECT business_name FROM members WHERE id=$1`, [memberId])).rows[0].business_name;
  const accountId = await ctx.killbill.createAccount(memberId, business);
  await client.query(`INSERT INTO kb_accounts (member_id, kb_account_id) VALUES ($1,$2) ON CONFLICT (member_id) DO NOTHING`, [memberId, accountId]);
  return accountId;
}

export { blockEndInstant, blockStartInstant, isQuarterTime, isEndTime, resolveOrError, loadStation, stationNameOf, documentCheck, hoursShort, priceFor, lockMonths };
export type { Caller };

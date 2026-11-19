import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { config } from '../config';
import { iso, nowMs } from '../clock';
import { tx } from '../db';
import { ApiError, isUuid, validationError } from '../http/errors';
import { closedBody } from '../http/request';
import type { HandlerResult, RequestContext } from '../http/context';
import { requireIdempotencyKey, withIdempotency } from '../domain/idempotency';
import { memberByUser, validThroughFor, type MemberRecord } from '../domain/members';
import { requireSiteInScope } from './session';
import { sweepMemberExpiry } from '../domain/expiry';
import {
  bookingJson,
  hasConflict,
  insertBooking,
  liveHoldCount,
  loadBooking,
  lockBooking,
  lockStation,
  memberBookings,
  nextReference,
  releaseHeldBooking,
  siteBookingsOnDate,
  stationRecord,
  sweepExpiredHolds,
  transitionVerdict,
  type BookingRecord,
} from '../domain/bookings';
import {
  availableQuarters,
  balancesJson,
  drawFromLots,
  expireReturnedHours,
  recordMovement,
  returnToLots,
  withMemberLock,
  type Actor,
} from '../domain/ledger';
import {
  CHECK_IN_OPENS_MINUTES,
  HOLD_LIMIT,
  NO_SHOW_OPENS_MINUTES,
  certificateCovers,
  certificateValidNow,
  cutoffVerdict,
  forfeitSplit,
  isWindowShape,
  sanitationBufferMinutes,
} from '../domain/rules';
import {
  queueBookingCancelled,
  queueBookingConfirmed,
  queueSeriesBooked,
} from '../domain/mail';
import {
  addDays,
  isDate,
  localToInstant,
  wallToMinutes,
  weekdayIndex,
  weekdayName,
} from '../../shared/tz';
import { checkOutBooking } from './checkout';

function memberActor(member: MemberRecord): Actor {
  return { userId: member.user_id, name: member.name, role: 'member' };
}

async function requireMember(ctx: RequestContext): Promise<MemberRecord> {
  const user = ctx.requireUser();
  const member = await memberByUser(user.user_id);
  if (member === null) throw new ApiError('forbidden');
  return member;
}

function readWindow(body: Record<string, unknown>, dateField: string): {
  date: string;
  startMinutes: number;
  endMinutes: number;
} {
  const date = body[dateField];
  const start = body.start;
  const end = body.end;
  if (typeof date !== 'string' || !isDate(date)) {
    throw validationError({ [dateField]: 'Give a date as YYYY-MM-DD.' });
  }
  if (typeof start !== 'string' || typeof end !== 'string') {
    throw validationError({ start: 'Give quarter-hour times as HH:MM.' });
  }
  const startMinutes = wallToMinutes(start);
  const endMinutes = wallToMinutes(end);
  if (startMinutes === null || endMinutes === null || !isWindowShape(startMinutes, endMinutes)) {
    throw validationError({ start: 'Pick quarter-hour times within one day.' });
  }
  return { date, startMinutes, endMinutes };
}

async function stationInScope(ctx: RequestContext, raw: unknown) {
  const user = ctx.requireUser();
  if (typeof raw !== 'string' || !isUuid(raw)) throw new ApiError('not_found');
  const station = await stationRecord(raw);
  if (station === null || station.tenant_id !== user.tenant_id) throw new ApiError('not_found');
  return station;
}

export async function postBooking(ctx: RequestContext): Promise<HandlerResult> {
  const member = await requireMember(ctx);
  const key = requireIdempotencyKey(ctx.headers['idempotency-key']);
  const body = ctx.json();
  const station = await stationInScope(ctx, body.station_id);
  const binding = JSON.stringify({
    station_id: body.station_id ?? null,
    date: body.date ?? null,
    start: body.start ?? null,
    end: body.end ?? null,
  });
  return withIdempotency(
    { actorUserId: member.user_id, key, method: 'POST', path: '/api/bookings', binding },
    async () => {
      closedBody(body, ['station_id', 'date', 'start', 'end']);
      const window = readWindow(body, 'date');
      await sweepExpiredHolds();
      await sweepMemberExpiry(member);
      const at = nowMs();
      const zone = station.time_zone;
      const cutoff = cutoffVerdict(zone, at, window.date);
      if (cutoff === 'beyond_horizon') {
        throw validationError({ date: 'That date is beyond the 90-day booking horizon.' });
      }
      const validThrough = await validThroughFor(null, member);
      if (
        !certificateCovers(
          validThrough.certificate_of_insurance,
          zone,
          at,
          window.date,
        )
      ) {
        throw new ApiError('certificate_expired');
      }
      if (cutoff === 'cutoff') throw new ApiError('cutoff');
      const startAt = localToInstant(zone, window.date, window.startMinutes);
      const endAt = localToInstant(zone, window.date, window.endMinutes);
      const quarters = Math.round((endAt - startAt) / 900000);
      const buffer = sanitationBufferMinutes(station.kind);
      const result = await tx(async (client) => {
        return withMemberLock(client, member.id, async () => {
          const holds = await liveHoldCount(client, member.id, nowMs());
          if (holds >= HOLD_LIMIT) throw new ApiError('hold_limit');
          const available = await availableQuarters(client, member.id, member.home_zone, nowMs());
          if (quarters > available) throw new ApiError('insufficient_hours');
          await lockStation(client, station.id);
          const commitMs = nowMs();
          if (await hasConflict(client, station.id, startAt, endAt + buffer * 60000, commitMs)) {
            throw new ApiError('slot_taken');
          }
          const reference = await nextReference(client, member.tenant_id);
          const bookingId = await insertBooking(client, {
            tenantId: member.tenant_id,
            siteId: station.site_id,
            stationId: station.id,
            memberId: member.id,
            reference,
            date: window.date,
            startMinutes: window.startMinutes,
            endMinutes: window.endMinutes,
            startAtMs: startAt,
            endAtMs: endAt,
            occupiedEndMs: endAt + buffer * 60000,
            quarters,
            status: 'held',
            holdExpiresAtMs: commitMs + config.holdTtlSeconds * 1000,
            seriesId: null,
            createdAtMs: commitMs,
          });
          const allocations = await drawFromLots(
            client,
            member.id,
            member.home_zone,
            commitMs,
            quarters,
          );
          if (allocations === null) throw new ApiError('insufficient_hours');
          await recordMovement(client, {
            tenantId: member.tenant_id,
            memberId: member.id,
            kind: 'booking_debit',
            quarters,
            createdAtMs: commitMs,
            actor: memberActor(member),
            bookingId,
            lots: allocations,
          });
          const booking = await loadBooking(client, bookingId);
          const balances = await balancesJson(client, member, commitMs);
          return { booking: booking as BookingRecord, balances };
        });
      });
      ctx.audit.targetType = 'booking';
      ctx.audit.targetId = result.booking.id;
      return {
        status: 201,
        body: {
          booking: bookingJson(result.booking, nowMs()),
          balances: result.balances,
        },
      };
    },
  );
}

async function bookingForMember(
  ctx: RequestContext,
  bookingId: string,
): Promise<{ member: MemberRecord; booking: BookingRecord }> {
  const member = await requireMember(ctx);
  if (!isUuid(bookingId)) throw new ApiError('not_found');
  const booking = await tx(async (client) => loadBooking(client, bookingId));
  if (booking === null || booking.member_id !== member.id) throw new ApiError('not_found');
  return { member, booking };
}

export async function postConfirm(ctx: RequestContext): Promise<HandlerResult> {
  const bookingId = ctx.params.id as string;
  closedBody(ctx.json(), []);
  const { member } = await bookingForMember(ctx, bookingId);
  ctx.audit.targetType = 'booking';
  ctx.audit.targetId = bookingId;
  await sweepExpiredHolds();
  const outcome = await tx(async (client) => {
    return withMemberLock(client, member.id, async () => {
      await lockBooking(client, bookingId);
      const booking = await loadBooking(client, bookingId);
      if (booking === null || booking.member_id !== member.id) throw new ApiError('not_found');
      const at = nowMs();
      const verdict = transitionVerdict(
        'confirm',
        booking.status,
        booking.hold_expires_at?.getTime() ?? null,
        at,
      );
      if (verdict === 'hold_expired') throw new ApiError('hold_expired');
      if (verdict === 'invalid_transition') throw new ApiError('invalid_transition');
      const validThrough = await validThroughFor(client, member);
      if (
        !certificateCovers(
          validThrough.certificate_of_insurance,
          booking.site_time_zone,
          at,
          booking.date_text,
        )
      ) {
        throw new ApiError('certificate_expired');
      }
      await client.query(`update bookings set status = 'confirmed' where id = $1`, [bookingId]);
      const updated = (await loadBooking(client, bookingId)) as BookingRecord;
      const balances = await balancesJson(client, member, at);
      await queueBookingConfirmed(client, {
        bookingId,
        memberEmail: member.email,
        stationName: booking.station_name,
        siteName: booking.site_name,
        date: booking.date_text,
        start: bookingJson(booking, at).start,
        end: bookingJson(booking, at).end,
        reference: booking.reference,
        quarters: booking.quarters,
        availableQuartersAfter: Math.round(balances.available_hours * 4),
      });
      return { updated, balances };
    });
  });
  return {
    status: 200,
    body: {
      booking: bookingJson(outcome.updated, nowMs()),
      balances: outcome.balances,
    },
  };
}

async function cancelConfirmed(
  client: PoolClient,
  booking: BookingRecord,
  member: { id: string; tenant_id: string; home_zone: string },
  commitMs: number,
  actor: { userId: string; name: string; role: 'member' | 'kitchen_manager' },
  reason: string | null,
): Promise<{ refundedQuarters: number; forfeitedQuarters: number }> {
  const split = forfeitSplit(booking.quarters, booking.start_at.getTime(), commitMs);
  if (split.refundedQuarters > 0) {
    const allocations = await returnToLots(client, booking.id, split.refundedQuarters);
    await recordMovement(client, {
      tenantId: booking.tenant_id,
      memberId: booking.member_id,
      kind: 'cancel_refund',
      quarters: split.refundedQuarters,
      createdAtMs: commitMs,
      actor,
      bookingId: booking.id,
      lots: allocations,
    });
    await expireReturnedHours(client, member, allocations, commitMs);
  }
  if (split.forfeitedQuarters > 0) {
    await recordMovement(client, {
      tenantId: booking.tenant_id,
      memberId: booking.member_id,
      kind: 'forfeit',
      quarters: split.forfeitedQuarters,
      createdAtMs: commitMs,
      actor,
      bookingId: booking.id,
    });
  }
  await client.query(
    `update bookings set status = 'cancelled', refunded_quarters = $2, forfeited_quarters = $3,
       cancelled_by_user_id = $4, cancelled_by_name = $5, cancellation_reason = $6
      where id = $1`,
    [
      booking.id,
      split.refundedQuarters,
      split.forfeitedQuarters,
      actor.userId,
      actor.name,
      reason,
    ],
  );
  return split;
}

export async function postCancel(ctx: RequestContext): Promise<HandlerResult> {
  const user = ctx.requireUser();
  const bookingId = ctx.params.id as string;
  ctx.audit.targetType = 'booking';
  ctx.audit.targetId = isUuid(bookingId) ? bookingId : null;
  if (!isUuid(bookingId)) throw new ApiError('not_found');
  const body = ctx.json();
  await sweepExpiredHolds();
  if (user.role === 'member') {
    closedBody(body, []);
    const member = await requireMember(ctx);
    const outcome = await tx(async (client) => {
      return withMemberLock(client, member.id, async () => {
        await lockBooking(client, bookingId);
        const booking = await loadBooking(client, bookingId);
        if (booking === null || booking.member_id !== member.id) throw new ApiError('not_found');
        const at = nowMs();
        const verdict = transitionVerdict(
          'cancel_member',
          booking.status,
          booking.hold_expires_at?.getTime() ?? null,
          at,
        );
        if (verdict !== 'ok') throw new ApiError('invalid_transition');
        if (booking.status === 'held') {
          await releaseHeldBooking(client, booking, member, at, {
            status: 'cancelled',
            actorUserId: member.user_id,
            actorName: member.name,
          });
          const updated = (await loadBooking(client, bookingId)) as BookingRecord;
          return {
            updated,
            refundedQuarters: booking.quarters,
            forfeitedQuarters: 0,
            balances: await balancesJson(client, member, at),
          };
        }
        const split = await cancelConfirmed(
          client,
          booking,
          member,
          at,
          { userId: member.user_id, name: member.name, role: 'member' },
          null,
        );
        await queueBookingCancelled(client, {
          bookingId,
          memberEmail: member.email,
          stationName: booking.station_name,
          siteName: booking.site_name,
          date: booking.date_text,
          start: bookingJson(booking, at).start,
          end: bookingJson(booking, at).end,
          reference: booking.reference,
          refundedQuarters: split.refundedQuarters,
          forfeitedQuarters: split.forfeitedQuarters,
          managerReason: null,
        });
        const updated = (await loadBooking(client, bookingId)) as BookingRecord;
        return {
          updated,
          refundedQuarters: split.refundedQuarters,
          forfeitedQuarters: split.forfeitedQuarters,
          balances: await balancesJson(client, member, at),
        };
      });
    });
    return {
      status: 200,
      body: {
        booking: bookingJson(outcome.updated, nowMs()),
        refunded_hours: outcome.refundedQuarters / 4,
        forfeited_hours: outcome.forfeitedQuarters / 4,
        balances: outcome.balances,
      },
    };
  }

  closedBody(body, ['reason']);
  const rawReason = body.reason;
  const reason = typeof rawReason === 'string' ? rawReason.trim() : '';
  if (reason.length < 3 || reason.length > 300) {
    throw validationError({ reason: 'Give a reason the member can act on.' });
  }
  const outcome = await tx(async (client) => {
    const booking = await loadBooking(client, bookingId);
    if (booking === null || booking.site_id !== user.site_id) throw new ApiError('not_found');
    return withMemberLock(client, booking.member_id, async () => {
      await lockBooking(client, bookingId);
      const current = (await loadBooking(client, bookingId)) as BookingRecord;
      const at = nowMs();
      const verdict = transitionVerdict(
        'cancel_manager',
        current.status,
        current.hold_expires_at?.getTime() ?? null,
        at,
      );
      if (verdict !== 'ok') throw new ApiError('invalid_transition');
      const member = {
        id: current.member_id,
        tenant_id: current.tenant_id,
        home_zone: current.home_zone,
      };
      const split = await cancelConfirmed(
        client,
        current,
        member,
        at,
        { userId: user.user_id, name: user.name, role: 'kitchen_manager' },
        reason,
      );
      await queueBookingCancelled(client, {
        bookingId,
        memberEmail: current.member_email,
        stationName: current.station_name,
        siteName: current.site_name,
        date: current.date_text,
        start: bookingJson(current, at).start,
        end: bookingJson(current, at).end,
        reference: current.reference,
        refundedQuarters: split.refundedQuarters,
        forfeitedQuarters: split.forfeitedQuarters,
        managerReason: reason,
      });
      const updated = (await loadBooking(client, bookingId)) as BookingRecord;
      return { updated, split };
    });
  });
  return {
    status: 200,
    body: {
      booking: bookingJson(outcome.updated, nowMs()),
      refunded_hours: outcome.split.refundedQuarters / 4,
      forfeited_hours: outcome.split.forfeitedQuarters / 4,
    },
  };
}

export async function getBookings(ctx: RequestContext): Promise<HandlerResult> {
  const member = await requireMember(ctx);
  await sweepExpiredHolds();
  const bookings = await memberBookings(member.id);
  const at = nowMs();
  return { status: 200, body: { bookings: bookings.map((booking) => bookingJson(booking, at)) } };
}

export async function getBooking(ctx: RequestContext): Promise<HandlerResult> {
  const user = ctx.requireUser();
  const bookingId = ctx.params.id as string;
  if (!isUuid(bookingId)) throw new ApiError('not_found');
  await sweepExpiredHolds();
  const booking = await tx(async (client) => loadBooking(client, bookingId));
  if (booking === null || booking.tenant_id !== user.tenant_id) throw new ApiError('not_found');
  if (user.role === 'member') {
    const member = await memberByUser(user.user_id);
    if (member === null || booking.member_id !== member.id) throw new ApiError('not_found');
  }
  if (user.role === 'kitchen_manager' && booking.site_id !== user.site_id) {
    throw new ApiError('not_found');
  }
  return { status: 200, body: { booking: bookingJson(booking, nowMs()) } };
}

export async function getSiteBookings(ctx: RequestContext): Promise<HandlerResult> {
  const site = await requireSiteInScope(ctx, ctx.params.site_id as string);
  const date = ctx.query.get('date');
  if (date === null || !isDate(date)) throw validationError({ date: 'Give a date as YYYY-MM-DD.' });
  await sweepExpiredHolds();
  const bookings = await siteBookingsOnDate(site.id, date);
  const at = nowMs();
  return { status: 200, body: { bookings: bookings.map((booking) => bookingJson(booking, at)) } };
}

export async function postSeries(ctx: RequestContext): Promise<HandlerResult> {
  const member = await requireMember(ctx);
  const body = ctx.json();
  closedBody(body, ['station_id', 'first_date', 'start', 'end', 'weeks']);
  const station = await stationInScope(ctx, body.station_id);
  const window = readWindow(body, 'first_date');
  const weeks = body.weeks;
  if (typeof weeks !== 'number' || !Number.isInteger(weeks) || weeks < 2 || weeks > 12) {
    throw validationError({ weeks: 'Choose between 2 and 12 weeks.' });
  }
  await sweepExpiredHolds();
  await sweepMemberExpiry(member);
  const at = nowMs();
  const zone = station.time_zone;
  const dates: string[] = [];
  for (let index = 0; index < weeks; index += 1) {
    dates.push(addDays(window.date, 7 * index));
  }
  const firstCutoff = cutoffVerdict(zone, at, window.date);
  if (firstCutoff === 'beyond_horizon') {
    throw validationError({ first_date: 'That date is beyond the 90-day booking horizon.' });
  }
  for (const date of dates) {
    if (cutoffVerdict(zone, at, date) === 'beyond_horizon') {
      throw validationError({ weeks: 'That many weeks runs past the 90-day booking horizon.' });
    }
  }
  const validThrough = await validThroughFor(null, member);
  const uncovered = certificateValidNow(validThrough.certificate_of_insurance, zone, at)
    ? dates.filter((date) => (validThrough.certificate_of_insurance as string) < date)
    : dates;
  if (uncovered.length > 0) {
    throw new ApiError('certificate_expired', { dates: uncovered });
  }
  if (firstCutoff === 'cutoff') throw new ApiError('cutoff');
  const occurrences = dates.map((date) => {
    const startAt = localToInstant(zone, date, window.startMinutes);
    const endAt = localToInstant(zone, date, window.endMinutes);
    return { date, startAt, endAt, quarters: Math.round((endAt - startAt) / 900000) };
  });
  const totalQuarters = occurrences.reduce((sum, occurrence) => sum + occurrence.quarters, 0);
  const buffer = sanitationBufferMinutes(station.kind);
  const outcome = await tx(async (client) => {
    return withMemberLock(client, member.id, async () => {
      const available = await availableQuarters(client, member.id, member.home_zone, nowMs());
      if (totalQuarters > available) throw new ApiError('insufficient_hours');
      await lockStation(client, station.id);
      const commitMs = nowMs();
      const conflicts: string[] = [];
      for (const occurrence of occurrences) {
        if (
          await hasConflict(
            client,
            station.id,
            occurrence.startAt,
            occurrence.endAt + buffer * 60000,
            commitMs,
          )
        ) {
          conflicts.push(occurrence.date);
        }
      }
      if (conflicts.length > 0) {
        throw new ApiError('series_conflict', { dates: conflicts.sort() });
      }
      const seriesId = randomUUID();
      await client.query(
        `insert into series (id, tenant_id, member_id, station_id, weekday, start_minutes,
           end_minutes, weeks, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          seriesId,
          member.tenant_id,
          member.id,
          station.id,
          weekdayIndex(window.date),
          window.startMinutes,
          window.endMinutes,
          weeks,
          new Date(commitMs).toISOString(),
        ],
      );
      const created: BookingRecord[] = [];
      for (const occurrence of occurrences) {
        const reference = await nextReference(client, member.tenant_id);
        const bookingId = await insertBooking(client, {
          tenantId: member.tenant_id,
          siteId: station.site_id,
          stationId: station.id,
          memberId: member.id,
          reference,
          date: occurrence.date,
          startMinutes: window.startMinutes,
          endMinutes: window.endMinutes,
          startAtMs: occurrence.startAt,
          endAtMs: occurrence.endAt,
          occupiedEndMs: occurrence.endAt + buffer * 60000,
          quarters: occurrence.quarters,
          status: 'confirmed',
          holdExpiresAtMs: null,
          seriesId,
          createdAtMs: commitMs,
        });
        const allocations = await drawFromLots(
          client,
          member.id,
          member.home_zone,
          commitMs,
          occurrence.quarters,
        );
        if (allocations === null) throw new ApiError('insufficient_hours');
        await recordMovement(client, {
          tenantId: member.tenant_id,
          memberId: member.id,
          kind: 'booking_debit',
          quarters: occurrence.quarters,
          createdAtMs: commitMs,
          actor: memberActor(member),
          bookingId,
          lots: allocations,
        });
        created.push((await loadBooking(client, bookingId)) as BookingRecord);
      }
      const balances = await balancesJson(client, member, commitMs);
      await queueSeriesBooked(client, {
        seriesId,
        memberEmail: member.email,
        stationName: station.name,
        siteName: (created[0] as BookingRecord).site_name,
        weekday: weekdayName(window.date),
        start: bookingJson(created[0] as BookingRecord, commitMs).start,
        end: bookingJson(created[0] as BookingRecord, commitMs).end,
        weeks,
        dates,
        totalQuarters,
      });
      return { seriesId, created, balances };
    });
  });
  ctx.audit.targetType = 'series';
  ctx.audit.targetId = outcome.seriesId;
  const at2 = nowMs();
  return {
    status: 201,
    body: {
      series: {
        id: outcome.seriesId,
        station_id: station.id,
        weekday: weekdayName(window.date),
        start: bookingJson(outcome.created[0] as BookingRecord, at2).start,
        end: bookingJson(outcome.created[0] as BookingRecord, at2).end,
        weeks,
      },
      bookings: outcome.created.map((booking) => bookingJson(booking, at2)),
      balances: outcome.balances,
    },
  };
}

async function managerBooking(
  ctx: RequestContext,
  bookingId: string,
  client: PoolClient,
): Promise<BookingRecord> {
  const user = ctx.requireUser();
  const booking = await loadBooking(client, bookingId);
  if (booking === null || booking.site_id !== user.site_id) throw new ApiError('not_found');
  return booking;
}

export async function postCheckIn(ctx: RequestContext): Promise<HandlerResult> {
  const user = ctx.requireUser();
  const bookingId = ctx.params.id as string;
  ctx.audit.targetType = 'booking';
  ctx.audit.targetId = isUuid(bookingId) ? bookingId : null;
  if (!isUuid(bookingId)) throw new ApiError('not_found');
  closedBody(ctx.json(), []);
  await sweepExpiredHolds();
  const updated = await tx(async (client) => {
    await lockBooking(client, bookingId);
    const booking = await managerBooking(ctx, bookingId, client);
    const at = nowMs();
    const verdict = transitionVerdict(
      'check_in',
      booking.status,
      booking.hold_expires_at?.getTime() ?? null,
      at,
    );
    if (verdict !== 'ok') throw new ApiError('invalid_transition');
    if (at < booking.start_at.getTime() - CHECK_IN_OPENS_MINUTES * 60000) {
      throw new ApiError('too_early');
    }
    if (at >= booking.end_at.getTime()) throw new ApiError('too_late');
    const member = await memberByUser(booking.member_user_id);
    const validThrough = await validThroughFor(client, member as MemberRecord);
    if (
      !certificateValidNow(validThrough.certificate_of_insurance, booking.site_time_zone, at)
    ) {
      throw new ApiError('certificate_expired');
    }
    await client.query(
      `update bookings set status = 'checked_in', checked_in_at = $2,
         checked_in_by_user_id = $3, checked_in_by_name = $4 where id = $1`,
      [bookingId, iso(at), user.user_id, user.name],
    );
    return (await loadBooking(client, bookingId)) as BookingRecord;
  });
  return { status: 200, body: { booking: bookingJson(updated, nowMs()) } };
}

export async function postNoShow(ctx: RequestContext): Promise<HandlerResult> {
  const user = ctx.requireUser();
  const bookingId = ctx.params.id as string;
  ctx.audit.targetType = 'booking';
  ctx.audit.targetId = isUuid(bookingId) ? bookingId : null;
  if (!isUuid(bookingId)) throw new ApiError('not_found');
  closedBody(ctx.json(), []);
  await sweepExpiredHolds();
  const updated = await tx(async (client) => {
    const booking = await managerBooking(ctx, bookingId, client);
    return withMemberLock(client, booking.member_id, async () => {
      await lockBooking(client, bookingId);
      const current = (await loadBooking(client, bookingId)) as BookingRecord;
      const at = nowMs();
      const verdict = transitionVerdict(
        'no_show',
        current.status,
        current.hold_expires_at?.getTime() ?? null,
        at,
      );
      if (verdict !== 'ok') throw new ApiError('invalid_transition');
      if (at < current.start_at.getTime() + NO_SHOW_OPENS_MINUTES * 60000) {
        throw new ApiError('too_early');
      }
      await recordMovement(client, {
        tenantId: current.tenant_id,
        memberId: current.member_id,
        kind: 'forfeit',
        quarters: current.quarters,
        createdAtMs: at,
        actor: { userId: user.user_id, name: user.name, role: 'kitchen_manager' },
        bookingId,
      });
      await client.query(
        `update bookings set status = 'no_show', no_show_by_user_id = $2, no_show_by_name = $3,
           forfeited_quarters = $4, refunded_quarters = 0 where id = $1`,
        [bookingId, user.user_id, user.name, current.quarters],
      );
      return (await loadBooking(client, bookingId)) as BookingRecord;
    });
  });
  return { status: 200, body: { booking: bookingJson(updated, nowMs()) } };
}

export { checkOutBooking as postCheckOut };

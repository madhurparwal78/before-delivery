import { randomUUID } from 'node:crypto';
import { pool, queryOne, transaction } from '../db/pool.js';
import { writeAudit } from '../domain/audit.js';
import { uncoveredDates } from '../domain/compliance.js';
import { confirmationEmail } from '../domain/emails.js';
import { segmentLabel } from '../domain/format.js';
import { findBlocker, spanState } from '../domain/occupancy.js';
import { packBalances, writeMovement } from '../domain/pack.js';
import { unpaidCutoff } from '../domain/policy.js';
import { presentHold, presentBooking } from '../domain/present.js';
import { quoteFor, splitPackCover, timeCents } from '../domain/pricing.js';
import {
  holdInScope,
  occurrencesOf,
  policyVersionAt,
  renterInScope,
  stationInScope,
  type BookingRow,
  type RenterRow,
  type StationRow,
  BOOKING_SELECT,
} from '../domain/records.js';
import {
  addDays,
  datesTouched,
  elapsedMinutes,
  isDateString,
  isTimeString,
  localDate,
  localTime,
  resolveLocal,
} from '../domain/zone.js';
import { env } from '../env.js';
import { json, noContent, type Ctx, type Reply } from '../http/context.js';
import { ApiError, billingUnavailable, notFound, validation } from '../http/errors.js';
import { runIdempotent } from '../http/idempotency.js';
import type { Route } from '../http/router.js';
import type { Actor } from '../http/session.js';
import { queueEmail } from '../services/mail.js';
import {
  BillingUnavailableError,
  recordPurchase,
  refundPurchase,
  type RenterAccountInput,
} from '../services/killbill.js';

const MIN_MINUTES = 15;
const MAX_MINUTES = 12 * 60;
const MAX_DAYS_AHEAD = 365;

interface PlannedOccurrence {
  date: string;
  start: string;
  end: string;
  startAt: Date;
  endAt: Date;
  minutes: number;
}

function quarterHour(value: Date): boolean {
  return value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0 && value.getUTCMinutes() % 15 === 0;
}

function parseInstant(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function planOccurrences(station: StationRow, body: Record<string, unknown>): PlannedOccurrence[] {
  const fields: Record<string, string> = {};
  const now = Date.now();
  const hasLocalForm = body.date !== undefined || body.start !== undefined || body.end !== undefined;

  if (hasLocalForm) {
    if (!isDateString(body.date)) fields.date = 'Give a date as YYYY-MM-DD.';
    if (!isTimeString(body.start)) fields.start = 'Give a start time as HH:MM.';
    if (!isTimeString(body.end)) fields.end = 'Give an end time as HH:MM.';
    let weeks = 1;
    if (body.repeat_weeks !== undefined) {
      if (
        typeof body.repeat_weeks !== 'number' ||
        !Number.isInteger(body.repeat_weeks) ||
        body.repeat_weeks < 1 ||
        body.repeat_weeks > 12
      ) {
        fields.repeat_weeks = 'Repeat between 1 and 12 weeks.';
      } else {
        weeks = body.repeat_weeks;
      }
    }
    if (Object.keys(fields).length > 0) throw validation(fields);
    const date = body.date as string;
    const start = body.start as string;
    const end = body.end as string;
    if (Number(start.slice(3)) % 15 !== 0) fields.start = 'Start on a quarter hour.';
    if (Number(end.slice(3)) % 15 !== 0) fields.end = 'End on a quarter hour.';
    if (Object.keys(fields).length > 0) throw validation(fields);

    const planned: PlannedOccurrence[] = [];
    for (let week = 0; week < weeks; week += 1) {
      const occurrenceDate = addDays(date, week * 7);
      const startAt = resolveLocal(station.time_zone, occurrenceDate, start);
      const endDate = end <= start ? addDays(occurrenceDate, 1) : occurrenceDate;
      const endAt = resolveLocal(station.time_zone, endDate, end);
      const minutes = elapsedMinutes(startAt, endAt);
      if (minutes < MIN_MINUTES) fields.end = 'A booking lasts at least 15 minutes.';
      if (minutes > MAX_MINUTES) fields.end = 'A booking lasts at most 12 hours.';
      if (startAt.getTime() <= now) fields.start = 'Start after the current time.';
      if (startAt.getTime() > now + MAX_DAYS_AHEAD * 86_400_000) {
        fields.date = 'Book no more than 365 days ahead.';
      }
      if (Object.keys(fields).length > 0) throw validation(fields);
      planned.push({ date: occurrenceDate, start, end, startAt, endAt, minutes });
    }
    return planned;
  }

  const startAt = parseInstant(body.start_at);
  const endAt = parseInstant(body.end_at);
  if (startAt === null) fields.start_at = 'Give start_at as a UTC timestamp.';
  if (endAt === null) fields.end_at = 'Give end_at as a UTC timestamp.';
  if (Object.keys(fields).length > 0) throw validation(fields);
  const from = startAt as Date;
  const to = endAt as Date;
  if (!quarterHour(from)) fields.start_at = 'Start on a quarter hour.';
  if (!quarterHour(to)) fields.end_at = 'End on a quarter hour.';
  const minutes = elapsedMinutes(from, to);
  if (minutes < MIN_MINUTES) fields.end_at = 'A booking lasts at least 15 minutes.';
  if (minutes > MAX_MINUTES) fields.end_at = 'A booking lasts at most 12 hours.';
  if (from.getTime() <= now) fields.start_at = 'Start after the current time.';
  if (from.getTime() > now + MAX_DAYS_AHEAD * 86_400_000) {
    fields.start_at = 'Book no more than 365 days ahead.';
  }
  if (Object.keys(fields).length > 0) throw validation(fields);
  return [
    {
      date: localDate(station.time_zone, from),
      start: localTime(station.time_zone, from),
      end: localTime(station.time_zone, to),
      startAt: from,
      endAt: to,
      minutes,
    },
  ];
}

async function targetRenter(ctx: Ctx, actor: Actor): Promise<RenterRow> {
  const body = ctx.body();
  if (actor.role === 'renter') {
    if (actor.renter_id === null) throw notFound();
    if (body.renter_id !== undefined && body.renter_id !== actor.renter_id) throw notFound();
    return renterInScope(actor, actor.renter_id);
  }
  if (typeof body.renter_id !== 'string' || body.renter_id === '') {
    throw validation({ renter_id: 'Choose a renter.' });
  }
  return renterInScope(actor, body.renter_id);
}

function slotTaken(
  blocker: { state: string; startAt: Date; endAt: Date; label: string },
  date: string,
): ApiError {
  return new ApiError(409, 'slot_taken', 'Another renter just took this time.', {
    blocker: {
      state: blocker.state,
      start_at: blocker.startAt.toISOString(),
      end_at: blocker.endAt.toISOString(),
      label: blocker.label,
      date,
    },
  });
}

async function createHold(ctx: Ctx): Promise<Reply> {
  const actor = ctx.requireActor();
  const body = ctx.body();
  if (typeof body.station_id !== 'string') throw validation({ station_id: 'Choose a station.' });
  const station = await stationInScope(actor, body.station_id);
  const renter = await targetRenter(ctx, actor);
  const planned = planOccurrences(station, body);
  const viewerRenterId = actor.role === 'renter' ? actor.renter_id : null;
  const holdId = `hold-${randomUUID()}`;
  const now = new Date();

  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`station:${station.id}`]);
    for (const occurrence of planned) {
      const blocker = await findBlocker(
        client,
        station.id,
        occurrence.startAt,
        occurrence.endAt,
        now,
      );
      if (blocker !== null) {
        const state = spanState(blocker, viewerRenterId);
        throw slotTaken(
          {
            state,
            startAt: blocker.startAt,
            endAt: blocker.endAt,
            label: segmentLabel(state, station.time_zone, blocker.startAt, blocker.endAt),
          },
          occurrence.date,
        );
      }
    }
    const expiresAt = new Date(now.getTime() + env.holdTtlSeconds * 1000);
    await client.query(
      `INSERT INTO holds (id, site_id, station_id, renter_id, status, repeat_weeks, created_at, expires_at)
       VALUES ($1, $2, $3, $4, 'held', $5, $6, $7)`,
      [holdId, station.site_id, station.id, renter.id, planned.length, now, expiresAt],
    );
    for (const [index, occurrence] of planned.entries()) {
      await client.query(
        `INSERT INTO hold_occurrences (hold_id, seq, local_date, local_start, local_end, start_at, end_at, minutes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          holdId,
          index,
          occurrence.date,
          occurrence.start,
          occurrence.end,
          occurrence.startAt,
          occurrence.endAt,
          occurrence.minutes,
        ],
      );
    }
    await writeAudit(client, {
      holdId,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'hold',
      from: 'free',
      to: 'held',
    });
    const balances = await packBalances(client, renter.id);
    const quote = quoteFor(
      balances.availableMinutes,
      planned.map((occurrence) => occurrence.minutes),
      station.rate_cents,
      station.deposit_cents,
    );
    return json(201, {
      hold: {
        id: holdId,
        status: 'held',
        station_id: station.id,
        site_id: station.site_id,
        renter_id: renter.id,
        created_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        occurrences: planned.map((occurrence) => ({
          date: occurrence.date,
          start: occurrence.start,
          end: occurrence.end,
          start_at: occurrence.startAt.toISOString(),
          end_at: occurrence.endAt.toISOString(),
          minutes: occurrence.minutes,
        })),
        quote,
      },
    });
  });
}

const holdExpired = (): ApiError =>
  new ApiError(410, 'hold_expired', 'Your hold ran out before payment. Nothing was charged.');

interface ConfirmPlan {
  bookingId: string;
  occurrence: { date: string; startAt: Date; endAt: Date; minutes: number; start: string; end: string };
  packMinutes: number;
  cardMinutes: number;
  cardCents: number;
  depositCents: number;
  cutoff: Date;
}

async function confirmHold(ctx: Ctx): Promise<Reply> {
  const actor = ctx.requireActor();
  const hold = await holdInScope(actor, ctx.params.id as string);
  return runIdempotent(ctx, actor, async () => {
    const body = ctx.body();
    const usePack = body.use_pack === true;
    const payNow = body.pay_now === true;
    const charged: string[] = [];
    try {
      return await transaction(async (client) => {
        const locked = await holdInScope(actor, hold.id, client, true);
        const now = new Date();
        if (locked.status === 'confirmed') {
          throw new ApiError(409, 'invalid_transition', 'That hold is already confirmed.', {
            from: 'confirmed',
            action: 'confirm',
          });
        }
        if (locked.status === 'expired' || locked.expires_at.getTime() <= now.getTime()) {
          throw holdExpired();
        }
        const occurrences = await occurrencesOf(client, locked.id);
        const touched = [
          ...new Set(
            occurrences.flatMap((occurrence) =>
              datesTouched(locked.time_zone, occurrence.start_at, occurrence.end_at),
            ),
          ),
        ].sort();
        const missing = await uncoveredDates(client, locked.renter_id, touched);
        if (missing.length > 0) {
          throw new ApiError(
            422,
            'certificate_required',
            'A liability certificate must cover every date of this booking.',
            { dates: missing },
          );
        }
        const balances = await packBalances(client, locked.renter_id);
        if (usePack && balances.availableMinutes === 0) {
          throw new ApiError(
            422,
            'pack_insufficient',
            'Your pack no longer covers these hours.',
            {},
          );
        }
        const shares = splitPackCover(
          usePack ? balances.availableMinutes : 0,
          occurrences.map((occurrence) => occurrence.minutes),
        );
        const plans: ConfirmPlan[] = occurrences.map((occurrence, index) => {
          const share = shares[index] as { packMinutes: number; cardMinutes: number };
          return {
            bookingId: `bk-${randomUUID()}`,
            occurrence: {
              date: occurrence.local_date,
              start: occurrence.local_start,
              end: occurrence.local_end,
              startAt: occurrence.start_at,
              endAt: occurrence.end_at,
              minutes: occurrence.minutes,
            },
            packMinutes: share.packMinutes,
            cardMinutes: share.cardMinutes,
            cardCents: timeCents(share.cardMinutes, locked.rate_cents),
            depositCents: share.cardMinutes > 0 ? locked.deposit_cents : 0,
            cutoff: unpaidCutoff(locked.time_zone, occurrence.start_at),
          };
        });
        const carded = plans.filter((plan) => plan.cardMinutes > 0);
        if (!payNow && carded.some((plan) => plan.cutoff.getTime() <= now.getTime())) {
          throw new ApiError(
            422,
            'pay_now_required',
            'This booking starts too soon to pay later.',
            {},
          );
        }
        const account: RenterAccountInput = {
          renterId: locked.renter_id,
          name: locked.renter_name,
          email: locked.renter_email,
        };
        for (const plan of carded) {
          const depositKey = `hs-deposit-${plan.bookingId}`;
          await recordPurchase(account, depositKey, plan.depositCents);
          charged.push(depositKey);
          if (payNow) {
            const timeKey = `hs-booking-${plan.bookingId}`;
            await recordPurchase(account, timeKey, plan.cardCents);
            charged.push(timeKey);
          }
        }
        const policy = await policyVersionAt(client, locked.site_id, now);
        await client.query('UPDATE holds SET status = $2 WHERE id = $1', [locked.id, 'confirmed']);
        const rows: BookingRow[] = [];
        for (const plan of plans) {
          await client.query(
            `INSERT INTO bookings (id, hold_id, site_id, station_id, renter_id, status, start_at, end_at, minutes,
                                   pack_minutes, card_minutes, card_cents, deposit_cents, time_paid, balance_due_by,
                                   policy_version_id, confirmed_at)
             VALUES ($1, $2, $3, $4, $5, 'confirmed', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
            [
              plan.bookingId,
              locked.id,
              locked.site_id,
              locked.station_id,
              locked.renter_id,
              plan.occurrence.startAt,
              plan.occurrence.endAt,
              plan.occurrence.minutes,
              plan.packMinutes,
              plan.cardMinutes,
              plan.cardCents,
              plan.depositCents,
              plan.cardMinutes > 0 ? payNow : false,
              plan.cutoff,
              policy.id,
              now,
            ],
          );
          if (plan.packMinutes > 0) {
            await writeMovement(client, {
              renterId: locked.renter_id,
              reason: 'reserve',
              minutes: plan.packMinutes,
              bookingId: plan.bookingId,
              at: now,
            });
          }
          await writeAudit(client, {
            bookingId: plan.bookingId,
            holdId: locked.id,
            actorName: actor.name,
            actorRole: actor.role,
            action: 'confirm',
            from: 'held',
            to: 'confirmed',
          });
          const row = await queryOne<BookingRow>(client, `${BOOKING_SELECT} WHERE b.id = $1`, [
            plan.bookingId,
          ]);
          if (row === null) throw new Error('booking vanished after insert');
          rows.push(row);
        }
        await queueEmail(client, confirmationEmail(locked.id, rows));
        return json(201, {
          bookings: rows.map(presentBooking),
          email: 'queued',
        });
      });
    } catch (error) {
      if (error instanceof BillingUnavailableError) {
        for (const key of charged) {
          await refundPurchase(key).catch(() => undefined);
        }
        throw billingUnavailable();
      }
      throw error;
    }
  });
}

async function releaseHold(ctx: Ctx): Promise<Reply> {
  const actor = ctx.requireActor();
  const hold = await holdInScope(actor, ctx.params.id as string);
  await transaction(async (client) => {
    const locked = await holdInScope(actor, hold.id, client, true);
    if (locked.status !== 'held' || locked.expires_at.getTime() <= Date.now()) {
      throw new ApiError(409, 'invalid_transition', 'That hold is no longer live.', {
        from: locked.status === 'held' ? 'expired' : locked.status,
        action: 'release',
      });
    }
    await client.query(
      "UPDATE holds SET status = 'expired', expiry_notified = true, expires_at = now() WHERE id = $1",
      [locked.id],
    );
    await writeAudit(client, {
      holdId: locked.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'release',
      from: 'held',
      to: 'expired',
    });
  });
  return noContent();
}

async function overrideHold(ctx: Ctx): Promise<Reply> {
  const actor = ctx.requireActor();
  const hold = await holdInScope(actor, ctx.params.id as string);
  ctx.requireRole('manager');
  const body = ctx.body();
  if (body.action !== 'release') throw validation({ action: 'The only hold override is release.' });
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 5 || reason.length > 500) {
    throw validation({ reason: 'Give a reason of at least 5 characters.' });
  }
  const updated = await transaction(async (client) => {
    const locked = await holdInScope(actor, hold.id, client, true);
    if (locked.status !== 'held' || locked.expires_at.getTime() <= Date.now()) {
      throw new ApiError(409, 'invalid_transition', 'That hold is no longer live.', {
        from: locked.status === 'held' ? 'expired' : locked.status,
        action: 'release',
      });
    }
    await client.query(
      "UPDATE holds SET status = 'expired', expiry_notified = true, expires_at = now() WHERE id = $1",
      [locked.id],
    );
    await writeAudit(client, {
      holdId: locked.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'release',
      from: 'held',
      to: 'expired',
      reason,
    });
    return presentHold(client, { ...locked, status: 'expired' });
  });
  return json(200, { hold: updated });
}

export const holdRoutes: Route[] = [
  { method: 'POST', pattern: '/api/holds', handle: createHold },
  {
    method: 'GET',
    pattern: '/api/holds/:id',
    handle: async (ctx): Promise<Reply> => {
      const actor = ctx.requireActor();
      const hold = await holdInScope(actor, ctx.params.id as string);
      return json(200, { hold: await presentHold(pool, hold) });
    },
  },
  { method: 'DELETE', pattern: '/api/holds/:id', handle: releaseHold },
  { method: 'POST', pattern: '/api/holds/:id/confirm', handle: confirmHold },
  { method: 'POST', pattern: '/api/holds/:id/override', handle: overrideHold },
];

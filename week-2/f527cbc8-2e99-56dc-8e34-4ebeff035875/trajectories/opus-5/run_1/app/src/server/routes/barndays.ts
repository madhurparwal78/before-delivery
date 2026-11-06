import type { PoolClient } from 'pg';
import { json, route, type Ctx } from '../http.js';
import { query, queryOne, withClient, withTransaction, type Db } from '../db.js';
import { now } from '../clock.js';
import { newId } from '../util.js';
import {
  ValidationError,
  conflict,
  fieldMessages,
  notFound,
} from '../errors.js';
import { callerActor } from '../auth.js';
import { writeAudit } from '../audit.js';
import { appendEvent, barnDayChannel } from '../stream.js';
import {
  assertPublishAllowed,
  assertStartAllowed,
  assertTransition,
  computeDayInstants,
  dayStatusNow,
  loadBarnDay,
  type BarnDayRow,
} from '../domain/barndays.js';
import { onBarnDay, announceBookingChange, voidHoldDeposit } from '../domain/dayengine.js';
import { initialShares } from '../domain/split.js';
import { practice, practiceToday } from '../domain/practice.js';
import { parseBusinessDate, parseStartTime, wallTimeAt, formatInstant } from '../domain/time.js';
import {
  bookingRowSources,
  projectBookingRow,
  visibleToBarnManager,
} from '../domain/projection.js';
import { finishInvoiceInKillBill } from '../domain/invoicing.js';
import { barnDayBody, railBarnDayIds, readInteger, visibleBarnDay } from './shared.js';
import { allocationBody, closeDayTripInvoices } from './allocation.js';
import { cancelDayBookings } from './bookings.js';

const EVERYONE = ['farrier', 'apprentice', 'owner', 'barn_manager'] as const;

interface DayInput {
  barnId: string;
  businessDate: string;
  startTime: string;
  slotCount: number;
  slotMinutes: number;
  tripFeeCents: number;
}

async function readDayInput(
  db: Db,
  body: Record<string, unknown>,
  defaults: Partial<DayInput> = {},
): Promise<DayInput> {
  const errors: Record<string, string> = {};
  const { timeZone } = await practice(db);
  const today = await practiceToday(db);

  const barnId = typeof body.barn_id === 'string' ? body.barn_id : (defaults.barnId ?? '');
  const barn =
    barnId === ''
      ? null
      : await queryOne<{ id: string; trip_fee_cents: number }>(
          db,
          'SELECT id, trip_fee_cents FROM barns WHERE id = $1',
          [barnId],
        );
  if (barn === null) errors.barn_id = fieldMessages.required;

  const businessDate =
    typeof body.business_date === 'string' ? body.business_date : (defaults.businessDate ?? '');
  if (parseBusinessDate(businessDate) === null) errors.business_date = fieldMessages.required;
  else if (businessDate < today) errors.business_date = fieldMessages.pastDate;

  const startTime = typeof body.start_time === 'string' ? body.start_time : (defaults.startTime ?? '');
  if (parseStartTime(startTime) === null) errors.start_time = fieldMessages.required;

  let slotCount = defaults.slotCount ?? 0;
  let slotMinutes = defaults.slotMinutes ?? 0;
  try {
    slotCount = readInteger(body.slot_count ?? defaults.slotCount, 'slot_count', 1, 12);
  } catch (error) {
    if (error instanceof ValidationError) Object.assign(errors, error.errors);
  }
  try {
    slotMinutes = readInteger(body.slot_minutes ?? defaults.slotMinutes, 'slot_minutes', 15, 120);
  } catch (error) {
    if (error instanceof ValidationError) Object.assign(errors, error.errors);
  }

  let tripFeeCents = defaults.tripFeeCents ?? barn?.trip_fee_cents ?? 0;
  if (body.trip_fee_cents !== undefined && body.trip_fee_cents !== null) {
    try {
      tripFeeCents = readInteger(body.trip_fee_cents, 'trip_fee_cents', 0, 100000);
    } catch (error) {
      if (error instanceof ValidationError) Object.assign(errors, error.errors);
    }
  }

  // A start time that never occurs on that date is refused under the Start time field.
  if (errors.start_time === undefined && errors.business_date === undefined) {
    if (computeDayInstants(businessDate, startTime, timeZone) === null) {
      errors.start_time = fieldMessages.nonexistentTime(timeZone);
    }
  }

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return { barnId, businessDate, startTime, slotCount, slotMinutes, tripFeeCents };
}

async function writeSlots(db: Db, dayId: string, input: DayInput, zone: string, start: Date): Promise<void> {
  await query(db, 'DELETE FROM slots WHERE barn_day_id = $1', [dayId]);
  for (let position = 0; position < input.slotCount; position += 1) {
    const slotInstant = new Date(start.getTime() + position * input.slotMinutes * 60000);
    await query(db, 'INSERT INTO slots (id, barn_day_id, position, slot_time) VALUES ($1,$2,$3,$4)', [
      newId(),
      dayId,
      position,
      wallTimeAt(slotInstant, zone),
    ]);
  }
}

/**
 * Starting a barn day removes open holds and voids their deposits, fixes the set of
 * horses that count toward the trip fee and stores each one's share. Of several
 * simultaneous starts exactly one wins, because the whole action runs under the day's
 * row lock.
 */
async function startDay(db: PoolClient, day: BarnDayRow, ctx: Ctx, at: Date): Promise<void> {
  const holds = await query<{ id: string }>(
    db,
    `UPDATE bookings SET status = 'removed' WHERE barn_day_id = $1 AND status = 'held' RETURNING id`,
    [day.id],
  );
  for (const hold of holds) {
    await writeAudit(db, {
      actor: callerActor(ctx.caller),
      action: 'remove_hold',
      entityType: 'booking',
      entityId: hold.id,
      from: 'held',
      to: 'removed',
      at,
      requestId: ctx.requestId,
    });
    await voidHoldDeposit(db, hold.id, callerActor(ctx.caller), ctx.requestId, at);
  }

  const counting = await query<{ id: string; number: number }>(
    db,
    `SELECT id, number::int AS number FROM bookings
     WHERE barn_day_id = $1 AND status IN ('confirmed','cancelled_late')
     ORDER BY number`,
    [day.id],
  );
  const shares = initialShares(
    day.trip_fee_cents,
    counting.map((row) => ({ bookingId: row.id, number: row.number })),
  );
  for (const share of shares) {
    await query(
      db,
      `UPDATE bookings SET counts_for_trip = true, initial_share_cents = $2, share_cents = $2
       WHERE id = $1`,
      [share.bookingId, share.shareCents],
    );
  }

  await query(db, `UPDATE barn_days SET status = 'in_progress', started_at = $2 WHERE id = $1`, [
    day.id,
    at,
  ]);
  await writeAudit(db, {
    actor: callerActor(ctx.caller),
    action: 'start',
    entityType: 'barn_day',
    entityId: day.id,
    from: day.status,
    to: 'in_progress',
    at,
    requestId: ctx.requestId,
  });

  for (const row of counting) {
    await announceBookingChange(db, day.id, row.id, 'booking_moved', at);
  }
  await appendEvent(
    db,
    barnDayChannel(day.id, 'farrier'),
    'allocation_fixed',
    await allocationBody(db, day),
    at,
  );
}

export function registerBarnDayRoutes(): void {
  route({
    method: 'GET',
    path: '/api/barn-days',
    roles: EVERYONE,
    tokenAccess: 'read_only',
    handler: async (ctx: Ctx) => {
      const at = now();
      const body = await withClient(async (db) => {
        const ids = await railBarnDayIds(db, ctx.caller);
        const days: Record<string, unknown>[] = [];
        for (const id of ids) {
          const day = await loadBarnDay(db, id);
          if (day === null) continue;
          days.push(await barnDayBody(db, ctx.caller, day, at));
        }
        return days;
      });
      return json(200, body);
    },
  });

  route({
    method: 'GET',
    path: '/api/barn-days/:id',
    roles: EVERYONE,
    tokenAccess: 'read_only',
    handler: async (ctx: Ctx) => {
      const at = now();
      // Reading a barn day runs the offer pass first, so a freed slot is already offered.
      const context = { actor: callerActor(ctx.caller), requestId: ctx.requestId, queueKind: 'request' as const };
      await onBarnDay(ctx.params.id as string, context, async () => null);
      const body = await withClient(async (db) => {
        const day = await visibleBarnDay(db, ctx.caller, ctx.params.id as string, at);
        return await barnDayBody(db, ctx.caller, day, at);
      });
      return json(200, body);
    },
  });

  route({
    method: 'POST',
    path: '/api/barn-days',
    roles: ['farrier'],
    bodyKind: 'json',
    handler: async (ctx: Ctx) => {
      const body = await withTransaction(async (db) => {
        const input = await readDayInput(db, ctx.body());
        const { timeZone } = await practice(db);
        const instants = computeDayInstants(input.businessDate, input.startTime, timeZone);
        if (instants === null) {
          throw new ValidationError({ start_time: fieldMessages.nonexistentTime(timeZone) });
        }
        const at = now();
        const id = newId();
        await query(
          db,
          `INSERT INTO barn_days (id, barn_id, business_date, start_time, starts_at,
                                  cancellation_cutoff_at, slot_count, slot_minutes, trip_fee_cents,
                                  status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10)`,
          [
            id,
            input.barnId,
            input.businessDate,
            input.startTime,
            instants.startsAt,
            instants.cutoffAt,
            input.slotCount,
            input.slotMinutes,
            input.tripFeeCents,
            at,
          ],
        );
        await writeSlots(db, id, input, timeZone, instants.startsAt);
        await writeAudit(db, {
          actor: callerActor(ctx.caller),
          action: 'create',
          entityType: 'barn_day',
          entityId: id,
          to: 'draft',
          at,
          requestId: ctx.requestId,
        });
        const day = await loadBarnDay(db, id);
        if (day === null) throw new Error('barn day vanished');
        return await barnDayBody(db, ctx.caller, day, at);
      });
      return json(201, body);
    },
  });

  route({
    method: 'PATCH',
    path: '/api/barn-days/:id',
    roles: ['farrier'],
    bodyKind: 'json',
    handler: async (ctx: Ctx) => {
      const at = now();
      const body = await withTransaction(async (db) => {
        const day = await visibleBarnDay(db, ctx.caller, ctx.params.id as string, at, true);
        assertTransition(day, 'edit', await dayStatusNow(db, day, at));
        const input = await readDayInput(db, ctx.body(), {
          barnId: day.barn_id,
          businessDate: day.business_date,
          startTime: day.start_time,
          slotCount: day.slot_count,
          slotMinutes: day.slot_minutes,
          tripFeeCents: day.trip_fee_cents,
        });
        const { timeZone } = await practice(db);
        const instants = computeDayInstants(input.businessDate, input.startTime, timeZone);
        if (instants === null) {
          throw new ValidationError({ start_time: fieldMessages.nonexistentTime(timeZone) });
        }
        await query(
          db,
          `UPDATE barn_days SET barn_id = $2, business_date = $3, start_time = $4, starts_at = $5,
                                cancellation_cutoff_at = $6, slot_count = $7, slot_minutes = $8,
                                trip_fee_cents = $9
           WHERE id = $1`,
          [
            day.id,
            input.barnId,
            input.businessDate,
            input.startTime,
            instants.startsAt,
            instants.cutoffAt,
            input.slotCount,
            input.slotMinutes,
            input.tripFeeCents,
          ],
        );
        await writeSlots(db, day.id, input, timeZone, instants.startsAt);
        await writeAudit(db, {
          actor: callerActor(ctx.caller),
          action: 'edit',
          entityType: 'barn_day',
          entityId: day.id,
          from: day.status,
          to: day.status,
          at,
          requestId: ctx.requestId,
        });
        const updated = await loadBarnDay(db, day.id);
        if (updated === null) throw new Error('barn day vanished');
        return await barnDayBody(db, ctx.caller, updated, at);
      });
      return json(200, body);
    },
  });

  const transition = (
    action: 'publish' | 'start' | 'close' | 'cancel',
    path: string,
  ): void => {
    route({
      method: 'POST',
      path,
      roles: ['farrier'],
      bodyKind: 'json',
      handler: async (ctx: Ctx) => {
        const context = {
          actor: callerActor(ctx.caller),
          requestId: ctx.requestId,
          queueKind: 'request' as const,
        };
        // Invoice rows are written under the day's lock; their Kill Bill legs are
        // pushed once that transaction has committed, still before the response.
        const deferredInvoices: string[] = [];
        const result = await onBarnDay(ctx.params.id as string, context, async (db, day) => {
          const at = now();
          const printed = await dayStatusNow(db, day, at);
          assertTransition(day, action, printed);
          const today = await practiceToday(db);

          switch (action) {
            case 'publish': {
              assertPublishAllowed(day, today);
              await query(db, `UPDATE barn_days SET status = 'published' WHERE id = $1`, [day.id]);
              break;
            }
            case 'start': {
              assertStartAllowed(day, today);
              await startDay(db, day, ctx, at);
              break;
            }
            case 'close': {
              const open = await queryOne<{ count: number }>(
                db,
                `SELECT COUNT(*)::int AS count FROM bookings bk
                 LEFT JOIN visits v ON v.booking_id = bk.id
                 WHERE bk.barn_day_id = $1
                   AND (bk.status = 'confirmed' OR (v.id IS NOT NULL AND v.status = 'open'))`,
                [day.id],
              );
              if ((open?.count ?? 0) > 0) throw conflict('unresolved_bookings');
              await query(db, `UPDATE barn_days SET status = 'closed', closed_at = $2 WHERE id = $1`, [
                day.id,
                at,
              ]);
              deferredInvoices.push(...(await closeDayTripInvoices(db, day, ctx, at)));
              break;
            }
            case 'cancel': {
              await query(db, `UPDATE barn_days SET status = 'cancelled' WHERE id = $1`, [day.id]);
              await cancelDayBookings(db, day, ctx, at);
              break;
            }
          }

          if (action !== 'start') {
            await writeAudit(db, {
              actor: callerActor(ctx.caller),
              action,
              entityType: 'barn_day',
              entityId: day.id,
              from: day.status,
              to:
                action === 'publish' ? 'published' : action === 'close' ? 'closed' : 'cancelled',
              at,
              requestId: ctx.requestId,
            });
          }

          const refreshed = await loadBarnDay(db, day.id);
          if (refreshed === null) throw new Error('barn day vanished');
          return await barnDayBody(db, ctx.caller, refreshed, at);
        });
        if (result === null) throw notFound();
        for (const invoiceId of deferredInvoices) {
          await finishInvoiceInKillBill(invoiceId, {
            queueKind: 'request',
            actor: callerActor(ctx.caller),
            requestId: ctx.requestId,
          });
        }
        return json(200, result);
      },
    });
  };

  transition('publish', '/api/barn-days/:id/publish');
  transition('start', '/api/barn-days/:id/start');
  transition('close', '/api/barn-days/:id/close');
  transition('cancel', '/api/barn-days/:id/cancel');

  route({
    method: 'GET',
    path: '/api/barn-days/:id/bookings',
    roles: ['farrier', 'apprentice', 'barn_manager'],
    tokenAccess: 'read_only',
    handler: async (ctx: Ctx) => {
      const at = now();
      const context = { actor: callerActor(ctx.caller), requestId: ctx.requestId, queueKind: 'request' as const };
      await onBarnDay(ctx.params.id as string, context, async () => null);
      const rows = await withClient(async (db) => {
        const day = await visibleBarnDay(db, ctx.caller, ctx.params.id as string, at);
        const sources = await bookingRowSources(db, day.id);
        const role = ctx.caller.role;
        return sources
          .filter((source) => (role === 'barn_manager' ? visibleToBarnManager(source) : true))
          .map((source) => projectBookingRow(source, role));
      });
      return json(200, rows);
    },
  });

  route({
    method: 'GET',
    path: '/api/barn-days/:id/allocation',
    roles: ['farrier'],
    tokenAccess: 'read_only',
    handler: async (ctx: Ctx) => {
      const at = now();
      const body = await withClient(async (db) => {
        const day = await visibleBarnDay(db, ctx.caller, ctx.params.id as string, at);
        if (day.status !== 'in_progress' && day.status !== 'closed') throw conflict('not_started');
        return await allocationBody(db, day);
      });
      return json(200, body);
    },
  });

  route({
    method: 'GET',
    path: '/api/barn-days/:id/waitlist',
    roles: ['farrier'],
    tokenAccess: 'read_only',
    handler: async (ctx: Ctx) => {
      const at = now();
      const context = { actor: callerActor(ctx.caller), requestId: ctx.requestId, queueKind: 'request' as const };
      await onBarnDay(ctx.params.id as string, context, async () => null);
      const rows = await withClient(async (db) => {
        const day = await visibleBarnDay(db, ctx.caller, ctx.params.id as string, at);
        return await query<{
          id: string;
          position: number;
          horse_id: string;
          horse_name: string;
          joined_at: Date;
        }>(
          db,
          `SELECT w.id, w.position, h.id AS horse_id, h.name AS horse_name, w.joined_at
           FROM waitlist_entries w JOIN horses h ON h.id = w.horse_id
           WHERE w.barn_day_id = $1 ORDER BY w.position`,
          [day.id],
        );
      });
      const { timeZone } = await withClient((db) => practice(db));
      return json(
        200,
        rows.map((row) => ({
          id: row.id,
          position: row.position,
          horse: { id: row.horse_id, name: row.horse_name },
          joined_at: formatInstant(row.joined_at, timeZone),
        })),
      );
    },
  });
}


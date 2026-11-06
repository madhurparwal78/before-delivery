import { Router } from 'express';
import type { Cell, LoomCell } from '../../../shared/types.js';
import { minutesToHHMM } from '../../../shared/format.js';
import { lockKitchenDay, pool, withTransaction } from '../../db/pool.js';
import { env } from '../../env.js';
import { cellKey, occupiedCells } from '../../domain/availability.js';
import { checkCellsAreBookable, parseCells, readBookingDate } from '../../domain/cells.js';
import { confirmHeldBlock, type ConfirmContext } from '../../domain/confirming.js';
import { coveredUntil, dateIsCovered } from '../../domain/cover.js';
import {
  holdState,
  holdView,
  loadHold,
  loadHoldCells,
  loadHoldForUpdate,
} from '../../domain/holds.js';
import {
  cardInForce,
  loadKitchen,
  loadRateCards,
  loadStations,
  stationMap,
} from '../../domain/kitchens.js';
import { priceCells, toQuote } from '../../domain/pricing.js';
import { monthQuarters, quoteCells } from '../../domain/quoting.js';
import { packBalanceQuarters } from '../../domain/pack.js';
import { recordStateChange } from '../../domain/bookings.js';
import { newId } from '../../domain/secrets.js';
import { isValidDate, kitchenMinutes, kitchenToday, monthOf } from '../../domain/time.js';
import { memberForRequest, requireKitchen, requireMember, requireRole, requireUser } from '../access.js';
import { created, ok, param, route } from '../context.js';
import { failures } from '../errors.js';
import { asBoolean, asInteger } from '../fields.js';
import { withIdempotency } from '../idempotency.js';

export const loomRoutes = Router();

loomRoutes.get(
  '/kitchens/:kitchen_id/loom',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    const kitchen = await requireKitchen(pool, user, param(ctx.req, 'kitchen_id'));
    requireRole(user, 'operator', 'member');
    const date = ctx.req.query.date;
    if (!isValidDate(date)) throw failures.validation({ date: 'Give a kitchen date as YYYY-MM-DD.' });

    const member =
      user.role === 'member'
        ? await memberForRequest(pool, user, null)
        : typeof ctx.req.query.member_id === 'string' && ctx.req.query.member_id !== ''
          ? await requireMember(pool, user, ctx.req.query.member_id)
          : null;

    const stations = await loadStations(pool, kitchen.id);
    const today = kitchenToday(kitchen.timezone, ctx.now);
    const coverFor = member ?? null;
    const coveredThrough = coverFor ? await coveredUntil(pool, coverFor.id, today) : null;
    const occupied = await occupiedCells(pool, kitchen.id, date, ctx.now);

    const cells: LoomCell[] = occupied.map((cell) => {
      const start = minutesToHHMM(cell.start_minute);
      if (user.role === 'operator') {
        const view: LoomCell = {
          station_id: cell.station_id,
          start,
          state: cell.kind === 'hold' ? 'held' : 'booked',
          business: cell.business,
        };
        if (cell.hold_id) view.hold_id = cell.hold_id;
        if (cell.booking_id) view.booking_id = cell.booking_id;
        if (cell.expires_at) view.expires_at = cell.expires_at.toISOString();
        return view;
      }
      if (member && cell.member_id === member.id) {
        const view: LoomCell = {
          station_id: cell.station_id,
          start,
          state: cell.kind === 'hold' ? 'held' : 'booked',
        };
        if (cell.hold_id) view.hold_id = cell.hold_id;
        if (cell.booking_id) view.booking_id = cell.booking_id;
        if (cell.expires_at) view.expires_at = cell.expires_at.toISOString();
        return view;
      }
      return { station_id: cell.station_id, start, state: 'taken' };
    });

    return ok({
      date,
      today,
      server_now: ctx.now.toISOString(),
      timezone: kitchen.timezone,
      same_day_cutoff: minutesToHHMM(kitchen.same_day_cutoff_minutes),
      hold_seconds: env.holdSeconds,
      covered_until: coveredThrough,
      papers: coverFor !== null && !dateIsCovered(coveredThrough, date),
      stations,
      cells,
    });
  }),
);

async function pricingContext(kitchenId: string, now: Date) {
  const kitchen = await loadKitchen(pool, kitchenId);
  if (!kitchen) throw failures.notFound();
  const stations = await loadStations(pool, kitchenId);
  const today = kitchenToday(kitchen.timezone, now);
  const rateCard = cardInForce(await loadRateCards(pool, kitchenId), today);
  if (!rateCard) throw failures.notFound();
  return {
    kitchen,
    stations,
    stationsById: stationMap(stations),
    stationIds: new Set(stations.map((station) => station.id)),
    today,
    rateCard,
    nowMinutes: kitchenMinutes(kitchen.timezone, now),
  };
}

loomRoutes.post(
  '/quotes',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    requireRole(user, 'operator', 'member');
    const member = await memberForRequest(pool, user, ctx.body.member_id);
    const context = await pricingContext(member.kitchen_id, ctx.now);

    const date = readBookingDate(ctx.body.date, context.today);
    const parsed = parseCells(ctx.body.cells, context.stationIds);
    if ('failure' in parsed) throw parsed.failure;
    const usePack = asBoolean(ctx.body.use_pack);
    if (usePack === null) {
      throw failures.validation({ use_pack: 'Say whether to use pack hours.' });
    }

    const coveredThrough = await coveredUntil(pool, member.id, context.today);
    const covered = dateIsCovered(coveredThrough, date);
    // The member's own live hold is their pending block, so it stays priceable.
    const occupied = new Set(
      (await occupiedCells(pool, context.kitchen.id, date, ctx.now))
        .filter((cell) => !(cell.kind === 'hold' && cell.member_id === member.id))
        .map((cell) => cellKey(cell.station_id, cell.start_minute)),
    );

    const papers: Cell[] = covered
      ? []
      : parsed.cells.map((cell) => ({
          station_id: cell.station_id,
          start: minutesToHHMM(cell.start_minute),
        }));
    const taken: Cell[] = [];
    const priceable = covered
      ? parsed.cells.filter((cell) => {
          if (occupied.has(cellKey(cell.station_id, cell.start_minute))) {
            taken.push({ station_id: cell.station_id, start: minutesToHHMM(cell.start_minute) });
            return false;
          }
          return true;
        })
      : [];

    const before = await monthQuarters(pool, member.id, monthOf(date));
    const balance = usePack ? await packBalanceQuarters(pool, member.id) : 0;
    const priced = priceCells({
      cells: priceable,
      stations: context.stationsById,
      rateCard: context.rateCard,
      monthQuartersBefore: before,
      packQuartersAvailable: balance,
    });
    return ok({
      quote: toQuote(priced, date, before, context.rateCard.id),
      taken,
      papers,
    });
  }),
);

loomRoutes.post(
  '/holds',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    requireRole(user, 'operator', 'member');
    const member = await memberForRequest(pool, user, ctx.body.member_id);
    const context = await pricingContext(member.kitchen_id, ctx.now);

    const date = readBookingDate(ctx.body.date, context.today);
    const parsed = parseCells(ctx.body.cells, context.stationIds);
    if ('failure' in parsed) throw parsed.failure;

    const coveredThrough = await coveredUntil(pool, member.id, context.today);
    const bookable = checkCellsAreBookable({
      date,
      today: context.today,
      nowMinutes: context.nowMinutes,
      sameDayCutoffMinutes: context.kitchen.same_day_cutoff_minutes,
      covered: dateIsCovered(coveredThrough, date),
      cells: parsed.cells,
    });
    if (bookable) throw bookable;

    const result = await withTransaction(async (client) => {
      await lockKitchenDay(client, context.kitchen.id, date);
      const occupied = new Set(
        (await occupiedCells(client, context.kitchen.id, date, ctx.now)).map((cell) =>
          cellKey(cell.station_id, cell.start_minute),
        ),
      );
      const free = parsed.cells.filter(
        (cell) => !occupied.has(cellKey(cell.station_id, cell.start_minute)),
      );
      const taken: Cell[] = parsed.cells
        .filter((cell) => occupied.has(cellKey(cell.station_id, cell.start_minute)))
        .map((cell) => ({ station_id: cell.station_id, start: minutesToHHMM(cell.start_minute) }));
      if (free.length === 0) throw failures.cellsTaken(taken);

      const id = newId('hld');
      const expiresAt = new Date(ctx.now.getTime() + env.holdSeconds * 1000);
      await client.query(
        `INSERT INTO holds (id, kitchen_id, member_id, date, state, created_at, expires_at)
         VALUES ($1, $2, $3, $4, 'held', $5, $6)`,
        [id, context.kitchen.id, member.id, date, ctx.now, expiresAt],
      );
      for (const cell of free) {
        await client.query(
          'INSERT INTO hold_cells (hold_id, station_id, start_minute) VALUES ($1, $2, $3)',
          [id, cell.station_id, cell.start_minute],
        );
      }
      await recordStateChange(client, {
        actorId: user.id,
        kitchenId: context.kitchen.id,
        subject: 'hold',
        subjectId: id,
        from: null,
        to: 'held',
        now: ctx.now,
      });
      return { id, expiresAt, free, taken };
    });

    const quoted = await quoteCells(pool, {
      memberId: member.id,
      date,
      cells: result.free,
      usePack: false,
      stations: context.stationsById,
      rateCard: context.rateCard,
    });
    return created({
      hold: holdView(
        {
          id: result.id,
          kitchen_id: context.kitchen.id,
          member_id: member.id,
          date,
          state: 'held',
          created_at: ctx.now,
          expires_at: result.expiresAt,
        },
        result.free,
        quoted.quote,
        context.kitchen.timezone,
        ctx.now,
      ),
      taken: result.taken,
    });
  }),
);

loomRoutes.get(
  '/holds/:hold_id',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    const hold = await loadHold(pool, param(ctx.req, 'hold_id'));
    if (!hold || hold.kitchen_id !== user.kitchen_id) throw failures.notFound();
    if (user.role === 'member' && hold.member_id !== user.member_id) throw failures.notFound();
    requireRole(user, 'operator', 'member');
    const context = await pricingContext(hold.kitchen_id, ctx.now);
    const cells = await loadHoldCells(pool, hold.id);
    const quoted = await quoteCells(pool, {
      memberId: hold.member_id,
      date: hold.date,
      cells,
      usePack: false,
      stations: context.stationsById,
      rateCard: context.rateCard,
    });
    return ok({
      hold: holdView(hold, cells, quoted.quote, context.kitchen.timezone, ctx.now),
    });
  }),
);

loomRoutes.delete(
  '/holds/:hold_id',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    const hold = await loadHold(pool, param(ctx.req, 'hold_id'));
    if (!hold || hold.kitchen_id !== user.kitchen_id) throw failures.notFound();
    if (user.role === 'member' && hold.member_id !== user.member_id) throw failures.notFound();
    requireRole(user, 'operator', 'member');

    const state = holdState(hold, ctx.now);
    if (state === 'expired') throw failures.holdExpired();
    if (state !== 'held') throw failures.holdNotActive(state);

    await withTransaction(async (client) => {
      const fresh = await loadHoldForUpdate(client, hold.id);
      if (!fresh) throw failures.notFound();
      const freshState = holdState(fresh, ctx.now);
      if (freshState === 'expired') throw failures.holdExpired();
      if (freshState !== 'held') throw failures.holdNotActive(freshState);
      await client.query("UPDATE holds SET state = 'released' WHERE id = $1", [hold.id]);
      await recordStateChange(client, {
        actorId: user.id,
        kitchenId: hold.kitchen_id,
        subject: 'hold',
        subjectId: hold.id,
        from: 'held',
        to: 'released',
        now: ctx.now,
      });
    });

    const context = await pricingContext(hold.kitchen_id, ctx.now);
    const cells = await loadHoldCells(pool, hold.id);
    const quoted = await quoteCells(pool, {
      memberId: hold.member_id,
      date: hold.date,
      cells,
      usePack: false,
      stations: context.stationsById,
      rateCard: context.rateCard,
    });
    return ok({
      hold: holdView(
        { ...hold, state: 'released' },
        cells,
        quoted.quote,
        context.kitchen.timezone,
        ctx.now,
      ),
    });
  }),
);

loomRoutes.post(
  '/holds/:hold_id/confirm',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    const hold = await loadHold(pool, param(ctx.req, 'hold_id'));
    if (!hold || hold.kitchen_id !== user.kitchen_id) throw failures.notFound();
    if (user.role === 'member' && hold.member_id !== user.member_id) throw failures.notFound();
    requireRole(user, 'operator', 'member');

    return withIdempotency(ctx, user.id, async () => {
      const state = holdState(hold, ctx.now);
      if (state === 'expired') throw failures.holdExpired();
      if (state !== 'held') throw failures.holdNotActive(state);

      const usePack = asBoolean(ctx.body.use_pack);
      if (usePack === null) {
        throw failures.validation({ use_pack: 'Say whether to use pack hours.' });
      }
      const quotedTotal = asInteger(ctx.body.quoted_total_cents);
      if (quotedTotal === null) {
        throw failures.validation({ quoted_total_cents: 'Send the quoted total in whole cents.' });
      }

      const member = await requireMember(pool, user, hold.member_id);
      const context = await pricingContext(hold.kitchen_id, ctx.now);
      const balance = await packBalanceQuarters(pool, member.id);
      if (usePack && balance === 0) {
        throw failures.validation({ use_pack: 'No pack hours left.' });
      }
      const coveredThrough = await coveredUntil(pool, member.id, context.today);
      if (!dateIsCovered(coveredThrough, hold.date)) {
        throw failures.complianceBlocked(`Papers do not cover ${hold.date}.`);
      }

      const cells = await loadHoldCells(pool, hold.id);
      const before = await monthQuarters(pool, member.id, monthOf(hold.date));
      const priced = priceCells({
        cells,
        stations: context.stationsById,
        rateCard: context.rateCard,
        monthQuartersBefore: before,
        packQuartersAvailable: usePack ? balance : 0,
      });
      if (priced.total_cents !== quotedTotal) {
        throw failures.quoteChanged(toQuote(priced, hold.date, before, context.rateCard.id));
      }

      const confirmContext: ConfirmContext = {
        kitchen: context.kitchen,
        member,
        stations: context.stations,
        stationsById: context.stationsById,
        rateCard: context.rateCard,
        actorId: user.id,
        now: ctx.now,
      };
      const outcome = await confirmHeldBlock(confirmContext, {
        holdId: hold.id,
        date: hold.date,
        cells,
        priced,
      });
      return created({ booking: outcome.booking, invoice: outcome.invoice });
    });
  }),
);

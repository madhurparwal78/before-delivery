import { Router } from 'express';
import type { Quote, Station } from '../../../shared/types.js';
import { LOOM_END_MINUTE, LOOM_START_MINUTE } from '../../../shared/types.js';
import { formatMoney, hhmmToMinutes, minutesToHHMM } from '../../../shared/format.js';
import { pool, withTransaction, type Sql } from '../../db/pool.js';
import {
  MAX_CELLS_PER_REQUEST,
  checkCellsAreBookable,
  validateBookingDate,
} from '../../domain/cells.js';
import {
  createSeriesBookings,
  findSeriesConflicts,
  type ConfirmContext,
  type SeriesPlan,
} from '../../domain/confirming.js';
import { coveredUntil, dateIsCovered } from '../../domain/cover.js';
import { cardInForce, loadKitchen, loadRateCards, loadStations, stationMap } from '../../domain/kitchens.js';
import { packBalanceQuarters } from '../../domain/pack.js';
import { priceCells, toQuote, type CellRef, type Priced, type RateCardRecord, type StationRef } from '../../domain/pricing.js';
import { monthQuarters } from '../../domain/quoting.js';
import { addDays, kitchenInstant, kitchenMinutes, kitchenToday, monthOf } from '../../domain/time.js';
import { memberForRequest, requireRole, requireUser } from '../access.js';
import { created, ok, route } from '../context.js';
import { failures } from '../errors.js';
import { asBoolean, asInteger, asString } from '../fields.js';
import { withIdempotency } from '../idempotency.js';
import type { KitchenRecord, MemberRecord } from '../../domain/kitchens.js';

export const seriesRoutes = Router();

interface SeriesContext {
  kitchen: KitchenRecord;
  stations: Station[];
  stationsById: Map<string, StationRef>;
  rateCard: RateCardRecord;
  today: string;
  nowMinutes: number;
}

async function seriesContext(kitchenId: string, now: Date): Promise<SeriesContext> {
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
    rateCard,
    today,
    nowMinutes: kitchenMinutes(kitchen.timezone, now),
  };
}

interface SeriesRequest {
  stationIds: string[];
  startMinute: number;
  endMinute: number;
  firstDate: string;
  weeks: number;
  usePack: boolean;
}

function readSeriesRequest(
  body: Record<string, unknown>,
  context: SeriesContext,
): SeriesRequest {
  const errors: Record<string, string> = {};
  const known = new Set(context.stations.map((station) => station.id));
  const rawStations = body.station_ids;
  const stationIds: string[] = [];
  if (!Array.isArray(rawStations) || rawStations.length === 0) {
    errors.station_ids = 'Choose at least one station.';
  } else {
    for (const entry of rawStations) {
      if (typeof entry !== 'string' || !known.has(entry) || stationIds.includes(entry)) {
        errors.station_ids = 'Choose stations of this kitchen, once each.';
        break;
      }
      stationIds.push(entry);
    }
  }

  const startMinute = typeof body.start === 'string' ? hhmmToMinutes(body.start) : null;
  const endMinute = typeof body.end === 'string' ? hhmmToMinutes(body.end) : null;
  if (startMinute === null || startMinute % 15 !== 0 || startMinute < LOOM_START_MINUTE || startMinute >= LOOM_END_MINUTE) {
    errors.start = 'Start on a quarter hour from 04:00.';
  }
  if (endMinute === null || endMinute % 15 !== 0 || endMinute > LOOM_END_MINUTE) {
    errors.end = 'End on a quarter hour up to 24:00.';
  } else if (startMinute !== null && endMinute <= startMinute) {
    errors.end = 'End after the start.';
  }

  const weeks = asInteger(body.weeks);
  if (weeks === null || weeks < 2 || weeks > 12) errors.weeks = 'Book 2 to 12 weeks.';
  const usePack = asBoolean(body.use_pack);
  if (usePack === null) errors.use_pack = 'Say whether to use pack hours.';

  const dateFailure = validateBookingDate(body.first_date, context.today);
  if (dateFailure) {
    const given = dateFailure.body.errors?.date;
    if (given) errors.first_date = given;
  }

  if (
    startMinute !== null &&
    endMinute !== null &&
    endMinute > startMinute &&
    stationIds.length > 0 &&
    (((endMinute - startMinute) / 15) * stationIds.length > MAX_CELLS_PER_REQUEST)
  ) {
    errors.station_ids = `Each week may hold at most ${MAX_CELLS_PER_REQUEST} cells.`;
  }

  if (Object.keys(errors).length > 0) throw failures.validation(errors);
  const firstDate = asString(body.first_date);
  if (
    startMinute === null ||
    endMinute === null ||
    weeks === null ||
    usePack === null ||
    firstDate === null
  ) {
    throw failures.validation({ first_date: 'Give a kitchen date as YYYY-MM-DD.' });
  }
  return { stationIds, startMinute, endMinute, firstDate, weeks, usePack };
}

function occurrenceCells(request: SeriesRequest, stations: Map<string, StationRef>): CellRef[] {
  const ordered = [...request.stationIds].sort(
    (a, b) => (stations.get(a)?.order ?? 0) - (stations.get(b)?.order ?? 0),
  );
  const cells: CellRef[] = [];
  for (let minute = request.startMinute; minute < request.endMinute; minute += 15) {
    for (const stationId of ordered) cells.push({ station_id: stationId, start_minute: minute });
  }
  return cells;
}

interface PlannedSeries {
  plan: SeriesPlan;
  occurrences: { date: string; starts_at: string; ends_at: string; quote: Quote }[];
}

/** Every occurrence keeps the same kitchen wall-clock times across DST changes. */
async function planSeries(
  client: Sql,
  context: SeriesContext,
  member: MemberRecord,
  request: SeriesRequest,
): Promise<PlannedSeries> {
  const cells = occurrenceCells(request, context.stationsById);
  const coveredThrough = await coveredUntil(client, member.id, context.today);
  const balanceStart = request.usePack ? await packBalanceQuarters(client, member.id) : 0;

  const dates: string[] = [];
  for (let week = 0; week < request.weeks; week += 1) {
    dates.push(addDays(request.firstDate, week * 7));
  }
  for (const date of dates) {
    const horizon = validateBookingDate(date, context.today);
    if (horizon) throw failures.validation({ weeks: `Every week must fall inside the booking horizon.` });
  }
  for (const date of dates) {
    const bookable = checkCellsAreBookable({
      date,
      today: context.today,
      nowMinutes: context.nowMinutes,
      sameDayCutoffMinutes: context.kitchen.same_day_cutoff_minutes,
      covered: dateIsCovered(coveredThrough, date),
      cells,
    });
    if (bookable) throw bookable;
  }

  const monthAccrued = new Map<string, number>();
  let packRemaining = balanceStart;
  const planned: { date: string; cells: CellRef[]; priced: Priced }[] = [];
  const occurrences: { date: string; starts_at: string; ends_at: string; quote: Quote }[] = [];
  let totalCents = 0;
  for (const date of dates) {
    const month = monthOf(date);
    if (!monthAccrued.has(month)) monthAccrued.set(month, await monthQuarters(client, member.id, month));
    const before = monthAccrued.get(month) ?? 0;
    const priced = priceCells({
      cells,
      stations: context.stationsById,
      rateCard: context.rateCard,
      monthQuartersBefore: before,
      packQuartersAvailable: packRemaining,
    });
    monthAccrued.set(month, before + priced.quarters);
    packRemaining -= priced.pack_quarters;
    totalCents += priced.total_cents;
    planned.push({ date, cells, priced });
    occurrences.push({
      date,
      starts_at: kitchenInstant(context.kitchen.timezone, date, request.startMinute).toISOString(),
      ends_at: kitchenInstant(context.kitchen.timezone, date, request.endMinute).toISOString(),
      quote: toQuote(priced, date, before, context.rateCard.id),
    });
  }

  return {
    plan: {
      occurrences: planned,
      stationIds: request.stationIds,
      startMinute: request.startMinute,
      endMinute: request.endMinute,
      weeks: request.weeks,
      totalCents,
    },
    occurrences,
  };
}

seriesRoutes.post(
  '/series/quote',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    requireRole(user, 'operator', 'member');
    const member = await memberForRequest(pool, user, ctx.body.member_id);
    const context = await seriesContext(member.kitchen_id, ctx.now);
    const request = readSeriesRequest(ctx.body, context);
    const planned = await planSeries(pool, context, member, request);

    const conflicts = await withTransaction((client) =>
      findSeriesConflicts(
        client,
        {
          kitchen: context.kitchen,
          member,
          stations: context.stations,
          stationsById: context.stationsById,
          rateCard: context.rateCard,
          actorId: user.id,
          now: ctx.now,
        },
        planned.plan,
      ),
    );
    if (conflicts.dates.length > 0) throw failures.seriesConflict(conflicts.dates, conflicts.taken);

    return ok({
      occurrences: planned.occurrences,
      total_cents: planned.plan.totalCents,
      total: formatMoney(planned.plan.totalCents),
    });
  }),
);

seriesRoutes.post(
  '/series',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    requireRole(user, 'operator', 'member');
    const member = await memberForRequest(pool, user, ctx.body.member_id);

    return withIdempotency(ctx, user.id, async () => {
      const context = await seriesContext(member.kitchen_id, ctx.now);
      const request = readSeriesRequest(ctx.body, context);
      const quotedTotal = asInteger(ctx.body.quoted_total_cents);
      if (quotedTotal === null) {
        throw failures.validation({ quoted_total_cents: 'Send the quoted total in whole cents.' });
      }
      if (request.usePack && (await packBalanceQuarters(pool, member.id)) === 0) {
        throw failures.validation({ use_pack: 'No pack hours left.' });
      }
      const planned = await planSeries(pool, context, member, request);
      if (planned.plan.totalCents !== quotedTotal) {
        throw failures.quoteChanged(planned.occurrences[0].quote);
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
      const outcome = await createSeriesBookings(confirmContext, planned.plan);
      return created({
        series: {
          id: outcome.seriesId,
          weekday: new Date(`${request.firstDate}T00:00:00Z`).getUTCDay(),
          start: minutesToHHMM(request.startMinute),
          end: minutesToHHMM(request.endMinute),
          station_ids: request.stationIds,
          weeks: request.weeks,
          booking_ids: outcome.bookingIds,
        },
        bookings: outcome.bookings,
        invoice: outcome.invoice,
      });
    });
  }),
);

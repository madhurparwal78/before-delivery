import { randomUUID } from 'node:crypto';
import { lockKey, query, queryOne, transaction, txRows } from '../db.js';
import { conflict, notFound, validation } from '../http/errors.js';
import { readJsonBody, type Ctx, type Reply, type Router } from '../http/router.js';
import { actorInWorkspace, requireAction, type Actor } from '../auth.js';
import { FIELD_ERRORS } from '../../shared/copy.js';
import type { BaseKey } from '../../shared/format.js';
import {
  addDays,
  isValidDateString,
  localDate,
  localParts,
  splitToday,
  startOfLocalDay,
  toInstantString,
  ZONES,
} from '../../shared/zone.js';
import {
  berthFits,
  MAX_NIGHTS,
  nightDates,
  nightFeeMinor,
  SHORE_POWER_SLOT_KW_FLOOR,
  tariffInForce,
  type TariffRow,
} from '../domain/berths.js';
import { decimalAboveZero, isDecimalString } from '../domain/money.js';
import { metres, requireYacht, yachtSize } from '../records.js';
import { json } from './helpers.js';

const SLOT_MS = 1_800_000;

interface MarinaRow {
  readonly workspace_id: string;
  readonly id: string;
  readonly name: string;
  readonly base: BaseKey;
  readonly seed_order: number;
}

interface BerthRow {
  readonly marina_id: string;
  readonly code: string;
  readonly length_cm: number;
  readonly width_cm: number;
  readonly depth_cm: number;
  readonly seed_order: number;
}

interface PontoonRow {
  readonly marina_id: string;
  readonly code: string;
  readonly limit_kw: string;
  readonly seed_order: number;
}

async function requireMarina(actor: Actor, marinaId: string): Promise<MarinaRow> {
  const marina = await queryOne<MarinaRow>(
    'SELECT * FROM marinas WHERE workspace_id = $1 AND id = $2',
    [actor.workspaceId, marinaId],
  );
  if (marina === null) throw notFound();
  return marina;
}

async function tariffsOf(workspaceId: string, marinaId: string): Promise<TariffRow[]> {
  return query<TariffRow>(
    `SELECT id, effective_date, rate_per_metre_minor FROM marina_tariffs
      WHERE workspace_id = $1 AND marina_id = $2 ORDER BY effective_date`,
    [workspaceId, marinaId],
  );
}

async function listMarinas(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  requireAction(actor, 'marinas_read');
  const marinas = await query<MarinaRow>(
    'SELECT * FROM marinas WHERE workspace_id = $1 ORDER BY seed_order',
    [actor.workspaceId],
  );
  const berths = await query<BerthRow>(
    'SELECT * FROM berths WHERE workspace_id = $1 ORDER BY seed_order',
    [actor.workspaceId],
  );
  const pontoons = await query<PontoonRow>(
    'SELECT * FROM pontoons WHERE workspace_id = $1 ORDER BY seed_order',
    [actor.workspaceId],
  );
  const result = [];
  for (const marina of marinas) {
    const tariffs = await tariffsOf(actor.workspaceId, marina.id);
    result.push({
      id: marina.id,
      name: marina.name,
      base: marina.base,
      today: localDate(ZONES[marina.base], ctx.now),
      berths: berths
        .filter((berth) => berth.marina_id === marina.id)
        .map((berth) => ({
          code: berth.code,
          lengthM: metres(berth.length_cm),
          widthM: metres(berth.width_cm),
          depthM: metres(berth.depth_cm),
        })),
      pontoons: pontoons
        .filter((pontoon) => pontoon.marina_id === marina.id)
        .map((pontoon) => ({ code: pontoon.code, limitKw: Number(pontoon.limit_kw) })),
      tariffs: tariffs.map((tariff) => ({
        id: tariff.id,
        effectiveDate: tariff.effective_date,
        ratePerMetreMinor: tariff.rate_per_metre_minor,
        currency: 'EUR',
      })),
    });
  }
  return json(200, { marinas: result });
}

interface BookedNightRow {
  readonly berth_code: string;
  readonly night_date: string;
}

async function searchBerths(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const marina = await requireMarina(actor, ctx.params.marinaId);
  const yacht = await requireYacht(actor, (ctx.query.get('yachtSlug') ?? '').trim());
  requireAction(actor, 'marinas_read');
  const marinaToday = localDate(ZONES[marina.base], ctx.now);
  const { arrivalDate, nights } = readStay(
    ctx.query.get('arrivalDate'),
    ctx.query.get('nights'),
    marinaToday,
  );
  const berths = await query<BerthRow>(
    'SELECT * FROM berths WHERE workspace_id = $1 AND marina_id = $2 ORDER BY seed_order',
    [actor.workspaceId, marina.id],
  );
  const tariffs = await tariffsOf(actor.workspaceId, marina.id);
  const dates = nightDates(arrivalDate, nights);
  const booked = await query<BookedNightRow>(
    `SELECT b.berth_code, n.night_date FROM berth_booking_nights n
       JOIN berth_bookings b ON b.id = n.booking_id
      WHERE b.workspace_id = $1 AND b.marina_id = $2 AND n.night_date = ANY($3::date[])`,
    [actor.workspaceId, marina.id, dates],
  );
  return json(200, {
    berths: berths.map((berth) => {
      const priced = dates.map((date) => {
        const tariff = tariffInForce(tariffs, date);
        return {
          date,
          tariffId: tariff.id,
          ratePerMetreMinor: tariff.rate_per_metre_minor,
          feeMinor: Number(nightFeeMinor(tariff.rate_per_metre_minor, yacht.length_cm)),
        };
      });
      return {
        code: berth.code,
        lengthM: metres(berth.length_cm),
        widthM: metres(berth.width_cm),
        depthM: metres(berth.depth_cm),
        fits: berthFits(yachtSize(yacht), {
          lengthCm: berth.length_cm,
          widthCm: berth.width_cm,
          depthCm: berth.depth_cm,
        }),
        available: !booked.some((night) => night.berth_code === berth.code),
        nights: priced,
        totalMinor: priced.reduce((total, night) => total + night.feeMinor, 0),
        currency: 'EUR',
      };
    }),
  });
}

function readStay(
  arrivalValue: string | null,
  nightsValue: string | null,
  marinaToday: string,
): { arrivalDate: string; nights: number } {
  const errors: Record<string, string> = {};
  const arrivalDate = (arrivalValue ?? '').trim();
  if (arrivalDate === '') errors.arrivalDate = FIELD_ERRORS.required;
  else if (!isValidDateString(arrivalDate)) errors.arrivalDate = FIELD_ERRORS.dateFormat;
  else if (arrivalDate < marinaToday) errors.arrivalDate = FIELD_ERRORS.arrivalDate;
  const nights = Number.parseInt((nightsValue ?? '1').trim(), 10);
  if (!Number.isInteger(nights) || nights < 1 || nights > MAX_NIGHTS) {
    errors.nights = FIELD_ERRORS.wholeRange(1, MAX_NIGHTS);
  }
  if (Object.keys(errors).length > 0) throw validation(errors);
  return { arrivalDate, nights };
}

interface BookingRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly yacht_id: string;
  readonly marina_id: string;
  readonly berth_code: string;
  readonly arrival_date: string;
  readonly departure_date: string;
  readonly total_minor: string;
  readonly currency: string;
  readonly booked_by_name: string;
  readonly booked_at: Date;
}

async function bookingJson(booking: BookingRow, yachtSlug: string): Promise<Record<string, unknown>> {
  const nights = await query<{
    night_date: string;
    tariff_id: string;
    rate_per_metre_minor: number;
    fee_minor: string;
  }>(
    `SELECT night_date, tariff_id, rate_per_metre_minor, fee_minor FROM berth_booking_nights
      WHERE booking_id = $1 ORDER BY night_date`,
    [booking.id],
  );
  return {
    id: booking.id,
    yachtSlug,
    marinaId: booking.marina_id,
    berthCode: booking.berth_code,
    arrivalDate: booking.arrival_date,
    departureDate: booking.departure_date,
    nights: nights.map((night) => ({
      date: night.night_date,
      tariffId: night.tariff_id,
      ratePerMetreMinor: night.rate_per_metre_minor,
      feeMinor: Number(night.fee_minor),
    })),
    totalMinor: Number(booking.total_minor),
    currency: booking.currency,
    bookedBy: booking.booked_by_name,
    bookedAt: toInstantString(booking.booked_at),
  };
}

async function bookBerth(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  requireAction(actor, 'bookings');
  const body = readJsonBody(ctx);
  const marina = await requireMarina(actor, typeof body.marinaId === 'string' ? body.marinaId : '');
  const yacht = await requireYacht(actor, typeof body.yachtSlug === 'string' ? body.yachtSlug : '');
  const berth = await queryOne<BerthRow>(
    'SELECT * FROM berths WHERE workspace_id = $1 AND marina_id = $2 AND code = $3',
    [actor.workspaceId, marina.id, typeof body.berthCode === 'string' ? body.berthCode : ''],
  );
  if (berth === null) throw notFound();
  const marinaToday = localDate(ZONES[marina.base], ctx.now);
  const { arrivalDate, nights } = readStay(
    typeof body.arrivalDate === 'string' ? body.arrivalDate : null,
    body.nights === undefined ? null : String(body.nights),
    marinaToday,
  );
  if (
    !berthFits(yachtSize(yacht), {
      lengthCm: berth.length_cm,
      widthCm: berth.width_cm,
      depthCm: berth.depth_cm,
    })
  ) {
    throw conflict('does_not_fit');
  }
  const dates = nightDates(arrivalDate, nights);
  const tariffs = await tariffsOf(actor.workspaceId, marina.id);
  const id = await transaction(async (client) => {
    await lockKey(client, 'berth', actor.workspaceId, marina.id, berth.code);
    const clash = await txRows<{ night_date: string }>(
      client,
      `SELECT n.night_date FROM berth_booking_nights n JOIN berth_bookings b ON b.id = n.booking_id
        WHERE b.workspace_id = $1 AND b.marina_id = $2 AND b.berth_code = $3
          AND n.night_date = ANY($4::date[])`,
      [actor.workspaceId, marina.id, berth.code, dates],
    );
    if (clash.length > 0) throw conflict('berth_taken');
    const bookingId = randomUUID();
    const priced = dates.map((date) => {
      const tariff = tariffInForce(tariffs, date);
      return { date, tariff, feeMinor: nightFeeMinor(tariff.rate_per_metre_minor, yacht.length_cm) };
    });
    const total = priced.reduce((sum, night) => sum + night.feeMinor, 0n);
    await client.query(
      `INSERT INTO berth_bookings (id, workspace_id, yacht_id, marina_id, berth_code, arrival_date,
          departure_date, total_minor, currency, booked_by_member_id, booked_by_name, booked_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'EUR',$9,$10,$11)`,
      [
        bookingId,
        actor.workspaceId,
        yacht.id,
        marina.id,
        berth.code,
        arrivalDate,
        addDays(arrivalDate, nights),
        total.toString(),
        actor.id,
        actor.name,
        ctx.now,
      ],
    );
    for (const night of priced) {
      await client.query(
        `INSERT INTO berth_booking_nights (booking_id, night_date, tariff_id, rate_per_metre_minor, fee_minor)
         VALUES ($1,$2,$3,$4,$5)`,
        [bookingId, night.date, night.tariff.id, night.tariff.rate_per_metre_minor, night.feeMinor.toString()],
      );
    }
    return bookingId;
  });
  const booking = (await queryOne<BookingRow>('SELECT * FROM berth_bookings WHERE id = $1', [
    id,
  ])) as BookingRow;
  return json(201, { booking: await bookingJson(booking, yacht.slug) });
}

async function readBooking(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const booking = await queryOne<BookingRow & { yacht_slug: string }>(
    `SELECT b.*, y.slug AS yacht_slug FROM berth_bookings b JOIN yachts y ON y.id = b.yacht_id
      WHERE b.id = $1 AND b.workspace_id = $2`,
    [ctx.params.bookingId, actor.workspaceId],
  );
  if (booking === null) throw notFound();
  requireAction(actor, 'bookings');
  return json(200, { booking: await bookingJson(booking, booking.yacht_slug) });
}

async function addTariff(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const marina = await requireMarina(actor, ctx.params.marinaId);
  requireAction(actor, 'tariffs_write');
  const body = readJsonBody(ctx);
  const errors: Record<string, string> = {};
  const effectiveDate = typeof body.effectiveDate === 'string' ? body.effectiveDate.trim() : '';
  const marinaToday = localDate(ZONES[marina.base], ctx.now);
  if (effectiveDate === '') errors.effectiveDate = FIELD_ERRORS.required;
  else if (!isValidDateString(effectiveDate)) errors.effectiveDate = FIELD_ERRORS.dateFormat;
  else if (effectiveDate <= marinaToday) errors.effectiveDate = FIELD_ERRORS.effectiveDate;
  const rate =
    typeof body.ratePerMetreMinor === 'number'
      ? body.ratePerMetreMinor
      : Number(body.ratePerMetreMinor);
  if (!Number.isInteger(rate) || rate < 1 || rate > 100000) {
    errors.ratePerMetreMinor = FIELD_ERRORS.wholeRange(1, 100000);
  }
  const existing =
    errors.effectiveDate === undefined
      ? await queryOne<{ id: string }>(
          'SELECT id FROM marina_tariffs WHERE workspace_id = $1 AND marina_id = $2 AND effective_date = $3',
          [actor.workspaceId, marina.id, effectiveDate],
        )
      : null;
  if (existing !== null) throw conflict('date_exists');
  if (Object.keys(errors).length > 0) throw validation(errors);
  const id = randomUUID();
  await query(
    `INSERT INTO marina_tariffs (id, workspace_id, marina_id, effective_date, rate_per_metre_minor, currency)
     VALUES ($1,$2,$3,$4,$5,'EUR')`,
    [id, actor.workspaceId, marina.id, effectiveDate, rate],
  );
  return json(201, {
    tariff: { id, effectiveDate, ratePerMetreMinor: rate, currency: 'EUR' },
  });
}

async function listExchangeTables(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  requireAction(actor, 'marinas_read');
  const tables = await query<{
    id: string;
    effective_date: string;
    rate_gbp: string;
    rate_usd: string;
  }>(
    'SELECT id, effective_date, rate_gbp, rate_usd FROM exchange_tables WHERE workspace_id = $1 ORDER BY effective_date',
    [actor.workspaceId],
  );
  return json(200, {
    exchangeTables: tables.map((table) => ({
      id: table.id,
      effectiveDate: table.effective_date,
      rates: { GBP: table.rate_gbp, USD: table.rate_usd },
    })),
  });
}

async function addExchangeTable(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  requireAction(actor, 'tariffs_write');
  const body = readJsonBody(ctx);
  const errors: Record<string, string> = {};
  const effectiveDate = typeof body.effectiveDate === 'string' ? body.effectiveDate.trim() : '';
  const todayDate = splitToday(ctx.now);
  if (effectiveDate === '') errors.effectiveDate = FIELD_ERRORS.required;
  else if (!isValidDateString(effectiveDate)) errors.effectiveDate = FIELD_ERRORS.dateFormat;
  else if (effectiveDate <= todayDate) errors.effectiveDate = FIELD_ERRORS.effectiveDate;
  const given =
    body.rates !== null && typeof body.rates === 'object' && !Array.isArray(body.rates)
      ? (body.rates as Record<string, unknown>)
      : {};
  const readRate = (key: string): string => {
    const value = given[key];
    const text = typeof value === 'string' ? value.trim() : String(value ?? '');
    if (text === '' || text === 'undefined') {
      errors[`rates.${key}`] = FIELD_ERRORS.required;
      return '0';
    }
    if (!isDecimalString(text, 6) || !decimalAboveZero(text)) {
      errors[`rates.${key}`] = FIELD_ERRORS.exchangeRate;
      return '0';
    }
    return text;
  };
  const gbp = readRate('GBP');
  const usd = readRate('USD');
  const existing =
    errors.effectiveDate === undefined
      ? await queryOne<{ id: string }>(
          'SELECT id FROM exchange_tables WHERE workspace_id = $1 AND effective_date = $2',
          [actor.workspaceId, effectiveDate],
        )
      : null;
  if (existing !== null) throw conflict('date_exists');
  if (Object.keys(errors).length > 0) throw validation(errors);
  const id = randomUUID();
  await query(
    'INSERT INTO exchange_tables (id, workspace_id, effective_date, rate_gbp, rate_usd) VALUES ($1,$2,$3,$4,$5)',
    [id, actor.workspaceId, effectiveDate, gbp, usd],
  );
  return json(201, {
    exchangeTable: { id, effectiveDate, rates: { GBP: gbp, USD: usd } },
  });
}

interface ShorePowerBookingRow {
  readonly id: string;
  readonly yacht_id: string;
  readonly marina_id: string;
  readonly pontoon_code: string;
  readonly slot_start: Date;
  readonly slot_end: Date;
  readonly kw: string;
  readonly booked_by_name: string;
  readonly booked_at: Date;
}

function slotStarts(zone: string, date: string): Date[] {
  const start = startOfLocalDay(zone, date).getTime();
  const end = startOfLocalDay(zone, addDays(date, 1)).getTime();
  const slots: Date[] = [];
  for (let time = start; time < end; time += SLOT_MS) slots.push(new Date(time));
  return slots;
}

async function readSlots(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const marina = await requireMarina(actor, ctx.params.marinaId);
  const pontoon = await queryOne<PontoonRow>(
    'SELECT * FROM pontoons WHERE workspace_id = $1 AND marina_id = $2 AND code = $3',
    [actor.workspaceId, marina.id, ctx.params.code],
  );
  if (pontoon === null) throw notFound();
  requireAction(actor, 'marinas_read');
  const zone = ZONES[marina.base];
  const date = (ctx.query.get('date') ?? '').trim();
  if (!isValidDateString(date)) throw validation({ date: FIELD_ERRORS.dateFormat });
  const starts = slotStarts(zone, date);
  const bookings = await query<ShorePowerBookingRow & { yacht_slug: string; yacht_name: string }>(
    `SELECT s.*, y.slug AS yacht_slug, y.name AS yacht_name FROM shore_power_bookings s
       JOIN yachts y ON y.id = s.yacht_id
      WHERE s.workspace_id = $1 AND s.marina_id = $2 AND s.pontoon_code = $3
        AND s.slot_start >= $4 AND s.slot_start <= $5`,
    [
      actor.workspaceId,
      marina.id,
      pontoon.code,
      starts[0],
      starts[starts.length - 1],
    ],
  );
  const limitKw = Number(pontoon.limit_kw);
  return json(200, {
    date,
    base: marina.base,
    limitKw,
    slots: starts.map((start) => {
      const onSlot = bookings.filter(
        (booking) => booking.slot_start.getTime() === start.getTime(),
      );
      const bookedKw = onSlot.reduce((total, booking) => total + Number(booking.kw), 0);
      const past = ctx.now.getTime() >= start.getTime();
      const full = limitKw - bookedKw < SHORE_POWER_SLOT_KW_FLOOR;
      return {
        startsAt: toInstantString(start),
        endsAt: toInstantString(new Date(start.getTime() + SLOT_MS)),
        status: past ? 'past' : full ? 'full' : 'open',
        bookedKw,
        bookings: onSlot.map((booking) => ({
          yachtSlug: booking.yacht_slug,
          yachtName: booking.yacht_name,
        })),
      };
    }),
  });
}

async function bookShorePower(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  requireAction(actor, 'bookings');
  const body = readJsonBody(ctx);
  const marina = await requireMarina(actor, typeof body.marinaId === 'string' ? body.marinaId : '');
  const yacht = await requireYacht(actor, typeof body.yachtSlug === 'string' ? body.yachtSlug : '');
  const pontoon = await queryOne<PontoonRow>(
    'SELECT * FROM pontoons WHERE workspace_id = $1 AND marina_id = $2 AND code = $3',
    [actor.workspaceId, marina.id, typeof body.pontoonCode === 'string' ? body.pontoonCode : ''],
  );
  if (pontoon === null) throw notFound();
  const zone = ZONES[marina.base];
  const slotStartValue = typeof body.slotStart === 'string' ? body.slotStart : '';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(slotStartValue)) {
    throw validation({ slotStart: FIELD_ERRORS.slotStart });
  }
  const slotStart = new Date(slotStartValue);
  const parts = localParts(zone, slotStart);
  if ((parts.minute !== 0 && parts.minute !== 30) || parts.second !== 0) {
    throw validation({ slotStart: FIELD_ERRORS.slotStart });
  }
  const limitKw = Number(pontoon.limit_kw);
  const kw = Number(yacht.shore_power_kw);
  const bookingId = await transaction(async (client) => {
    await lockKey(
      client,
      'slot',
      actor.workspaceId,
      marina.id,
      pontoon.code,
      slotStart.toISOString(),
    );
    if (ctx.now.getTime() >= slotStart.getTime()) throw conflict('slot_past');
    const onSlot = await txRows<ShorePowerBookingRow & { yacht_name: string }>(
      client,
      `SELECT s.*, y.name AS yacht_name FROM shore_power_bookings s JOIN yachts y ON y.id = s.yacht_id
        WHERE s.workspace_id = $1 AND s.marina_id = $2 AND s.pontoon_code = $3 AND s.slot_start = $4
        ORDER BY s.booked_at`,
      [actor.workspaceId, marina.id, pontoon.code, slotStart],
    );
    if (onSlot.some((booking) => booking.yacht_id === yacht.id)) throw conflict('already_booked');
    const bookedKw = onSlot.reduce((total, booking) => total + Number(booking.kw), 0);
    if (limitKw - bookedKw < kw) {
      const latest = onSlot[onSlot.length - 1];
      throw conflict('slot_taken', {
        takenBy: `${latest.booked_by_name} for ${latest.yacht_name}`,
        takenAt: toInstantString(latest.booked_at),
      });
    }
    const id = randomUUID();
    await client.query(
      `INSERT INTO shore_power_bookings (id, workspace_id, yacht_id, marina_id, pontoon_code,
          slot_start, slot_end, kw, booked_by_member_id, booked_by_name, booked_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        actor.workspaceId,
        yacht.id,
        marina.id,
        pontoon.code,
        slotStart,
        new Date(slotStart.getTime() + SLOT_MS),
        yacht.shore_power_kw,
        actor.id,
        actor.name,
        ctx.now,
      ],
    );
    return id;
  });
  const booking = (await queryOne<ShorePowerBookingRow>(
    'SELECT * FROM shore_power_bookings WHERE id = $1',
    [bookingId],
  )) as ShorePowerBookingRow;
  return json(201, {
    booking: {
      id: booking.id,
      yachtSlug: yacht.slug,
      marinaId: booking.marina_id,
      pontoonCode: booking.pontoon_code,
      slotStart: toInstantString(booking.slot_start),
      slotEnd: toInstantString(booking.slot_end),
      kw: Number(booking.kw),
      bookedBy: booking.booked_by_name,
      bookedAt: toInstantString(booking.booked_at),
    },
  });
}

export function registerMarinaRoutes(router: Router): void {
  router.add('/api/w/:ws/marinas', { GET: listMarinas });
  router.add('/api/w/:ws/marinas/:marinaId/berths', { GET: searchBerths });
  router.add('/api/w/:ws/marinas/:marinaId/tariffs', { POST: addTariff });
  router.add('/api/w/:ws/marinas/:marinaId/pontoons/:code/slots', { GET: readSlots });
  router.add('/api/w/:ws/berth-bookings', { POST: bookBerth });
  router.add('/api/w/:ws/berth-bookings/:bookingId', { GET: readBooking });
  router.add('/api/w/:ws/exchange-tables', { GET: listExchangeTables, POST: addExchangeTable });
  router.add('/api/w/:ws/shore-power-bookings', { POST: bookShorePower });
}

import type { App } from './api.js';
import type { Ctx } from './http.js';
import { ApiError, fieldErrors, notFound, stateConflict, tooLarge, unsupportedMediaType, serviceUnavailable } from './errors.js';
import { isRecord, str, whole, bool, lengthOf } from './validate.js';
import * as base from '../shared/bases.js';
import type { Base } from '../shared/bases.js';
import { Decimal, roundHalfUp } from '../shared/decimal.js';
import { parseMultipart, readRawBody } from './http.js';
import { putObject, StorageUnavailable } from './minio.js';
import type { YachtDb } from './endpoints-holds.js';
import { getYacht } from './endpoints-holds.js';
import { newId } from './endpoints-holds.js';

const LOG_LIMIT = 2000000;
const LOG_ENVELOPE = 100000;

// ---------------- marinas, berths ----------------

interface MarinaDb {
  id: string;
  workspace_slug: string;
  name: string;
  base: Base;
}

export async function marinasList(app: App, ctx: Ctx, ws: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director', 'charter_manager', 'finance_lead', 'captain']);
  const marinas = await app.pool.query<MarinaDb>('SELECT * FROM marinas WHERE workspace_slug = $1 ORDER BY id', [ws]);
  const out = [];
  for (const m of marinas.rows) {
    const berths = await app.pool.query('SELECT code, length_m, width_m, depth_m FROM berths WHERE marina_id = $1 ORDER BY code', [m.id]);
    const pontoons = await app.pool.query('SELECT code, limit_kw FROM pontoons WHERE marina_id = $1 ORDER BY code', [m.id]);
    const tariffs = await app.pool.query('SELECT id, effective_date, rate_per_metre_minor FROM marina_tariffs WHERE marina_id = $1 ORDER BY effective_date', [m.id]);
    out.push({
      id: m.id,
      name: m.name,
      base: m.base,
      today: base.localDate(m.base, { ms: Date.now() }),
      berths: berths.rows.map((b) => ({ code: b.code, lengthM: Number(b.length_m), widthM: Number(b.width_m), depthM: Number(b.depth_m) })),
      pontoons: pontoons.rows.map((p) => ({ code: p.code, limitKw: p.limit_kw })),
      tariffs: tariffs.rows.map((t) => ({ id: t.id, effectiveDate: t.effective_date, ratePerMetreMinor: Number(t.rate_per_metre_minor), currency: 'EUR' })),
    });
  }
  return { marinas: out };
}

/** Berth fit: compare in whole centimetres. */
export interface Metres { lengthM: string; beamM: string; draftM: string }

export function berthFits(yacht: Metres, berth: Metres): boolean {
  const cm = (m: string) => new Decimal(m).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const draftPlus = new Decimal(yacht.draftM).plus('0.30');
  return cm(yacht.lengthM).lte(cm(berth.lengthM)) && cm(yacht.beamM).lte(cm(berth.beamM)) && cm(draftPlus.toFixed(2)).lte(cm(berth.draftM));
}

export function yachtMetres(y: YachtDb): Metres {
  return { lengthM: y.length_m, beamM: y.beam_m, draftM: y.draft_m };
}

export async function berthsSearch(app: App, ctx: Ctx, ws: string, marinaId: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director', 'charter_manager', 'finance_lead', 'captain']);
  const marina = await getMarina(app, ws, marinaId);
  const yachtSlug = ctx.query.get('yachtSlug') ?? '';
  const arrivalDate = ctx.query.get('arrivalDate') ?? '';
  const nights = whole(ctx.query.get('nights')) ?? null;
  const errors: Record<string, string> = {};
  const yachtMaybe = await getYachtOrNull(app, ws, yachtSlug);
  if (!yachtMaybe) errors.yachtSlug = 'Choose one of the listed options.';
  if (!base.parseYmd(arrivalDate)) errors.arrivalDate = 'Enter a date as YYYY-MM-DD.';
  if (arrivalDate && base.parseYmd(arrivalDate) && arrivalDate < base.localDate(marina.base, { ms: Date.now() })) errors.arrivalDate = 'Choose today or a later date.';
  const nightsVal = nights === null || nights < 1 || nights > 14 ? null : nights;
  if (nightsVal === null) errors.nights = 'Enter a whole number from 1 to 14.';
  if (Object.keys(errors).length > 0) throw fieldErrors(errors);
  const yacht = yachtMaybe!;
  const nightOut: Array<{ date: string; tariffId: string; ratePerMetreMinor: number; feeMinor: number }> = [];
  const nightsCount = nightsVal ?? 0;
  for (let i = 0; i < nightsCount; i++) {
    const date = base.addDays(arrivalDate, i);
    const tariff = await tariffForNight(app, marina.id, date);
    nightOut.push({ date, tariffId: tariff.id, ratePerMetreMinor: Number(tariff.rate), feeMinor: feeForNight(tariff.rate, yacht.length_m) });
  }
  const berths = await app.pool.query('SELECT code, length_m, width_m, depth_m FROM berths WHERE marina_id = $1 ORDER BY code', [marinaId]);
  const bookedDates = new Set<string>();
  const bookingRows = await app.pool.query('SELECT berth_code, nights FROM berth_bookings WHERE marina_id = $1', [marinaId]);
  for (const r of bookingRows.rows) for (const n of r.nights) bookedDates.add(`${r.berth_code}|${n.date}`);
  const out = [];
  for (const b of berths.rows) {
    const fits = berthFits(yachtMetres(yacht), { lengthM: b.length_m, beamM: b.width_m, draftM: b.depth_m });
    const available = !nightOut.some((n) => bookedDates.has(`${b.code}|${n.date}`));
    out.push({
      code: b.code,
      lengthM: Number(b.length_m),
      widthM: Number(b.width_m),
      depthM: Number(b.depth_m),
      fits,
      available,
      nights: nightOut,
      totalMinor: fits ? nightOut.reduce((s, n) => s + n.feeMinor, 0) : null,
      currency: 'EUR',
    });
  }
  return { berths: out };
}

function feeForNight(ratePerMetreMinor: string, lengthM: string): number {
  return Number(roundHalfUp(new Decimal(ratePerMetreMinor).times(new Decimal(lengthM)), 0).toFixed(0));
}

async function tariffForNight(app: App, marinaId: string, date: string): Promise<{ id: string; rate: string }> {
  const rows = await app.pool.query<{ id: string; rate_per_metre_minor: string }>('SELECT id, rate_per_metre_minor FROM marina_tariffs WHERE marina_id = $1 AND effective_date <= $2 ORDER BY effective_date DESC LIMIT 1', [marinaId, date]);
  return rows.rows[0] ? { id: rows.rows[0].id, rate: String(rows.rows[0].rate_per_metre_minor) } : null!;
}

export async function berthBook(app: App, ctx: Ctx, ws: string): Promise<unknown> {
  const member = await app.requireStaff(ctx, ws, ['fleet_director', 'captain']);
  const body = await app.readJsonBody(ctx);
  const yachtSlug = str(body.yachtSlug) ?? '';
  const marinaId = str(body.marinaId) ?? '';
  const berthCode = str(body.berthCode) ?? '';
  const arrivalDate = str(body.arrivalDate) ?? '';
  const nights = whole(body.nights);
  const errors: Record<string, string> = {};
  const marina = await getMarinaOrNull(app, ws, marinaId);
  if (!marina) errors.marinaId = 'Choose one of the listed options.';
  const yacht = await getYachtOrNull(app, ws, yachtSlug);
  if (!yacht) errors.yachtSlug = 'Choose one of the listed options.';
  if (!base.parseYmd(arrivalDate)) errors.arrivalDate = 'Enter a date as YYYY-MM-DD.';
  if (marina && arrivalDate && base.parseYmd(arrivalDate) && arrivalDate < base.localDate(marina.base, { ms: Date.now() })) errors.arrivalDate = 'Choose today or a later date.';
  if (nights === null || nights < 1 || nights > 14) errors.nights = 'Enter a whole number from 1 to 14.';
  if (Object.keys(errors).length > 0) throw fieldErrors(errors);
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the berth row to serialize bookings.
    const berthRow = await client.query('SELECT * FROM berths WHERE marina_id = $1 AND code = $2 FOR UPDATE', [marinaId, berthCode]);
    const berth = berthRow.rows[0];
    if (!berth) {
      await client.query('ROLLBACK');
      throw fieldErrors({ berthCode: 'Choose one of the listed options.' });
    }
    if (!berthFits(yachtMetres(yacht!), { lengthM: berth.length_m, beamM: berth.width_m, draftM: berth.depth_m })) {
      await client.query('ROLLBACK');
      throw stateConflict('does_not_fit');
    }
    const nightDates: string[] = [];
    for (let i = 0; i < nights!; i++) nightDates.push(base.addDays(arrivalDate, i));
    const booked = await client.query('SELECT id, nights FROM berth_bookings WHERE marina_id = $1 AND berth_code = $2 FOR UPDATE', [marinaId, berthCode]);
    const taken = new Set<string>();
    for (const r of booked.rows) for (const n of (r.nights as Array<{ date: string }>)) taken.add(n.date);
    if (nightDates.some((d) => taken.has(d))) {
      await client.query('ROLLBACK');
      throw stateConflict('berth_taken');
    }
    const nightOut = [];
    for (const date of nightDates) {
      const tariff = await tariffForNightWithClient(client, marinaId, date);
      const feeMinor = feeForNight(tariff.rate, yacht!.length_m);
      nightOut.push({ date, tariffId: tariff.id, ratePerMetreMinor: Number(tariff.rate), feeMinor });
    }
    const totalMinor = nightOut.reduce((s, n) => s + n.feeMinor, 0);
    const id = newId('berthbooking');
    await client.query(
      `INSERT INTO berth_bookings (id, workspace_slug, yacht_slug, marina_id, berth_code, arrival_date, departure_date, nights, yacht_length_m, total_minor, currency, booked_by, booked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'EUR',$11,now())`,
      [id, ws, yachtSlug, marinaId, berthCode, arrivalDate, base.addDays(arrivalDate, nights!), JSON.stringify(nightOut), yacht!.length_m, totalMinor, member.id],
    );
    await client.query('COMMIT');
    const fresh = await app.pool.query('SELECT * FROM berth_bookings WHERE id = $1', [id]);
    return { booking: bookingToApi(fresh.rows[0]) };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* nothing */ }
    throw e;
  } finally {
    client.release();
  }
}

async function tariffForNightWithClient(client: import('pg').PoolClient, marinaId: string, date: string): Promise<{ id: string; rate: string }> {
  const rows = await client.query<{ id: string; rate_per_metre_minor: string }>('SELECT id, rate_per_metre_minor FROM marina_tariffs WHERE marina_id = $1 AND effective_date <= $2 ORDER BY effective_date DESC LIMIT 1', [marinaId, date]);
  return { id: rows.rows[0].id, rate: String(rows.rows[0].rate_per_metre_minor) };
}

function bookingToApi(row: any): unknown {
  return {
    id: row.id,
    yachtSlug: row.yacht_slug,
    marinaId: row.marina_id,
    berthCode: row.berth_code,
    arrivalDate: row.arrival_date,
    departureDate: row.departure_date,
    nights: row.nights,
    totalMinor: Number(row.total_minor),
    currency: row.currency,
    bookedBy: row.booked_by,
    bookedAt: base.instToIso({ ms: row.booked_at.getTime() }),
  };
}

export async function berthBookingGet(app: App, ctx: Ctx, ws: string, id: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director', 'charter_manager', 'finance_lead', 'captain']);
  const rows = await app.pool.query('SELECT * FROM berth_bookings WHERE id = $1 AND workspace_slug = $2', [id, ws]);
  if (!rows.rows[0]) throw notFound();
  return { booking: bookingToApi(rows.rows[0]) };
}

async function getMarina(app: App, ws: string, marinaId: string): Promise<MarinaDb> {
  const rows = await app.pool.query<MarinaDb>('SELECT * FROM marinas WHERE id = $1 AND workspace_slug = $2', [marinaId, ws]);
  if (!rows.rows[0]) throw notFound();
  return rows.rows[0];
}

async function getMarinaOrNull(app: App, ws: string, marinaId: string): Promise<MarinaDb | null> {
  const rows = await app.pool.query<MarinaDb>('SELECT * FROM marinas WHERE id = $1 AND workspace_slug = $2', [marinaId, ws]);
  return rows.rows[0] ?? null;
}

async function getYachtOrNull(app: App, ws: string, yachtSlug: string): Promise<YachtDb | null> {
  const rows = await app.pool.query<YachtDb>('SELECT * FROM yachts WHERE slug = $1 AND workspace_slug = $2', [yachtSlug, ws]);
  return rows.rows[0] ?? null;
}

// ---------------- tariffs and exchange tables ----------------

export async function tariffAdd(app: App, ctx: Ctx, ws: string, marinaId: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director', 'finance_lead']);
  const marina = await getMarina(app, ws, marinaId);
  const body = await app.readJsonBody(ctx);
  const effectiveDate = str(body.effectiveDate) ?? '';
  const rate = whole(body.ratePerMetreMinor);
  const errors: Record<string, string> = {};
  if (!base.parseYmd(effectiveDate)) errors.effectiveDate = 'Enter a date as YYYY-MM-DD.';
  const marinaToday = base.localDate(marina.base, { ms: Date.now() });
  if (base.parseYmd(effectiveDate) && effectiveDate <= marinaToday) errors.effectiveDate = 'Choose a date after today.';
  if (rate === null || rate < 1 || rate > 100000) errors.ratePerMetreMinor = 'Enter an amount from EUR 0.01 to EUR 1,000.00.';
  if (Object.keys(errors).length > 0) throw fieldErrors(errors);
  const existing = await app.pool.query('SELECT 1 FROM marina_tariffs WHERE marina_id = $1 AND effective_date = $2', [marinaId, effectiveDate]);
  if (existing.rowCount && existing.rowCount > 0) throw stateConflict('date_exists');
  const id = newId('tariff');
  await app.pool.query('INSERT INTO marina_tariffs (id, marina_id, workspace_slug, effective_date, rate_per_metre_minor) VALUES ($1,$2,$3,$4,$5)', [id, marinaId, ws, effectiveDate, rate]);
  return { tariff: { id, effectiveDate, ratePerMetreMinor: rate, currency: 'EUR' } };
}

export async function exchangeTablesList(app: App, ctx: Ctx, ws: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director', 'charter_manager', 'finance_lead', 'captain']);
  const rows = await app.pool.query('SELECT id, effective_date, gbp, usd FROM exchange_tables WHERE workspace_slug = $1 ORDER BY effective_date DESC', [ws]);
  return { exchangeTables: rows.rows.map((r) => ({ id: r.id, effectiveDate: r.effective_date, rates: { GBP: r.gbp, USD: r.usd } })) };
}

export async function exchangeTableAdd(app: App, ctx: Ctx, ws: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director', 'finance_lead']);
  const body = await app.readJsonBody(ctx);
  const effectiveDate = str(body.effectiveDate) ?? '';
  const rates = isRecord(body.rates) ? body.rates : {};
  const gbp = str(rates.GBP) ?? '';
  const usd = str(rates.USD) ?? '';
  const errors: Record<string, string> = {};
  if (!base.parseYmd(effectiveDate)) errors.effectiveDate = 'Enter a date as YYYY-MM-DD.';
  const splitToday = base.localDate('split', { ms: Date.now() });
  if (base.parseYmd(effectiveDate) && effectiveDate <= splitToday) errors.effectiveDate = 'Choose a date after today.';
  const rateRe = /^(0\.\d{1,6}|[1-9]\d*(\.\d{1,6})?)$/;
  if (!rateRe.test(gbp)) errors['rates.GBP'] = 'Enter a rate above 0 with at most six decimals.';
  if (!rateRe.test(usd)) errors['rates.USD'] = 'Enter a rate above 0 with at most six decimals.';
  if (Object.keys(errors).length > 0) throw fieldErrors(errors);
  const existing = await app.pool.query('SELECT 1 FROM exchange_tables WHERE workspace_slug = $1 AND effective_date = $2', [ws, effectiveDate]);
  if (existing.rowCount && existing.rowCount > 0) throw stateConflict('date_exists');
  const id = newId('ext');
  await app.pool.query('INSERT INTO exchange_tables (id, workspace_slug, effective_date, gbp, usd) VALUES ($1,$2,$3,$4,$5)', [id, ws, effectiveDate, gbp, usd]);
  return { exchangeTable: { id, effectiveDate, rates: { GBP: gbp, USD: usd } } };
}

// ---------------- shore power ----------------

export async function slotsList(app: App, ctx: Ctx, ws: string, marinaId: string, pontoonCode: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director', 'charter_manager', 'finance_lead', 'captain']);
  const marina = await getMarina(app, ws, marinaId);
  const pontoon = await app.pool.query('SELECT * FROM pontoons WHERE marina_id = $1 AND code = $2', [marinaId, pontoonCode]);
  if (!pontoon.rows[0]) throw notFound();
  const date = ctx.query.get('date') ?? '';
  if (!base.parseYmd(date)) throw fieldErrors({ date: 'Enter a date as YYYY-MM-DD.' });
  const limitKw = pontoon.rows[0].limit_kw;
  const now = Date.now();
  const slots = [];
  for (let i = 0; i < 48; i++) {
    const wall = base.wallToUtc(marina.base, ...ymd(date, i * 30));
    if (wall.utcMs === null) continue;
    const startMs = wall.utcMs;
    const endMs = startMs + 1800000;
    const bookings = await app.pool.query(
      'SELECT spb.yacht_slug, spb.yacht_name, spb.kw, spb.booked_by, m.name AS member_name FROM shore_power_bookings spb JOIN members m ON m.id = spb.booked_by WHERE spb.marina_id = $1 AND spb.pontoon_code = $2 AND spb.slot_start = $3',
      [marinaId, pontoonCode, new Date(startMs)],
    );
    const bookedKw = bookings.rows.reduce((n, r) => n + r.kw, 0);
    const status = startMs <= now ? 'past' : bookedKw + 22 > limitKw ? 'full' : 'open';
    slots.push({
      startsAt: base.instToIso({ ms: startMs }),
      endsAt: base.instToIso({ ms: endMs }),
      status,
      bookedKw,
      bookings: bookings.rows.map((r) => ({ yachtSlug: r.yacht_slug, yachtName: r.yacht_name })),
    });
  }
  return { date, base: marina.base, limitKw, slots };
}

function ymd(date: string, minutes: number): [number, number, number, number, number] {
  const d = base.parseYmd(date)!;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return [d.year, d.month, d.day, hour, minute];
}

export async function slotBook(app: App, ctx: Ctx, ws: string): Promise<unknown> {
  const member = await app.requireStaff(ctx, ws, ['fleet_director', 'captain']);
  const body = await app.readJsonBody(ctx);
  const yachtSlug = str(body.yachtSlug) ?? '';
  const marinaId = str(body.marinaId) ?? '';
  const pontoonCode = str(body.pontoonCode) ?? '';
  const slotStart = str(body.slotStart) ?? '';
  const yachtMaybe = await getYachtOrNull(app, ws, yachtSlug);
  const marinaMaybe = await getMarinaOrNull(app, ws, marinaId);
  const errors: Record<string, string> = {};
  if (!yachtMaybe) errors.yachtSlug = 'Choose one of the listed options.';
  if (!marinaMaybe) errors.marinaId = 'Choose one of the listed options.';
  const start = base.isoToInst(slotStart);
  if (!start) errors.slotStart = 'Choose a slot that starts on the hour or half hour.';
  if (Object.keys(errors).length > 0) throw fieldErrors(errors);
  const marina = marinaMaybe!;
  const yacht = yachtMaybe!;
  // Boundary check: the slot must start on a local hour or half hour.
  const local = base.localParts(marina.base, start!);
  if (local.minute !== 0 && local.minute !== 30) throw fieldErrors({ slotStart: 'Choose a slot that starts on the hour or half hour.' });
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    // Lock pontoon row to serialize claims.
    await client.query('SELECT * FROM pontoons WHERE marina_id = $1 AND code = $2 FOR UPDATE', [marinaId, pontoonCode]);
    const pontoon = await client.query('SELECT * FROM pontoons WHERE marina_id = $1 AND code = $2', [marinaId, pontoonCode]);
    if (!pontoon.rows[0]) {
      await client.query('ROLLBACK');
      throw fieldErrors({ pontoonCode: 'Choose one of the listed options.' });
    }
    if (start!.ms <= Date.now()) {
      await client.query('ROLLBACK');
      throw stateConflict('slot_past');
    }
    const mine = await client.query('SELECT 1 FROM shore_power_bookings WHERE yacht_slug = $1 AND marina_id = $2 AND pontoon_code = $3 AND slot_start = $4', [yachtSlug, marinaId, pontoonCode, new Date(start!.ms)]);
    if (mine.rowCount && mine.rowCount > 0) {
      await client.query('ROLLBACK');
      throw stateConflict('already_booked');
    }
    const others = await client.query('SELECT spb.*, m.name AS member_name FROM shore_power_bookings spb JOIN members m ON m.id = spb.booked_by WHERE spb.marina_id = $1 AND spb.pontoon_code = $2 AND spb.slot_start = $3 ORDER BY spb.booked_at', [marinaId, pontoonCode, new Date(start!.ms)]);
    const bookedKw = others.rows.reduce((n, r) => n + r.kw, 0);
    const kw = yacht.shore_power_kw;
    if (bookedKw + kw > pontoon.rows[0].limit_kw) {
      const latest = others.rows[others.rows.length - 1];
      await client.query('ROLLBACK');
      throw stateConflict('slot_taken', { takenBy: `${latest.member_name} for ${latest.yacht_name}`, takenAt: base.instToIso({ ms: latest.booked_at.getTime() }) });
    }
    const id = newId('shorepower');
    await client.query(
      `INSERT INTO shore_power_bookings (id, workspace_slug, yacht_slug, yacht_name, marina_id, pontoon_code, slot_start, slot_end, kw, booked_by, booked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`,
      [id, ws, yachtSlug, yacht.name, marinaId, pontoonCode, new Date(start!.ms), new Date(start!.ms + 1800000), kw, member.id],
    );
    await client.query('COMMIT');
    const fresh = await app.pool.query('SELECT * FROM shore_power_bookings WHERE id = $1', [id]);
    const b = fresh.rows[0];
    return {
      booking: {
        id: b.id,
        yachtSlug: b.yacht_slug,
        marinaId: b.marina_id,
        pontoonCode: b.pontoon_code,
        slotStart: base.instToIso({ ms: b.slot_start.getTime() }),
        slotEnd: base.instToIso({ ms: b.slot_end.getTime() }),
        kw: b.kw,
        bookedBy: b.booked_by,
        bookedAt: base.instToIso({ ms: b.booked_at.getTime() }),
      },
    };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* nothing */ }
    throw e;
  } finally {
    client.release();
  }
}

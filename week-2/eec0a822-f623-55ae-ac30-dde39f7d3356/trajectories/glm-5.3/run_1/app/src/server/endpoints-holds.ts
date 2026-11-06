import { randomBytes } from 'node:crypto';
import type { App } from './api.js';
import type { Ctx } from './http.js';
import { ApiError, fieldErrors, notFound, stateConflict, yachtWithdrawn, serviceUnavailable } from './errors.js';
import { isRecord, str, whole, bool, lengthOf } from './validate.js';
import { holdQuery, holdToApi, weeksWindow, type HoldRow } from './holds.js';
import { convertMinor, Decimal, roundHalfUp } from '../shared/decimal.js';
import { createAccountWithInvoice, voidInvoice, BillingUnavailable } from './killbill.js';
import { sendMail, MailUnavailable } from './mail.js';
import { hashPassword, verifyPassword } from './schema.js';
import * as base from '../shared/bases.js';
import { fmtDateOnly, fmtMoney, localDate } from '../shared/bases.js';
import type { Base } from '../shared/bases.js';
import type { CharterLine, Hold, Season } from './types.js';

const VAT_RATE: Record<Base, string> = { split: '13', lavrio: '12' };
const CURRENCIES = ['EUR', 'GBP', 'USD'] as const;

export function newId(prefix: string): string {
  return `${prefix}-${randomBytes(10).toString('base64url')}`;
}

// ---------------- yachts ----------------

export interface YachtDb {
  slug: string;
  workspace_slug: string;
  name: string;
  base: Base;
  status: 'on_sale' | 'withdrawn';
  cabins: number;
  length_m: string;
  beam_m: string;
  draft_m: string;
  battery_kwh: string;
  hotel_kw: string;
  solar_kw: string;
  drag_kw_per_kn_cubed: string;
  shore_power_kw: number;
  low_minor: string;
  shoulder_minor: string;
  high_minor: string;
}

export async function getYacht(app: App, ws: string, slug: string, allowWithdrawn: boolean): Promise<YachtDb> {
  const rows = await app.pool.query<YachtDb>('SELECT * FROM yachts WHERE slug = $1 AND workspace_slug = $2', [slug, ws]);
  const yacht = rows.rows[0];
  if (!yacht) throw notFound();
  if (yacht.status === 'withdrawn' && !allowWithdrawn) throw yachtWithdrawn();
  return yacht;
}

export function seasonOf(weekStart: string): Season {
  const month = Number(weekStart.slice(5, 7));
  if (month === 7 || month === 8) return 'high';
  if (month === 5 || month === 6 || month === 9) return 'shoulder';
  return 'low';
}

export function rateFor(yacht: YachtDb, season: Season): string {
  return season === 'high' ? yacht.high_minor : season === 'shoulder' ? yacht.shoulder_minor : yacht.low_minor;
}

export async function weeksFor(app: App, yacht: YachtDb): Promise<Array<{ weekStart: string; status: 'free' | 'held' | 'booked'; season: Season; weeklyRateMinor: number; liveHoldId: string | null; waitingCount: number }>> {
  const splitToday = base.localDate('split', { ms: Date.now() });
  const weeks = weeksWindow('split', splitToday);
  const charters = await app.pool.query<{ week_start: string }>('SELECT week_start FROM charters WHERE yacht_slug = $1 AND week_start = ANY($2)', [yacht.slug, weeks]);
  const liveHolds = await app.pool.query<HoldRow>(holdQuery("WHERE yacht_slug = $1 AND status = 'live' AND week_start = ANY($2)"), [yacht.slug, weeks]);
  const waiting = await app.pool.query<{ week_start: string; n: number }>("SELECT week_start, count(*)::int AS n FROM holds WHERE yacht_slug = $1 AND status = 'waiting' AND week_start = ANY($2) GROUP BY week_start", [yacht.slug, weeks]);
  const bookedSet = new Set(charters.rows.map((r) => r.week_start));
  const liveMap = new Map(liveHolds.rows.map((r) => [r.week_start, r]));
  const waitingMap = new Map(waiting.rows.map((r) => [r.week_start, r.n]));
  const result: Array<{ weekStart: string; status: 'free' | 'held' | 'booked'; season: Season; weeklyRateMinor: number; liveHoldId: string | null; waitingCount: number }> = [];
  for (const weekStart of weeks) {
    const season = seasonOf(weekStart);
    const live = liveMap.get(weekStart);
    const waitingCount = waitingMap.get(weekStart) ?? 0;
    result.push({
      weekStart,
      status: bookedSet.has(weekStart) ? 'booked' : live || waitingCount > 0 ? 'held' : 'free',
      season,
      weeklyRateMinor: Number(rateFor(yacht, season)),
      liveHoldId: live?.id ?? null,
      waitingCount,
    });
  }
  return result;
}

export async function yachtsList(app: App, ctx: Ctx, ws: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director', 'charter_manager', 'finance_lead', 'captain', 'crew_member']);
  const rows = await app.pool.query<YachtDb>('SELECT * FROM yachts WHERE workspace_slug = $1 ORDER BY name', [ws]);
  const out = [];
  for (const y of rows.rows) {
    out.push(yachtProfile(await crewFor(app, y)));
  }
  return { yachts: out };
}

export interface CrewRow { id: string; name: string; position: string }

export async function crewFor(app: App, yacht: YachtDb): Promise<YachtDb & { crew: CrewRow[] }> {
  const crew = await app.pool.query<CrewRow>('SELECT id, name, position FROM crew WHERE yacht_slug = $1 ORDER BY sort_order', [yacht.slug]);
  return { ...yacht, crew: crew.rows };
}

export function yachtProfile(y: YachtDb & { crew: CrewRow[] }): unknown {
  return {
    slug: y.slug,
    name: y.name,
    base: y.base,
    status: y.status,
    cabins: y.cabins,
    lengthM: Number(y.length_m),
    beamM: Number(y.beam_m),
    draftM: Number(y.draft_m),
    batteryKwh: Number(y.battery_kwh),
    hotelKw: Number(y.hotel_kw),
    solarKw: Number(y.solar_kw),
    dragKwPerKnCubed: Number(y.drag_kw_per_kn_cubed),
    shorePowerKw: y.shore_power_kw,
    rates: { lowMinor: Number(y.low_minor), shoulderMinor: Number(y.shoulder_minor), highMinor: Number(y.high_minor) },
    currency: 'EUR',
    crew: y.crew,
  };
}

export async function yachtGet(app: App, ctx: Ctx, ws: string, slug: string): Promise<unknown> {
  const member = await app.requireStaff(ctx, ws, ['fleet_director', 'charter_manager', 'finance_lead', 'captain', 'crew_member']);
  const yacht = await getYacht(app, ws, slug, true);
  if (member.role === 'crew_member' && member.yacht_slug !== slug) throw notFound();
  return { yacht: yachtProfile(await crewFor(app, yacht)) };
}

export async function yachtWeeks(app: App, ctx: Ctx, ws: string, slug: string): Promise<unknown> {
  const member = await app.requireStaff(ctx, ws, ['fleet_director', 'charter_manager', 'finance_lead', 'captain', 'crew_member']);
  const yacht = await getYacht(app, ws, slug, true);
  if (member.role === 'crew_member' && member.yacht_slug !== slug) throw notFound();
  const weeks = await weeksFor(app, yacht);
  return {
    weeks: weeks.map((w) => ({
      weekStart: w.weekStart,
      weekEnd: base.addDays(w.weekStart, 7),
      status: w.status,
      season: w.season,
      weeklyRateMinor: w.weeklyRateMinor,
      currency: 'EUR',
      liveHoldId: w.liveHoldId,
      waitingCount: w.waitingCount,
    })),
  };
}

export async function yachtPatch(app: App, ctx: Ctx, ws: string, slug: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director']);
  const yacht = await getYacht(app, ws, slug, true);
  const body = await app.readJsonBody(ctx);
  const errors: Record<string, string> = {};
  const name = body.name !== undefined ? str(body.name) : undefined;
  const cabins = body.cabins !== undefined ? whole(body.cabins) : undefined;
  const lengthM = body.lengthM !== undefined ? str(body.lengthM) : undefined;
  const beamM = body.beamM !== undefined ? str(body.beamM) : undefined;
  const draftM = body.draftM !== undefined ? str(body.draftM) : undefined;
  const rates = isRecord(body.rates) ? body.rates : body.rates !== undefined ? {} : undefined;
  if (name !== undefined) {
    if (name === null || lengthOf(name) < 1 || lengthOf(name) > 80) errors.name = name === null || lengthOf(name) < 1 ? 'This field is required.' : 'Use at most 80 characters.';
  }
  if (cabins !== undefined) {
    if (cabins === null || cabins < 2 || cabins > 6) errors.cabins = 'Enter a whole number from 2 to 6.';
  }
  const checkMetre = (v: string | undefined | null, key: string, min: string, max: string): string | undefined => {
    if (v === undefined) return undefined;
    if (v === null) return 'This field is required.';
    if (!/^\d{1,2}(\.\d{1,2})?$/.test(v)) return 'Use at most two decimals.';
    if (new Decimal(v).lt(min) || new Decimal(v).gt(max)) return `Enter a number from ${min} to ${max}.`;
    return undefined;
  };
  if (lengthM !== undefined) errors.lengthM = checkMetre(lengthM, 'lengthM', '8.00', '40.00') ?? errors.lengthM;
  if (beamM !== undefined) errors.beamM = checkMetre(beamM, 'beamM', '3.00', '15.00') ?? errors.beamM;
  if (draftM !== undefined) errors.draftM = checkMetre(draftM, 'draftM', '0.50', '3.00') ?? errors.draftM;
  const newRates: Record<string, number | undefined> = {};
  if (rates) {
    for (const [key, field] of [['lowMinor', 'lowMinor'], ['shoulderMinor', 'shoulderMinor'], ['highMinor', 'highMinor']] as const) {
      const value = whole(rates[field]);
      if (value === undefined || value === null) {
        errors[`rates.${field}`] = 'Enter an amount from EUR 1,000.00 to EUR 1,000,000.00.';
      } else if (value < 100000 || value > 100000000) {
        errors[`rates.${field}`] = 'Enter an amount from EUR 1,000.00 to EUR 1,000,000.00.';
      } else {
        newRates[field] = value;
      }
    }
  }
  if (Object.keys(errors).length > 0) throw fieldErrors(errors);
  const updates: string[] = [];
  const params: unknown[] = [];
  const add = (col: string, value: unknown) => {
    params.push(value);
    updates.push(`${col} = $${params.length}`);
  };
  if (name !== undefined) add('name', name);
  if (cabins !== undefined) add('cabins', cabins);
  if (lengthM !== undefined) add('length_m', lengthM);
  if (beamM !== undefined) add('beam_m', beamM);
  if (draftM !== undefined) add('draft_m', draftM);
  if (rates) {
    if (newRates.lowMinor !== undefined) add('low_minor', newRates.lowMinor);
    if (newRates.shoulderMinor !== undefined) add('shoulder_minor', newRates.shoulderMinor);
    if (newRates.highMinor !== undefined) add('high_minor', newRates.highMinor);
  }
  if (updates.length > 0) {
    params.push(yacht.slug);
    await app.pool.query(`UPDATE yachts SET ${updates.join(', ')} WHERE slug = $${params.length}`, params);
  }
  const fresh = await getYacht(app, ws, slug, true);
  return { yacht: yachtProfile(await crewFor(app, fresh)) };
}

export async function yachtWithdraw(app: App, ctx: Ctx, ws: string, slug: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director']);
  const yacht = await getYacht(app, ws, slug, true);
  if (yacht.status === 'withdrawn') throw stateConflict('already_withdrawn');
  await app.pool.query("UPDATE yachts SET status = 'withdrawn' WHERE slug = $1", [slug]);
  const fresh = await getYacht(app, ws, slug, true);
  return { yacht: yachtProfile(await crewFor(app, fresh)) };
}

export async function yachtReturn(app: App, ctx: Ctx, ws: string, slug: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director']);
  const yacht = await getYacht(app, ws, slug, true);
  if (yacht.status === 'on_sale') throw stateConflict('already_on_sale');
  await app.pool.query("UPDATE yachts SET status = 'on_sale' WHERE slug = $1", [slug]);
  const fresh = await getYacht(app, ws, slug, true);
  return { yacht: yachtProfile(await crewFor(app, fresh)) };
}

// ---------------- holds ----------------

export async function holdsList(app: App, ctx: Ctx, ws: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director', 'charter_manager', 'finance_lead']);
  const yachtSlug = ctx.query.get('yachtSlug');
  const weekStart = ctx.query.get('weekStart');
  let sql = holdQuery('WHERE workspace_slug = $1');
  const params: unknown[] = [ws];
  if (yachtSlug) {
    params.push(yachtSlug);
    sql = holdQuery(`WHERE workspace_slug = $1 AND yacht_slug = $${params.length}`);
  }
  if (weekStart) {
    params.push(weekStart);
    sql = holdQuery(`WHERE workspace_slug = $1 AND week_start = $${params.length}`);
  }
  sql += ' ORDER BY placed_at DESC';
  const rows = await app.pool.query<HoldRow>(sql, params);
  return { holds: rows.rows.map(holdToApi) };
}

export async function holdGet(app: App, ctx: Ctx, ws: string, id: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director', 'charter_manager', 'finance_lead']);
  const rows = await app.pool.query<HoldRow>(holdQuery('WHERE id = $1 AND workspace_slug = $2'), [id, ws]);
  if (!rows.rows[0]) throw notFound();
  return { hold: holdToApi(rows.rows[0]) };
}

export interface PlaceHoldArgs {
  ws: string;
  yachtSlug: string;
  weekStart: string;
  clientName: string;
  queue: boolean;
  placedByKind: 'member' | 'broker';
  placedById: string | null;
  placedByName: string;
  brokerId: string | null;
}

export interface PlaceHoldResult {
  hold: HoldRow;
  created: boolean;
}

export interface Sql {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

export async function placeHold(app: App, args: PlaceHoldArgs): Promise<PlaceHoldResult> {
  const client = await app.pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    // Serialize on the yacht row.
    const yachtRes = await client.query<YachtDb>('SELECT * FROM yachts WHERE slug = $1 AND workspace_slug = $2 FOR UPDATE', [args.yachtSlug, args.ws]);
    const yacht = yachtRes.rows[0];
    if (!yacht) {
      await client.query('ROLLBACK');
      committed = true;
      throw notFound();
    }
    if (yacht.status === 'withdrawn') {
      await client.query('ROLLBACK');
      committed = true;
      throw yachtWithdrawn();
    }
    const splitToday = base.localDate('split', { ms: Date.now() });
    if (!base.isSaturday('split', args.weekStart)) {
      await client.query('ROLLBACK');
      committed = true;
      throw fieldErrors({ weekStart: 'Choose a Saturday.' });
    }
    if (args.weekStart <= splitToday) {
      await client.query('ROLLBACK');
      committed = true;
      throw fieldErrors({ weekStart: 'Choose a Saturday after today.' });
    }
    if (lengthOf(args.clientName) < 1 || lengthOf(args.clientName) > 80) {
      await client.query('ROLLBACK');
      committed = true;
      throw fieldErrors({ clientName: 'This field is required.' });
    }
    const charter = await client.query('SELECT 1 FROM charters WHERE yacht_slug = $1 AND week_start = $2', [args.yachtSlug, args.weekStart]);
    if (charter.rowCount && charter.rowCount > 0) {
      await client.query('ROLLBACK');
      committed = true;
      throw stateConflict('week_booked');
    }
    const live = await client.query<HoldRow>(holdQuery("WHERE yacht_slug = $1 AND week_start = $2 AND status = 'live'"), [args.yachtSlug, args.weekStart]);
    if (live.rows.length > 0) {
      if (!args.queue) {
        const row = live.rows[0];
        await client.query('ROLLBACK');
        committed = true;
        throw stateConflict('week_taken', { takenBy: row.placed_by_name, takenAt: base.instToIso({ ms: row.live_since!.getTime() }) });
      }
      // Queue at the end of the line.
      const waiting = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM holds WHERE yacht_slug = $1 AND week_start = $2 AND status = 'waiting'", [args.yachtSlug, args.weekStart]);
      const id = newId('hold');
      const season = seasonOf(args.weekStart);
      const rate = rateFor(yacht, season);
      const res = await client.query<HoldRow>(
        `INSERT INTO holds (id, workspace_slug, yacht_slug, week_start, week_end, client_name, placed_by_kind, placed_by_id, placed_by_name, broker_id, status, position, queue, placed_at, yacht_length_m, season, weekly_rate_minor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'waiting',$11,true,now(),$12,$13,$14) RETURNING *`,
        [id, args.ws, args.yachtSlug, args.weekStart, base.addDays(args.weekStart, 7), args.clientName, args.placedByKind, args.placedById, args.placedByName, args.brokerId, waiting.rows[0].n + 1, yacht.length_m, season, rate],
      );
      await client.query('COMMIT');
      committed = true;
      return { hold: res.rows[0], created: true };
    }
    const id = newId('hold');
    const season = seasonOf(args.weekStart);
    const rate = rateFor(yacht, season);
    const res = await client.query<HoldRow>(
      `INSERT INTO holds (id, workspace_slug, yacht_slug, week_start, week_end, client_name, placed_by_kind, placed_by_id, placed_by_name, broker_id, status, position, queue, placed_at, live_since, lapses_at, yacht_length_m, season, weekly_rate_minor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'live',NULL,$11,now(),now(),now() + make_interval(secs => $12),$13,$14,$15) RETURNING *`,
      [id, args.ws, args.yachtSlug, args.weekStart, base.addDays(args.weekStart, 7), args.clientName, args.placedByKind, args.placedById, args.placedByName, args.brokerId, args.queue, app.config.timers.holdSeconds, yacht.length_m, season, rate],
    );
    await client.query('COMMIT');
    committed = true;
    return { hold: res.rows[0], created: true };
  } finally {
    if (!committed) {
      try { await client.query('ROLLBACK'); } catch { /* connection already closed */ }
    }
    client.release();
  }
}

export async function holdsCreate(app: App, ctx: Ctx, ws: string): Promise<unknown> {
  const member = await app.requireStaff(ctx, ws, ['fleet_director', 'charter_manager']);
  const body = await app.readJsonBody(ctx);
  const yachtSlug = str(body.yachtSlug);
  const weekStart = str(body.weekStart);
  const clientName = str(body.clientName) ?? '';
  const queue = bool(body.queue);
  if (!yachtSlug) throw fieldErrors({ yachtSlug: 'Choose one of the listed options.' });
  const result = await placeHold(app, {
    ws,
    yachtSlug,
    weekStart: weekStart ?? '',
    clientName,
    queue,
    placedByKind: 'member',
    placedById: member.id,
    placedByName: member.name,
    brokerId: null,
  });
  return { hold: holdToApi(result.hold) };
}

export async function holdRelease(app: App, ctx: Ctx, ws: string, id: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director', 'charter_manager']);
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    const rows = await client.query<HoldRow>(holdQuery('WHERE id = $1 AND workspace_slug = $2 FOR UPDATE'), [id, ws]);
    const hold = rows.rows[0];
    if (!hold) {
      await client.query('ROLLBACK');
      throw notFound();
    }
    if (hold.status === 'lapsed') {
      await client.query('ROLLBACK');
      throw stateConflict('hold_lapsed', { lapsedAt: hold.lapses_at ? base.instToIso({ ms: hold.lapses_at.getTime() }) : null });
    }
    if (hold.status === 'live') {
      if (hold.lapses_at && hold.lapses_at.getTime() <= Date.now()) {
        await client.query("UPDATE holds SET status = 'lapsed' WHERE id = $1", [id]);
        await promoteAfter(app, client, hold.yacht_slug, hold.week_start);
        await client.query('COMMIT');
        throw stateConflict('hold_lapsed', { lapsedAt: base.instToIso({ ms: hold.lapses_at.getTime() }) });
      }
      await client.query("UPDATE holds SET status = 'released' WHERE id = $1", [id]);
      await promoteAfter(app, client, hold.yacht_slug, hold.week_start);
      const fresh = await client.query<HoldRow>(holdQuery('WHERE id = $1'), [id]);
      await client.query('COMMIT');
      return { hold: holdToApi(fresh.rows[0]) };
    }
    if (hold.status === 'waiting') {
      await client.query("UPDATE holds SET status = 'released', position = NULL WHERE id = $1", [id]);
      await client.query("UPDATE holds SET position = position - 1 WHERE yacht_slug = $1 AND week_start = $2 AND status = 'waiting' AND position > $3", [hold.yacht_slug, hold.week_start, hold.position]);
      const fresh = await client.query<HoldRow>(holdQuery('WHERE id = $1'), [id]);
      await client.query('COMMIT');
      return { hold: holdToApi(fresh.rows[0]) };
    }
    await client.query('ROLLBACK');
    throw stateConflict('hold_not_live', { status: hold.status });
  } finally {
    client.release();
  }
}

export async function promoteAfter(app: App, client: import('pg').PoolClient, yachtSlug: string, weekStart: string): Promise<void> {
  const next = await client.query<HoldRow>(
    holdQuery("WHERE yacht_slug = $1 AND week_start = $2 AND status = 'waiting' ORDER BY position ASC, placed_at ASC LIMIT 1 FOR UPDATE"),
    [yachtSlug, weekStart],
  );
  if (next.rows.length === 0) return;
  await client.query(
    "UPDATE holds SET status = 'live', live_since = now(), lapses_at = now() + make_interval(secs => $1), position = NULL WHERE id = $2",
    [app.config.timers.holdSeconds, next.rows[0].id],
  );
  await client.query(
    "UPDATE holds SET position = position - 1 WHERE yacht_slug = $1 AND week_start = $2 AND status = 'waiting' AND id <> $3",
    [yachtSlug, weekStart, next.rows[0].id],
  );
}

// ---------------- pricing ----------------

export interface QuoteInput {
  yacht: YachtDb;
  weekStart: string;
  currency: string;
  exchangeTableId: string | null;
  rate: string;
}

export function exchangeRateFor(currency: string, table: { gbp: string; usd: string } | null): string | null {
  if (currency === 'EUR') return '1';
  if (!table) return null;
  if (currency === 'GBP') return table.gbp;
  if (currency === 'USD') return table.usd;
  return null;
}

export async function exchangeTableFor(runner: Sql, ws: string, splitDate: string): Promise<{ id: string; gbp: string; usd: string } | null> {
  const rows = await (runner as Sql).query<{ id: string; gbp: string; usd: string }>(
    'SELECT id, gbp, usd FROM exchange_tables WHERE workspace_slug = $1 AND effective_date <= $2 ORDER BY effective_date DESC LIMIT 1',
    [ws, splitDate],
  );
  return rows.rows[0] ?? null;
}

export interface PriceArgs {
  yachtName: string;
  weekStart: string;
  rateMinor: string;
  base: Base;
  currency: string;
  exchangeTableId: string | null;
  rate: string;
}

export function priceCharter(args: PriceArgs): { lines: CharterLine[]; totalEurMinor: number; totalMinor: number } {
  const feeEur = new Decimal(args.rateMinor);
  const allowanceEur = roundHalfUp(feeEur.times(new Decimal('0.3')), 0);
  const vatPct = VAT_RATE[args.base];
  const vatEur = roundHalfUp(feeEur.times(new Decimal(vatPct)).dividedBy(100), 0);
  const eurLines = [
    { kind: 'charter_fee' as const, label: `Charter fee — ${args.yachtName}, week of ${args.weekStart}`, eurMinor: feeEur },
    { kind: 'provisioning_allowance' as const, label: 'Provisioning allowance (30%)', eurMinor: allowanceEur },
    { kind: 'vat' as const, label: `VAT ${vatPct}% on charter fee`, eurMinor: vatEur },
  ];
  const lines: CharterLine[] = eurLines.map((l) => ({
    kind: l.kind,
    label: l.label,
    eurMinor: Number(l.eurMinor.toFixed(0)),
    amountMinor: Number(roundHalfUp(l.eurMinor.times(new Decimal(args.rate)), 0).toFixed(0)),
  }));
  return {
    lines,
    totalEurMinor: Number(feeEur.plus(allowanceEur).plus(vatEur).toFixed(0)),
    totalMinor: lines.reduce((n, l) => n + l.amountMinor, 0),
  };
}

export async function holdQuote(app: App, ctx: Ctx, ws: string, id: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director', 'charter_manager', 'finance_lead']);
  const rows = await app.pool.query<HoldRow>(holdQuery('WHERE id = $1 AND workspace_slug = $2'), [id, ws]);
  const hold = rows.rows[0];
  if (!hold) throw notFound();
  const currency = ctx.query.get('currency') ?? 'EUR';
  if (!CURRENCIES.includes(currency as (typeof CURRENCIES)[number])) throw fieldErrors({ currency: 'Choose one of the listed options.' });
  const splitToday = base.localDate('split', { ms: Date.now() });
  const table = await exchangeTableFor(app.pool, ws, splitToday);
  const rate = exchangeRateFor(currency, table);
  if (rate === null) throw fieldErrors({ currency: 'Choose one of the listed options.' });
  const yacht = await getYacht(app, ws, hold.yacht_slug, true);
  const priced = priceCharter({
    yachtName: yacht.name,
    weekStart: hold.week_start,
    rateMinor: hold.weekly_rate_minor,
    base: yacht.base,
    currency,
    exchangeTableId: table?.id ?? null,
    rate,
  });
  return {
    quote: {
      currency,
      exchangeTableId: table?.id ?? null,
      rate,
      lines: priced.lines,
      totalEurMinor: priced.totalEurMinor,
      totalMinor: priced.totalMinor,
    },
  };
}

// ---------------- deposits and charters ----------------

export async function holdDeposit(app: App, ctx: Ctx, ws: string, id: string): Promise<unknown> {
  const member = await app.requireStaff(ctx, ws, ['fleet_director', 'charter_manager']);
  const body = await app.readJsonBody(ctx);
  const clientEmail = str(body.clientEmail) ?? '';
  const currency = str(body.currency) ?? '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clientEmail)) throw fieldErrors({ clientEmail: 'Enter an email address like name@example.com.' });
  if (!CURRENCIES.includes(currency as (typeof CURRENCIES)[number])) throw fieldErrors({ currency: 'Choose one of the listed options.' });
  const client = await app.pool.connect();
  let invoiceId: string | null = null;
  try {
    await client.query('BEGIN');
    const rows = await client.query<HoldRow>(holdQuery('WHERE id = $1 AND workspace_slug = $2 FOR UPDATE'), [id, ws]);
    const hold = rows.rows[0];
    if (!hold) {
      await client.query('ROLLBACK');
      throw notFound();
    }
    if (hold.status === 'lapsed') {
      await client.query('ROLLBACK');
      throw stateConflict('hold_lapsed', { lapsedAt: hold.lapses_at ? base.instToIso({ ms: hold.lapses_at.getTime() }) : null });
    }
    if (hold.status === 'live' && hold.lapses_at && hold.lapses_at.getTime() <= Date.now()) {
      await client.query("UPDATE holds SET status = 'lapsed' WHERE id = $1", [id]);
      await promoteAfter(app, client, hold.yacht_slug, hold.week_start);
      await client.query('COMMIT');
      throw stateConflict('hold_lapsed', { lapsedAt: base.instToIso({ ms: hold.lapses_at.getTime() }) });
    }
    if (hold.status !== 'live') {
      await client.query('ROLLBACK');
      throw stateConflict('hold_not_live', { status: hold.status });
    }
    const yachtRows = await client.query<YachtDb>('SELECT * FROM yachts WHERE slug = $1', [hold.yacht_slug]);
    const yacht = yachtRows.rows[0];
    const splitToday = base.localDate('split', { ms: Date.now() });
    const table = await exchangeTableFor(client, ws, splitToday);
    const rate = exchangeRateFor(currency, table);
    if (rate === null) {
      await client.query('ROLLBACK');
      throw fieldErrors({ currency: 'Choose one of the listed options.' });
    }
    const charterId = newId('charter');
    const priced = priceCharter({
      yachtName: yacht.name,
      weekStart: hold.week_start,
      rateMinor: hold.weekly_rate_minor,
      base: yacht.base,
      currency,
      exchangeTableId: table?.id ?? null,
      rate,
    });
    // Reserve the week now (unique constraint guards a second deposit).
    await client.query("UPDATE holds SET status = 'charter', charter_id = $1 WHERE id = $2", [charterId, hold.id]);
    await client.query(
      `INSERT INTO charters (id, workspace_slug, hold_id, yacht_slug, week_start, week_end, client_name, client_email, currency, season, deposit_date, exchange_table_id, rate, lines, total_eur_minor, total_minor, invoice_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'not_invoiced')`,
      [charterId, ws, hold.id, hold.yacht_slug, hold.week_start, hold.week_end, hold.client_name, clientEmail, currency, hold.season, splitToday, table?.id ?? null, rate, JSON.stringify(priced.lines), priced.totalEurMinor, priced.totalMinor],
    );
    // Create the invoice and send the mail while the hold is locked.
    try {
      const invoice = await createAccountWithInvoice(
        app.config,
        `tidewright-${charterId}`,
        hold.client_name,
        clientEmail,
        currency,
        priced.lines.map((l) => ({ description: l.label, amountMajor: new Decimal(l.amountMinor).dividedBy(100).toFixed(2) })),
        splitToday,
      );
      invoiceId = invoice.invoiceId;
    } catch (e) {
      await client.query('ROLLBACK');
      if (e instanceof BillingUnavailable) throw serviceUnavailable('billing_unavailable');
      throw e;
    }
    await client.query("UPDATE charters SET invoice_status = 'invoiced', killbill_invoice_id = $1, invoiced_at = now() WHERE id = $2", [invoiceId, charterId]);
    try {
      await sendMail(app.config, {
        to: clientEmail,
        subject: `Charter confirmed: ${yacht.name}, week of ${fmtDateOnly('split', hold.week_start)}`,
        body: depositMailBody(hold.client_name, yacht.name, hold.week_start, hold.week_end, currency, priced.lines, priced.totalMinor, invoiceId!),
      });
    } catch (e) {
      if (e instanceof MailUnavailable) {
        await voidInvoice(app.config, invoiceId!);
        await client.query('ROLLBACK');
        throw serviceUnavailable('mail_unavailable');
      }
      throw e;
    }
    await client.query('COMMIT');
    const fresh = await app.pool.query('SELECT * FROM charters WHERE id = $1', [charterId]);
    return { charter: charterToApi(fresh.rows[0]) };
  } finally {
    client.release();
  }
}

function depositMailBody(clientName: string, yachtName: string, weekStart: string, weekEnd: string, currency: string, lines: CharterLine[], totalMinor: number, invoiceId: string): string {
  const linesText = lines.map((l) => `${l.label}: ${fmtMoney(l.amountMinor, currency)}`).join('\n');
  return [
    `Dear ${clientName},`,
    '',
    `Your charter of ${yachtName} is confirmed.`,
    `Week: ${fmtDateOnly('split', weekStart)} to ${fmtDateOnly('split', weekEnd)}.`,
    '',
    linesText,
    `Total: ${fmtMoney(totalMinor, currency)}`,
    '',
    `Invoice ${invoiceId}`,
  ].join('\n');
}

export function charterToApi(row: any): unknown {
  return {
    id: row.id,
    holdId: row.hold_id,
    yachtSlug: row.yacht_slug,
    weekStart: row.week_start,
    weekEnd: row.week_end,
    clientName: row.client_name,
    clientEmail: row.client_email,
    currency: row.currency,
    season: row.season,
    depositDate: row.deposit_date,
    exchangeTableId: row.exchange_table_id,
    rate: row.rate,
    lines: row.lines,
    totalEurMinor: Number(row.total_eur_minor),
    totalMinor: Number(row.total_minor),
    invoiceStatus: row.invoice_status,
    killbillInvoiceId: row.killbill_invoice_id,
    invoicedAt: row.invoiced_at ? base.instToIso({ ms: row.invoiced_at.getTime() }) : null,
    status: row.status,
    closedAt: row.closed_at ? base.instToIso({ ms: row.closed_at.getTime() }) : null,
    erasesAt: row.erases_at ? base.instToIso({ ms: row.erases_at.getTime() }) : null,
  };
}

export async function chartersList(app: App, ctx: Ctx, ws: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director', 'charter_manager', 'finance_lead', 'captain']);
  const rows = await app.pool.query('SELECT * FROM charters WHERE workspace_slug = $1 ORDER BY deposit_date DESC, id', [ws]);
  return { charters: rows.rows.map(charterToApi) };
}

export async function charterGet(app: App, ctx: Ctx, ws: string, id: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director', 'charter_manager', 'finance_lead', 'captain']);
  const rows = await app.pool.query('SELECT * FROM charters WHERE id = $1 AND workspace_slug = $2', [id, ws]);
  if (!rows.rows[0]) throw notFound();
  return { charter: charterToApi(rows.rows[0]) };
}

export async function chartersCreate(app: App, ctx: Ctx, ws: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director', 'charter_manager']);
  const body = await app.readJsonBody(ctx);
  const yachtSlug = str(body.yachtSlug);
  const weekStart = str(body.weekStart) ?? '';
  const clientName = str(body.clientName) ?? '';
  const clientEmail = str(body.clientEmail) ?? '';
  const currency = str(body.currency) ?? 'EUR';
  const errors: Record<string, string> = {};
  if (!yachtSlug) errors.yachtSlug = 'Choose one of the listed options.';
  if (!base.isSaturday('split', weekStart)) errors.weekStart = 'Choose a Saturday.';
  if (lengthOf(clientName) < 1) errors.clientName = 'This field is required.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clientEmail)) errors.clientEmail = 'Enter an email address like name@example.com.';
  if (!CURRENCIES.includes(currency as (typeof CURRENCIES)[number])) errors.currency = 'Choose one of the listed options.';
  if (Object.keys(errors).length > 0) throw fieldErrors(errors);
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    const yachtRows = await client.query<YachtDb>('SELECT * FROM yachts WHERE slug = $1 AND workspace_slug = $2 FOR UPDATE', [yachtSlug, ws]);
    const yacht = yachtRows.rows[0];
    if (!yacht) {
      await client.query('ROLLBACK');
      throw notFound();
    }
    if (yacht.status === 'withdrawn') {
      await client.query('ROLLBACK');
      throw yachtWithdrawn();
    }
    const charter = await client.query('SELECT 1 FROM charters WHERE yacht_slug = $1 AND week_start = $2', [yachtSlug, weekStart]);
    if ((charter.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      throw stateConflict('week_booked');
    }
    const live = await client.query<HoldRow>(holdQuery("WHERE yacht_slug = $1 AND week_start = $2 AND status = 'live'"), [yachtSlug, weekStart]);
    if (live.rows.length > 0) {
      await client.query('ROLLBACK');
      throw stateConflict('week_taken', { takenBy: live.rows[0].placed_by_name, takenAt: base.instToIso({ ms: live.rows[0].live_since!.getTime() }) });
    }
    const splitToday = base.localDate('split', { ms: Date.now() });
    const table = await exchangeTableFor(client, ws, splitToday);
    const rate = exchangeRateFor(currency, table);
    if (rate === null) {
      await client.query('ROLLBACK');
      throw fieldErrors({ currency: 'Choose one of the listed options.' });
    }
    const charterId = newId('charter');
    const season = seasonOf(weekStart);
    const priced = priceCharter({
      yachtName: yacht.name,
      weekStart,
      rateMinor: rateFor(yacht, season),
      base: yacht.base,
      currency,
      exchangeTableId: table?.id ?? null,
      rate,
    });
    await client.query(
      `INSERT INTO charters (id, workspace_slug, yacht_slug, week_start, week_end, client_name, client_email, currency, season, deposit_date, exchange_table_id, rate, lines, total_eur_minor, total_minor, invoice_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'not_invoiced')`,
      [charterId, ws, yachtSlug, weekStart, base.addDays(weekStart, 7), clientName, clientEmail, currency, season, splitToday, table?.id ?? null, rate, JSON.stringify(priced.lines), priced.totalEurMinor, priced.totalMinor],
    );
    const fresh = await client.query('SELECT * FROM charters WHERE id = $1', [charterId]);
    await client.query('COMMIT');
    return { charter: charterToApi(fresh.rows[0]) };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* nothing */ }
    throw e;
  } finally {
    client.release();
  }
}

export async function charterClose(app: App, ctx: Ctx, ws: string, id: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director', 'captain']);
  const rows = await app.pool.query('SELECT * FROM charters WHERE id = $1 AND workspace_slug = $2', [id, ws]);
  const charter = rows.rows[0];
  if (!charter) throw notFound();
  if (charter.status === 'closed') throw stateConflict('charter_closed');
  await app.pool.query("UPDATE charters SET status = 'closed', closed_at = now(), erases_at = now() + make_interval(secs => $1) WHERE id = $2", [app.config.timers.manifestRetentionSeconds, id]);
  await app.pool.query("UPDATE private_pages SET status = 'ended' WHERE kind = 'manifest' AND charter_id = $1 AND status = 'live'", [id]);
  const fresh = await app.pool.query('SELECT * FROM charters WHERE id = $1', [id]);
  return { charter: charterToApi(fresh.rows[0]) };
}

// helpers used by endpoints that need the pricing with a client transaction

export function tableFromClient(rows: Array<{ id: string; gbp: string; usd: string }>): { id: string; gbp: string; usd: string } | null {
  return rows[0] ?? null;
}

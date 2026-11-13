import { convertSplit } from '../shared/money';
import { CURS, Cur, CurrencyTable, NightState, PlanCode, Quote, QuoteRoom, TierName } from '../shared/types';
import { config, MAX_NIGHTS } from './config';
import { nowMs } from './clock';
import { one, query, withTx } from './db';
import { conflict, gone, notFound, restricted, validation } from './errors';
import { broadcast } from './events';
import { Inventory, loadInventory, loadProperty, nightOf, roomsLeft } from './inventory';
import { newId } from './auth';
import { recommend } from './allocation';
import { RoomSelection, hasDiscount, makeStayContext, priceStay } from './pricing';
import { checkSelection } from './restrictions';
import { tierPct } from './loyalty';
import { addDays, datesBetween as stayDatesOf, diffDays, isDate, localDate } from './zone';
import { currencyTable } from './currency';

export interface Owner {
  visitorId: string | null;
  username: string | null;
}

export interface QuoteRow {
  id: string;
  visitor: string | null;
  username: string | null;
  property: string;
  in_date: string;
  out_date: string;
  currency: Cur;
  tier: TierName;
  rates: CurrencyTable;
  data: {
    rooms: QuoteRoom[];
    nights: { date: string; total_minor: number; taxable_minor: number }[];
    total_minor: number;
    taxable_minor: number;
  };
  total_minor: number;
  expires_at: string;
  hold_id: string | null;
  stale: boolean;
  party: { adults: number; ages: number[] };
}

const QUOTE_FIELDS = `id, visitor, username, property, to_char(in_date, 'YYYY-MM-DD') as in_date,
  to_char(out_date, 'YYYY-MM-DD') as out_date, currency, tier, rates, data, total_minor,
  to_char(expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as expires_at, hold_id, stale, party`;

export async function loadQuoteRow(id: string): Promise<QuoteRow | null> {
  return one<QuoteRow>(`select ${QUOTE_FIELDS} from quotes where id = $1`, [id]);
}

export function ownsQuote(row: QuoteRow, owner: Owner): boolean {
  if (row.username) return row.username === owner.username;
  return row.visitor !== null && row.visitor === owner.visitorId;
}

export interface CreateQuoteInput {
  owner: Owner;
  property: string;
  in: string;
  out: string;
  currency: Cur;
  adults?: number;
  ages?: number[];
  rooms?: { room_type: string; plan: PlanCode; breakfast: boolean; adults: number; ages: number[] }[];
  holdId?: string | null;
  tier: TierName;
}

export async function createQuote(input: CreateQuoteInput): Promise<QuoteRow> {
  const fields: Record<string, string> = {};
  if (!isDate(input.in)) fields.in = 'invalid';
  if (!isDate(input.out)) fields.out = 'invalid';
  if (!CURS.includes(input.currency)) fields.currency = 'invalid';
  if (Object.keys(fields).length > 0) throw validation(fields);
  const nights = diffDays(input.in, input.out);
  if (nights < 1) fields.out = 'invalid';
  if (nights > MAX_NIGHTS) fields.out = 'out_of_range';
  if (Object.keys(fields).length > 0) throw validation(fields);

  const property = await loadProperty(input.property);
  if (!property) throw notFound();

  const inv = await loadInventory([property.code], input.in, addDays(input.out, 1), {
    excludeHold: input.holdId ?? undefined,
  });
  const types = inv.roomTypes.get(property.code) ?? [];
  const today = localDate(property.zone, nowMs());
  const ctx = makeStayContext(property, input.in, input.out, today, tierPct(input.tier));
  const req = { inDate: input.in, outDate: input.out, todayLocal: today };

  let rooms: RoomSelection[];
  let party = { adults: input.adults ?? 2, ages: input.ages ?? [] };
  if (input.rooms && input.rooms.length > 0) {
    for (const room of input.rooms) {
      const rt = inv.roomType.get(room.room_type);
      if (!rt || rt.property !== property.code) throw validation({ rooms: 'invalid' });
      if (room.plan !== 'refundable' && room.plan !== 'nonrefundable') throw validation({ rooms: 'invalid' });
      if (!Number.isInteger(room.adults) || room.adults < 1 || room.adults > rt.max_adults) {
        throw validation({ rooms: 'out_of_range' });
      }
      if (room.adults + room.ages.length > rt.max_guests) throw validation({ rooms: 'out_of_range' });
      for (const age of room.ages) {
        if (!Number.isInteger(age) || age < 0 || age > 17) throw validation({ ages: 'out_of_range' });
      }
    }
    rooms = input.rooms.map((room) => ({ ...room }));
    party = {
      adults: rooms.reduce((sum, room) => sum + room.adults, 0),
      ages: rooms.flatMap((room) => room.ages),
    };
  } else {
    if (!Number.isInteger(party.adults) || party.adults < 1 || party.adults > 16) {
      throw validation({ adults: 'out_of_range' });
    }
    for (const age of party.ages) {
      if (!Number.isInteger(age) || age < 0 || age > 17) throw validation({ ages: 'out_of_range' });
    }
    const recommendation = recommend({ ctx, inv, types, party, req });
    if (!recommendation) {
      const reason = checkSelection(inv, new Map([[types[0]?.code ?? '', 1]]), req);
      throw restricted(reason ?? { code: 'sold_out', date: input.in });
    }
    rooms = recommendation.rooms.map((room) => ({
      room_type: room.room_type,
      plan: 'refundable' as const,
      breakfast: false,
      adults: room.adults,
      ages: room.ages,
    }));
  }

  const counts = new Map<string, number>();
  for (const room of rooms) counts.set(room.room_type, (counts.get(room.room_type) ?? 0) + 1);
  const reason = checkSelection(inv, counts, req);
  if (reason) throw restricted(reason);

  const priced = priceStay(ctx, inv, rooms);
  const rates = await currencyTable();
  const id = newId(12);
  const expiresAt = new Date(nowMs() + config.quoteTtlMs).toISOString();
  const data = {
    rooms: priced.rooms,
    nights: priced.nights.map((night) => ({
      date: night.date,
      total_minor: night.total_minor,
      taxable_minor: night.taxable_minor,
    })),
    total_minor: priced.total_minor,
    taxable_minor: priced.taxable_minor,
  };
  await query(
    `insert into quotes (id, visitor, username, property, in_date, out_date, currency, tier, rates,
       data, total_minor, expires_at, hold_id, party)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      id,
      input.owner.visitorId,
      input.owner.username,
      property.code,
      input.in,
      input.out,
      input.currency,
      input.tier,
      JSON.stringify(rates),
      JSON.stringify(data),
      priced.total_minor,
      expiresAt,
      input.holdId ?? null,
      JSON.stringify(party),
    ],
  );
  const row = await loadQuoteRow(id);
  if (!row) throw notFound();
  return row;
}

async function holdIsLive(holdId: string | null): Promise<boolean> {
  if (!holdId) return false;
  const row = await one<{ state: string; expires_at: string }>(
    `select state, to_char(expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as expires_at from holds where id = $1`,
    [holdId],
  );
  if (!row) return false;
  return row.state === 'live' && nowMs() < new Date(row.expires_at).getTime();
}

/** The quote object, with the currency split across nights and each night's state. */
export async function serialiseQuote(row: QuoteRow): Promise<Quote> {
  const nightsEur = row.data.nights.map((night) => night.total_minor);
  const taxableEur = row.data.nights.map((night) => night.taxable_minor);
  const converted = convertSplit(nightsEur, row.currency, row.rates);
  const convertedTaxable = convertSplit(taxableEur, row.currency, row.rates);
  const held = await holdIsLive(row.hold_id);
  const holdRow = row.hold_id
    ? await one<{ expires_at: string }>(
        `select to_char(expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as expires_at from holds where id = $1`,
        [row.hold_id],
      )
    : null;
  const counts = new Map<string, number>();
  for (const room of row.data.rooms) counts.set(room.room_type, (counts.get(room.room_type) ?? 0) + 1);
  const inv = await loadInventory([row.property], row.in_date, addDays(row.out_date, 1));
  const states: NightState[] = row.data.nights.map((night, index) => {
    if (held) return 'held';
    if (nightClosed(inv, counts, night.date)) return 'closed';
    return hasDiscount(row.data.rooms, index) ? 'discount' : 'base';
  });
  return {
    id: row.id,
    property: row.property,
    in: row.in_date,
    out: row.out_date,
    nights_count: row.data.nights.length,
    currency: row.currency,
    tier: row.tier,
    rates_ppm: row.rates,
    rooms: row.data.rooms,
    nights: row.data.nights.map((night, index) => ({
      date: night.date,
      total_minor: night.total_minor,
      taxable_minor: night.taxable_minor,
      converted_minor: converted.nights[index],
      converted_taxable_minor: convertedTaxable.nights[index],
      state: states[index],
    })),
    total_minor: row.data.total_minor,
    taxable_minor: row.data.taxable_minor,
    converted_total_minor: converted.total,
    converted_taxable_minor: convertedTaxable.total,
    expires_at: row.expires_at,
    hold_id: row.hold_id,
    hold_expires_at: holdRow?.expires_at ?? null,
  };
}

function nightClosed(inv: Inventory, counts: Map<string, number>, date: string): boolean {
  for (const [code, wanted] of counts) {
    const night = nightOf(inv, code, date);
    if (!night || night.stop_sell) return true;
    if (roomsLeft(inv, code, date) < wanted) return true;
  }
  return false;
}

let holdGate: Promise<unknown> = Promise.resolve();

/** Serialises hold creation so exactly one of several simultaneous holds wins. */
function withHoldGate<T>(fn: () => Promise<T>): Promise<T> {
  const run = holdGate.then(fn, fn);
  holdGate = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export interface HoldResult {
  id: string;
  quote_id: string;
  expires_at: string;
  rooms: QuoteRoom[];
}

export async function createHold(quoteId: string, owner: Owner): Promise<HoldResult> {
  return withHoldGate(async () => {
    const row = await loadQuoteRow(quoteId);
    if (!row || !ownsQuote(row, owner)) throw notFound();
    if (nowMs() >= new Date(row.expires_at).getTime()) throw gone('quote_expired');
    if (row.hold_id && (await holdIsLive(row.hold_id))) {
      const existing = await one<{ expires_at: string }>(
        `select to_char(expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as expires_at from holds where id = $1`,
        [row.hold_id],
      );
      return { id: row.hold_id, quote_id: row.id, expires_at: existing!.expires_at, rooms: row.data.rooms };
    }
    const inv = await loadInventory([row.property], row.in_date, addDays(row.out_date, 1));
    const counts = new Map<string, number>();
    for (const room of row.data.rooms) counts.set(room.room_type, (counts.get(room.room_type) ?? 0) + 1);
    const today = localDate(inv.properties.get(row.property)!.zone, nowMs());
    const reason = checkSelection(inv, counts, { inDate: row.in_date, outDate: row.out_date, todayLocal: today });
    if (reason) {
      if (reason.code === 'sold_out') throw conflict('sold_out', { date: reason.date });
      throw restricted(reason);
    }
    const id = newId(12);
    const expiresAt = new Date(nowMs() + config.holdMs).toISOString();
    const dates = stayDatesOf(row.in_date, row.out_date);
    await withTx(async (client) => {
      await client.query(
        `insert into holds (id, quote_id, visitor, username, property, expires_at, state)
         values ($1,$2,$3,$4,$5,$6,'live')`,
        [id, row.id, row.visitor, row.username, row.property, expiresAt],
      );
      for (const room of row.data.rooms) {
        for (const date of dates) {
          await client.query(
            `insert into claims (kind, hold_id, room_type, date) values ('hold', $1, $2, $3)`,
            [id, room.room_type, date],
          );
        }
      }
      await client.query(`update quotes set hold_id = $1 where id = $2`, [id, row.id]);
    });
    broadcast('availability', { property: row.property, room_type: null, dates });
    return { id, quote_id: row.id, expires_at: expiresAt, rooms: row.data.rooms };
  });
}

export async function releaseHold(id: string, owner: Owner): Promise<void> {
  const row = await one<{ visitor: string | null; username: string | null; property: string; state: string }>(
    'select visitor, username, property, state from holds where id = $1',
    [id],
  );
  if (!row) throw notFound();
  const mine = row.username ? row.username === owner.username : row.visitor === owner.visitorId;
  if (!mine) throw notFound();
  if (row.state !== 'live') return;
  const dates = await withTx(async (client) => {
    const claims = await client.query<{ date: string }>(
      `update claims set active = false where hold_id = $1 and active
       returning to_char(date, 'YYYY-MM-DD') as date`,
      [id],
    );
    await client.query(`update holds set state = 'released' where id = $1`, [id]);
    return [...new Set(claims.rows.map((r) => r.date))];
  });
  broadcast('availability', { property: row.property, room_type: null, dates });
}

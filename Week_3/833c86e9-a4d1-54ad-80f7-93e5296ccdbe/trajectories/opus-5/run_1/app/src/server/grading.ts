import { Call, cookie, sendJson } from './http';
import { config } from './config';
import { ApiError, conflict, notFound, validation } from './errors';
import { advanceClock, nowIso, nowMs, setClockTo } from './clock';
import { one, query, withTx } from './db';
import { broadcastClock } from './events';
import { setCurrencyTable, validCurrencyTable } from './currency';
import { setStorageDown } from './storage';
import { ensureVisitor, hashPassword, newId } from './auth';
import { insertNights, NIGHTS_FROM, NIGHTS_TO } from './seed';
import { sweep } from './sweep';
import { loadInventory, loadProperty } from './inventory';
import { makeStayContext, priceStay } from './pricing';
import { addLedgerPair, loadRooms, newBookingCode } from './bookings';
import { completedStays, tierOf, tierPct } from './loyalty';
import { refundStatus } from './policy';
import { pctOf } from '../shared/money';
import { currencyTable } from './currency';
import { ensurePictures } from './pictures';
import { addDays, datesBetween, localDate, parseDate, wallToUtc } from './zone';
import { Cur, PlanCode } from '../shared/types';

interface SeedUser {
  username: string;
  password: string;
  role?: string;
  manages?: string[];
  completed_stays?: { property: string; checkout: string }[];
}

interface SeedRoomType {
  code: string;
  name: string;
  included_adults?: number;
  max_adults?: number;
  max_guests?: number;
  extra_adult_minor?: number;
  child_minor?: number;
  rooms?: number;
  base_rate_minor: number;
}

interface SeedProperty {
  code: string;
  name: string;
  destination: string;
  x: number;
  y: number;
  stars?: number;
  amenities?: string[];
  policy?: { days_before: number; hour: number; refund_pct: number }[];
  vat_pct?: number;
  city_minor?: number;
  levy_pct?: number;
  breakfast_minor?: number;
  single_pct?: number;
  room_types: SeedRoomType[];
}

interface SeedNights {
  room_type: string;
  from: string;
  to: string;
  base_rate_minor?: number;
  allotment?: number;
  min_stay?: number;
  max_stay?: number;
  closed_to_arrival?: boolean;
  closed_to_departure?: boolean;
  stop_sell?: boolean;
  release_days?: number;
}

interface SeedBookingRoom {
  room_type: string;
  plan?: PlanCode;
  breakfast?: boolean;
  adults?: number;
  ages?: number[];
}

interface SeedBooking {
  guest?: string | null;
  given_name?: string;
  surname?: string;
  property: string;
  in: string;
  out: string;
  currency?: Cur;
  rooms: SeedBookingRoom[];
  state?: string;
}

interface SeedReview {
  property: string;
  guest?: string | null;
  scores: number[];
  comment?: string;
  age_days?: number;
  state?: string;
}

export async function handleGrading(call: Call): Promise<void> {
  if (!config.grading) throw new ApiError(404, { error: 'not_found' });
  const path = call.url.pathname;
  const cookies = call.setCookies;
  if (call.method !== 'POST') throw notFound();

  if (path === '/api/grading/seed') {
    const result = await seed(call.json as never);
    sendJson(call.res, 201, result, {}, cookies);
    return;
  }

  if (path === '/api/grading/session') {
    const username = typeof call.json.username === 'string' ? call.json.username.toLowerCase() : '';
    const row = await one<{ username: string; role: string }>('select username, role from users where username = $1', [
      username,
    ]);
    if (!row) throw notFound();
    const visitor = await ensureVisitor(call.ctx.visitorId);
    const session = newId(24);
    await query('insert into sessions (id, username) values ($1,$2)', [session, username]);
    sendJson(call.res, 200, { username: row.username, role: row.role }, {}, [
      ...cookies,
      cookie('kip_session', session),
      cookie('kip_visitor', visitor),
    ]);
    return;
  }

  if (path === '/api/grading/clock') {
    if (typeof call.json.set === 'string') await setClockTo(call.json.set);
    else if (typeof call.json.advance_ms === 'number') await advanceClock(call.json.advance_ms);
    else throw validation({ set: 'required' });
    await sweep();
    broadcastClock();
    sendJson(call.res, 200, { now: nowIso() }, {}, cookies);
    return;
  }

  if (path === '/api/grading/currency') {
    const table = validCurrencyTable(call.json);
    if (!table) throw validation({ currency: 'invalid' });
    await setCurrencyTable(table);
    sendJson(call.res, 200, table, {}, cookies);
    return;
  }

  if (path === '/api/grading/storage') {
    const down = call.json.down;
    if (typeof down !== 'boolean') throw validation({ down: 'invalid' });
    setStorageDown(down);
    if (!down) void ensurePictures().catch(() => undefined);
    sendJson(call.res, 200, { down }, {}, cookies);
    return;
  }

  throw notFound();
}

interface SeedBody {
  users?: SeedUser[];
  destinations?: { code: string; name: string; zone: string; cx: number; cy: number }[];
  properties?: SeedProperty[];
  nights?: SeedNights[];
  bookings?: SeedBooking[];
  reviews?: SeedReview[];
}

interface SeedResponse {
  users: string[];
  destinations: string[];
  properties: string[];
  bookings: {
    code: string;
    state: string;
    version: number;
    quote_id: string | null;
    hold_id: string | null;
    expires_at: string | null;
    review_link: string | null;
  }[];
  reviews: { id: number; state: string }[];
}

async function seed(body: SeedBody): Promise<SeedResponse> {
  const out: SeedResponse = { users: [], destinations: [], properties: [], bookings: [], reviews: [] };

  for (const destination of body.destinations ?? []) {
    const existing = await one('select 1 from destinations where code = $1', [destination.code]);
    if (existing) throw conflict('exists', { code: destination.code });
    await query(
      `insert into destinations (code, name, zone, cx, cy, vat_pct, city_minor, levy_pct, policy)
       values ($1,$2,$3,$4,$5,0,0,0,'[]'::jsonb)`,
      [destination.code, destination.name, destination.zone, destination.cx, destination.cy],
    );
    out.destinations.push(destination.code);
  }

  for (const property of body.properties ?? []) {
    const existing = await one('select 1 from properties where code = $1', [property.code]);
    if (existing) throw conflict('exists', { code: property.code });
    const destination = await one<{ zone: string }>('select zone from destinations where code = $1', [
      property.destination,
    ]);
    if (!destination) throw validation({ destination: 'invalid' });
    await query(
      `insert into properties (code, name, destination, x, y, stars, amenities, zone, vat_pct,
         city_minor, levy_pct, breakfast_minor, single_pct, policy)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        property.code,
        property.name,
        property.destination,
        property.x,
        property.y,
        property.stars ?? 3,
        property.amenities ?? [],
        destination.zone,
        property.vat_pct ?? 0,
        property.city_minor ?? 0,
        property.levy_pct ?? 0,
        property.breakfast_minor ?? 0,
        property.single_pct ?? 0,
        JSON.stringify(property.policy ?? []),
      ],
    );
    for (const rt of property.room_types ?? []) {
      await query(
        `insert into room_types (code, property, name, included_adults, max_adults, max_guests,
           extra_adult_minor, child_minor, rooms, base_rate_minor)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          rt.code,
          property.code,
          rt.name,
          rt.included_adults ?? 2,
          rt.max_adults ?? 2,
          rt.max_guests ?? 3,
          rt.extra_adult_minor ?? 0,
          rt.child_minor ?? 0,
          rt.rooms ?? 1,
          rt.base_rate_minor,
        ],
      );
      await withTx(async (client) => {
        await insertNights(
          client,
          rt.code,
          NIGHTS_FROM,
          NIGHTS_TO,
          rt.base_rate_minor,
          rt.base_rate_minor,
          rt.rooms ?? 1,
        );
      });
    }
    out.properties.push(property.code);
  }

  for (const user of body.users ?? []) {
    const existing = await one('select 1 from users where username = $1', [user.username]);
    if (existing) throw conflict('exists', { code: user.username });
    await query('insert into users (username, password, role) values ($1,$2,$3)', [
      user.username,
      hashPassword(user.password),
      user.role ?? 'guest',
    ]);
    for (const property of user.manages ?? []) {
      await query('insert into manages (username, property) values ($1,$2) on conflict do nothing', [
        user.username,
        property,
      ]);
    }
    out.users.push(user.username);
  }

  for (const night of body.nights ?? []) {
    const sets: string[] = [];
    const params: unknown[] = [night.room_type, night.from, night.to];
    const push = (column: string, value: unknown): void => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    if (night.base_rate_minor !== undefined) push('base_rate_minor', night.base_rate_minor);
    if (night.allotment !== undefined) push('allotment', night.allotment);
    if (night.min_stay !== undefined) push('min_stay', night.min_stay);
    if (night.max_stay !== undefined) push('max_stay', night.max_stay);
    if (night.closed_to_arrival !== undefined) push('closed_to_arrival', night.closed_to_arrival);
    if (night.closed_to_departure !== undefined) push('closed_to_departure', night.closed_to_departure);
    if (night.stop_sell !== undefined) push('stop_sell', night.stop_sell);
    if (night.release_days !== undefined) push('release_days', night.release_days);
    if (sets.length === 0) continue;
    await query(
      `update nights set ${sets.join(', ')} where room_type = $1 and date >= $2::date and date <= $3::date`,
      params,
    );
  }

  for (const user of body.users ?? []) {
    for (const stay of user.completed_stays ?? []) {
      const property = await loadProperty(stay.property);
      if (!property) throw validation({ completed_stays: 'invalid' });
      const types = await query<{ code: string }>(
        'select code from room_types where property = $1 order by code limit 1',
        [stay.property],
      );
      if (types.length === 0) throw validation({ completed_stays: 'invalid' });
      await seedBooking({
        guest: user.username,
        given_name: 'Guest',
        surname: user.username,
        property: stay.property,
        in: addDays(stay.checkout, -1),
        out: stay.checkout,
        rooms: [{ room_type: types[0].code, adults: 1 }],
        state: 'completed',
      });
    }
  }

  for (const booking of body.bookings ?? []) {
    out.bookings.push(await seedBooking(booking));
  }

  for (const review of body.reviews ?? []) {
    const created = new Date(nowMs() - (review.age_days ?? 0) * 86400000).toISOString();
    const row = await one<{ id: string }>(
      `insert into reviews (property, code, username, visitor, token, scores, comment, state, created_at, submitted_at)
       values ($1, null, $2, null, $3, $4, $5, $6, $7, $7) returning id`,
      [
        review.property,
        review.guest ?? null,
        newId(16),
        review.scores,
        review.comment ?? '',
        review.state ?? 'pending',
        created,
      ],
    );
    out.reviews.push({ id: Number(row!.id), state: review.state ?? 'pending' });
  }

  void ensurePictures().catch(() => undefined);
  return out;
}

async function seedBooking(booking: SeedBooking): Promise<SeedResponse['bookings'][number]> {
  const property = await loadProperty(booking.property);
  if (!property) throw validation({ property: 'invalid' });
  const inv = await loadInventory([booking.property], booking.in, addDays(booking.out, 1));
  const stays = await completedStays(booking.guest ?? null, nowMs());
  const tier = tierOf(stays);
  const today = localDate(property.zone, nowMs());
  const ctx = makeStayContext(property, booking.in, booking.out, today, tierPct(tier.name));
  const rooms = booking.rooms.map((room) => ({
    room_type: room.room_type,
    plan: room.plan ?? ('refundable' as PlanCode),
    breakfast: room.breakfast ?? false,
    adults: room.adults ?? 2,
    ages: room.ages ?? [],
  }));
  for (const room of rooms) {
    if (!inv.roomType.has(room.room_type)) throw validation({ rooms: 'invalid' });
  }
  const priced = priceStay(ctx, inv, rooms);
  const rates = await currencyTable();
  const currency = booking.currency ?? 'EUR';
  const state = booking.state ?? 'confirmed';
  const code = newBookingCode();
  const dates = datesBetween(booking.in, booking.out);
  const visitorId = booking.guest ? null : await ensureVisitor(null);
  const quoteId = newId(12);
  const holdId = state === 'held' ? newId(12) : null;
  const expiresAt = state === 'held' ? new Date(nowMs() + config.holdMs).toISOString() : null;

  await withTx(async (client) => {
    await client.query(
      `insert into quotes (id, visitor, username, property, in_date, out_date, currency, tier, rates,
         data, total_minor, expires_at, hold_id, party)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        quoteId,
        visitorId,
        booking.guest ?? null,
        booking.property,
        booking.in,
        booking.out,
        currency,
        tier.name,
        JSON.stringify(rates),
        JSON.stringify({
          rooms: priced.rooms,
          nights: priced.nights.map((night) => ({
            date: night.date,
            total_minor: night.total_minor,
            taxable_minor: night.taxable_minor,
          })),
          total_minor: priced.total_minor,
          taxable_minor: priced.taxable_minor,
        }),
        priced.total_minor,
        new Date(nowMs() + config.quoteTtlMs).toISOString(),
        holdId,
        JSON.stringify({
          adults: rooms.reduce((sum, room) => sum + room.adults, 0),
          ages: rooms.flatMap((room) => room.ages),
        }),
      ],
    );
    if (holdId) {
      await client.query(
        `insert into holds (id, quote_id, visitor, username, property, expires_at, state)
         values ($1,$2,$3,$4,$5,$6,'live')`,
        [holdId, quoteId, visitorId, booking.guest ?? null, booking.property, expiresAt],
      );
    }
    await client.query(
      `insert into bookings (code, version, visitor, username, property, in_date, out_date,
         given_name, surname, card_last4, currency, rates, tier, created_at)
       values ($1,1,$2,$3,$4,$5,$6,$7,$8,'0002',$9,$10,$11,$12)`,
      [
        code,
        visitorId,
        booking.guest ?? null,
        booking.property,
        booking.in,
        booking.out,
        booking.given_name ?? 'Guest',
        booking.surname ?? 'Visitor',
        currency,
        JSON.stringify(rates),
        tier.name,
        new Date(nowMs()).toISOString(),
      ],
    );
    let n = 1;
    for (const room of priced.rooms) {
      const roomState = state === 'held' ? 'held' : state === 'cancelled' ? 'confirmed' : state;
      await client.query(
        `insert into booking_rooms (code, n, room_type, plan, breakfast, adults, ages, state,
           nights, total_minor, paid_minor)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          code,
          n,
          room.room_type,
          room.plan,
          room.breakfast,
          room.adults,
          room.ages,
          roomState,
          JSON.stringify(room.nights),
          room.total_minor,
          state === 'held' ? 0 : room.total_minor,
        ],
      );
      for (const date of dates) {
        if (holdId) {
          await client.query(`insert into claims (kind, hold_id, room_type, date) values ('hold', $1, $2, $3)`, [
            holdId,
            room.room_type,
            date,
          ]);
        } else {
          await client.query(
            `insert into claims (kind, code, room_n, room_type, date) values ('booking', $1, $2, $3, $4)`,
            [code, n, room.room_type, date],
          );
        }
      }
      n += 1;
    }
    await client.query(
      `insert into reviews (property, code, username, visitor, token, state) values ($1,$2,$3,$4,$5,'unused')`,
      [booking.property, code, booking.guest ?? null, visitorId, newId(16)],
    );
  });

  if (state !== 'held') await addLedgerPair(code, 'charge', 'from_guest', priced.total_minor);

  if (state === 'completed') {
    const parts = parseDate(booking.out)!;
    const completion = wallToUtc(property.zone, parts.y, parts.m, parts.d, 11, 0);
    await query(
      `update booking_rooms set state = 'completed', completed_at = $2 where code = $1`,
      [code, new Date(completion).toISOString()],
    );
    const token = await one<{ token: string }>('select token from reviews where code = $1', [code]);
    if (token) {
      await query(
        `insert into inbox (username, visitor, kind, property, link, at) values ($1,$2,'review',$3,$4,$5)`,
        [booking.guest ?? null, visitorId, booking.property, `/reviews/${token.token}`, new Date(completion).toISOString()],
      );
    }
  }

  if (state === 'cancelled') {
    const roomRows = await loadRooms(code);
    let refund = 0;
    for (const room of roomRows) {
      const status = refundStatus(property, booking.in, nowMs(), [room.plan]);
      const amount = pctOf(room.paid_minor - room.refunded_minor, status.refund_pct);
      refund += amount;
      await query(
        `update booking_rooms set state = 'cancelled', cancelled_at = $3, refunded_minor = $4
         where code = $1 and n = $2`,
        [code, room.n, new Date(nowMs()).toISOString(), amount],
      );
    }
    await query('update claims set active = false where code = $1', [code]);
    await addLedgerPair(code, 'refund', 'to_guest', refund);
  }

  if (state === 'no_show') {
    await query(`update booking_rooms set state = 'no_show' where code = $1`, [code]);
  }

  const reviewToken = await one<{ token: string }>('select token from reviews where code = $1', [code]);
  const version = await one<{ version: number }>('select version from bookings where code = $1', [code]);
  return {
    code,
    state,
    version: version?.version ?? 1,
    quote_id: state === 'held' ? quoteId : null,
    hold_id: holdId,
    expires_at: expiresAt,
    review_link: reviewToken ? `/reviews/${reviewToken.token}` : null,
  };
}

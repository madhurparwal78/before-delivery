import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import type pg from 'pg';
import { pool, withTransaction, id } from './db.js';
import { err } from './errors.js';
import { config } from './config.js';
import { hotelNow } from './guards.js';
import { isValidDate, addDays, dateRange, compareDates } from './dates.js';
import { priceStay, priceNight, TaxRateRow, RatePlanRow } from './pricing.js';
import { serializeStay } from './serialize.js';
import { publish } from './live.js';
import { sendMail } from './mail.js';
import { RoomRow, GuestRow, firstHeldNight } from './store.js';
import type { Night, Stay } from '../shared/types.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function loadTaxRates(client: pg.PoolClient, hotelId: string): Promise<TaxRateRow[]> {
  const res = await client.query(
    'SELECT id, percent::text AS percent, start_date::text AS start_date FROM tax_rates WHERE hotel_id = $1 ORDER BY start_date NULLS FIRST', [hotelId]);
  return res.rows.map(r => ({ id: r.id, percent: r.percent, startDate: r.start_date }));
}

export async function loadPlan(client: pg.PoolClient, hotelId: string, planId: string): Promise<RatePlanRow | null> {
  const res = await client.query(
    `SELECT id, name, weeknight_cents AS "weeknightCents", weekend_cents AS "weekendCents"
     FROM rate_plans WHERE hotel_id = $1 AND id = $2`, [hotelId, planId]);
  return res.rows[0] ?? null;
}

export function validateStayFields(args: {
  arrival?: unknown; departure?: unknown; guests?: unknown; roomId?: unknown; ratePlanId?: unknown;
  businessDate: string; inHouse?: boolean;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  const { arrival, departure, guests, roomId, ratePlanId } = args;
  if (typeof arrival !== 'string' || !isValidDate(arrival)) {
    errors.arrival = 'Arrival cannot be before the business date.';
  } else if (compareDates(arrival, args.businessDate) < 0) {
    errors.arrival = 'Arrival cannot be before the business date.';
  }
  if (typeof departure !== 'string' || !isValidDate(departure)) {
    errors.departure = 'Departure must be after arrival.';
  } else {
    if (typeof arrival === 'string' && isValidDate(arrival) && compareDates(departure, arrival) <= 0) {
      errors.departure = 'Departure must be after arrival.';
    } else {
      const nights = dateRange(arrival as string, addDays(departure, -1)).length;
      if (nights > 90) errors.departure = 'Stays are limited to 90 nights.';
      if (args.inHouse && compareDates(departure, args.businessDate) < 0) {
        errors.departure = 'Departure cannot be before the business date.';
      }
    }
  }
  if (typeof guests !== 'number' || !Number.isInteger(guests) || guests < 1 || guests > 6) {
    errors.guests = 'Guests must be between 1 and 6.';
  }
  if (typeof roomId !== 'string' || !roomId) errors.roomId = 'Choose a room.';
  if (typeof ratePlanId !== 'string' || !ratePlanId) errors.ratePlanId = 'Choose a rate plan.';
  return errors;
}

export async function quote(req: Request, res: Response) {
  const user = req.user!;
  const hotel = await hotelNow(user.hotelId);
  const errors = validateStayFields({
    arrival: req.body.arrival, departure: req.body.departure, guests: req.body.guests,
    roomId: req.body.roomId, ratePlanId: req.body.ratePlanId, businessDate: hotel.businessDate
  });
  if (Object.keys(errors).length) throw err.validations(errors);
  const nightly = await withTransaction(async client => {
    const plan = await loadPlan(client, user.hotelId, req.body.ratePlanId);
    if (!plan) throw err.validation('ratePlanId', 'Choose a rate plan.');
    const roomRes = await client.query('SELECT number FROM rooms WHERE id = $1 AND hotel_id = $2', [req.body.roomId, user.hotelId]);
    if (!roomRes.rows[0]) throw err.validation('roomId', 'Choose a room.');
    const taxRates = await loadTaxRates(client, user.hotelId);
    return priceStay({ plan, taxRates, arrival: req.body.arrival, departure: req.body.departure, guests: req.body.guests, roomNumber: roomRes.rows[0].number });
  });
  res.json({ nightly, totalCents: nightly.reduce((s, n) => s + n.totalCents, 0) });
}

export async function create(req: Request, res: Response) {
  const user = req.user!;
  const key = req.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length < 1 || key.length > 200) {
    throw err.validation('idempotencyKey', 'Send an Idempotency-Key header.');
  }
  const bodyHash = crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex');

  const replay = await pool.query(
    'SELECT * FROM idempotency WHERE hotel_id = $1 AND key = $2', [user.hotelId, key]);
  if (replay.rows[0]) {
    const row = replay.rows[0];
    if (row.request_hash !== bodyHash) throw err.conflict('This request was already used for a different stay.');
    res.status(201).json(JSON.parse(row.response_body));
    return;
  }

  const stay = await createStayAndNotify(user, req.body, key, bodyHash, reqOrigin(req));
  res.status(201).json(stay);
}

function reqOrigin(req: Request): string {
  return `${req.protocol}://${req.get('host') ?? 'localhost:4173'}`;
}

async function createStayAndNotify(user: { hotelId: string }, body: Record<string, unknown>, key: string, bodyHash: string, origin: string): Promise<Stay> {
  const { stay, notice } = await withTransaction(async client => {
    const hotel = await hotelRow(client, user.hotelId);
    const errors = validateStayFields({
      arrival: body.arrival, departure: body.departure, guests: body.guests,
      roomId: body.roomId, ratePlanId: body.ratePlanId, businessDate: hotel.business_date
    });
    const guestErrors = validateGuestFields(body.guest, body.guestId);
    Object.assign(errors, guestErrors.errors);
    if (Object.keys(errors).length) throw err.validations(errors);

    const roomRes = await client.query(
      'SELECT * FROM rooms WHERE id = $1 AND hotel_id = $2', [body.roomId, user.hotelId]);
    const room = roomRes.rows[0] as RoomRow | undefined;
    if (!room) throw err.validation('roomId', 'Choose a room.');
    const plan = await loadPlan(client, user.hotelId, body.ratePlanId as string);
    if (!plan) throw err.validation('ratePlanId', 'Choose a rate plan.');

    const nights = dateRange(body.arrival as string, addDays(body.departure as string, -1));
    // lock the room so two clerks cannot both take its last free night
    await client.query('SELECT id FROM rooms WHERE id = $1 FOR UPDATE', [room.id]);
    const held = await firstHeldNight(client, room.id, nights);
    if (held) {
      throw err.conflict(`Room ${room.number} was just taken. Choose another room.`);
    }

    let guestId: string;
    let guest: GuestRow;
    if (body.guestId) {
      const g = await client.query('SELECT * FROM guests WHERE id = $1 AND hotel_id = $2', [body.guestId, user.hotelId]);
      if (!g.rows[0]) throw err.validation('guest', 'Enter the guest\'s name.');
      guest = g.rows[0] as GuestRow;
      guestId = guest.id;
    } else {
      const g = guestErrors.guest! as { name: string; email: string; phone: string };
      const existing = await client.query(
        'SELECT * FROM guests WHERE hotel_id = $1 AND lower(email) = lower($2) AND email <> \'\'', [user.hotelId, g.email]);
      if (existing.rows[0]) {
        guest = existing.rows[0] as GuestRow;
        guestId = guest.id;
      } else {
        guestId = id('g');
        await client.query(
          'INSERT INTO guests (id, hotel_id, name, email, phone) VALUES ($1,$2,$3,$4,$5)',
          [guestId, user.hotelId, g.name, g.email, g.phone]);
        guest = { id: guestId, hotel_id: user.hotelId, name: g.name, email: g.email, phone: g.phone, company: '', address: '' };
      }
    }

    const stayId = id('s');
    await client.query(
      `INSERT INTO stays (id, hotel_id, guest_id, rate_plan_id, guests, arrival, departure, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'booked')`,
      [stayId, user.hotelId, guestId, plan.id, body.guests, body.arrival, body.departure]);

    const taxRates = await loadTaxRates(client, user.hotelId);
    for (const date of nights) {
      const night = priceNightForStay(plan, taxRates, date, body.guests as number, nights.length, room.number);
      await client.query(
        `INSERT INTO stay_nights (id, stay_id, hotel_id, date, room_id, room_cents, tax_cents, city_tax_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id('n'), stayId, user.hotelId, date, room.id, night.roomCents, night.taxCents, night.cityTaxCents]);
    }
    await client.query(
      'INSERT INTO stay_segments (id, stay_id, room_id, first_night, nights) VALUES ($1,$2,$3,$4,$5)',
      [id('seg'), stayId, room.id, body.arrival, nights.length]);

    const folioId = id('f');
    await client.query(
      `INSERT INTO folios (id, hotel_id, stay_id, name, payer_name, payer_email, state, letter)
       VALUES ($1,$2,$3,'Folio A',$4,$5,'open','A')`,
      [folioId, user.hotelId, stayId, guest.name, guest.email]);

    const { notice: linkNotice } = await issueCheckinLink(client, stayId, guest.email, hotelNameFromRow(hotel), hotel.clock_fixed_at ? new Date(hotel.clock_fixed_at) : new Date(), origin);
    const serialized = await serializeStay(client, stayId, {
      businessDate: hotel.business_date, timeZone: hotel.time_zone,
      now: hotel.clock_fixed_at ? new Date(hotel.clock_fixed_at) : new Date()
    });
    await client.query(
      'INSERT INTO idempotency (hotel_id, key, request_hash, status, response_body) VALUES ($1,$2,$3,201,$4)',
      [user.hotelId, key, bodyHash, JSON.stringify(serialized)]);
    const createNotice = `Stay created for ${serialized.guest.name} in room ${serialized.nightly[0]?.roomNumber ?? ''}.`;
    return { stay: serialized, notice: linkNotice ? `${createNotice} ${linkNotice}` : createNotice };
  });
  publish(user.hotelId, { type: 'stay', notice, stayId: stay.id });
  return stay;
}

export function priceNightForStay(plan: RatePlanRow, taxRates: TaxRateRow[], date: string, guests: number, totalNights: number, roomNumber: string): Omit<Night, 'posted'> {
  const priced = priceNight({ plan, taxRates, date, guests, totalNights });
  return { date, roomNumber, ...priced };
}

function validateGuestFields(guestBody: unknown, guestId: unknown): { errors: Record<string, string>; guest?: { name: string; email: string; phone: string } } {
  const errors: Record<string, string> = {};
  if (guestId) return { errors };
  if (typeof guestBody !== 'object' || guestBody === null) {
    errors['guest.name'] = 'Enter the guest\'s name.';
    return { errors };
  }
  const g = guestBody as Record<string, unknown>;
  const name = typeof g.name === 'string' ? g.name.trim() : '';
  const email = typeof g.email === 'string' ? g.email.trim() : '';
  const phone = typeof g.phone === 'string' ? g.phone.trim() : '';
  if (!name) errors['guest.name'] = 'Enter the guest\'s name.';
  if (!EMAIL_RE.test(email)) errors['guest.email'] = 'Enter a valid email address.';
  if (Object.keys(errors).length) return { errors };
  return { errors, guest: { name, email, phone } };
}

async function hotelRow(client: pg.PoolClient, hotelId: string) {
  const res = await client.query('SELECT * FROM hotels WHERE id = $1', [hotelId]);
  const row = res.rows[0];
  if (!row) throw err.notFound();
  return row as { id: string; name: string; time_zone: string; business_date: string; clock_fixed_at: Date | null };
}

function hotelNameFromRow(h: { name: string }): string { return h.name; }

export async function issueCheckinLink(client: pg.PoolClient, stayId: string, guestEmail: string, hotelName: string, now: Date, origin?: string): Promise<{ sent: boolean; notice: string | null }> {
  const token = crypto.randomBytes(24).toString('hex');
  await client.query(
    'INSERT INTO checkin_tokens (token, stay_id, sent_at) VALUES ($1,$2,$3)', [token, stayId, now]);
  await client.query('UPDATE checkin_tokens SET accepted_at = $1 WHERE stay_id = $2 AND token <> $3', [now, stayId, token]);
  const url = `${linkBase(origin)}/checkin/${token}`;
  try {
    await sendMail({
      to: guestEmail, from: config.mailFrom,
      subject: `Check in for your stay at ${hotelName}`,
      text: `Check in here: ${url}\n`
    });
    await client.query('UPDATE checkin_tokens SET mail_sent = TRUE WHERE token = $1', [token]);
    return { sent: true, notice: null };
  } catch {
    return { sent: false, notice: 'The check-in link could not be sent. The mail service is unavailable.' };
  }
}

export function linkBase(reqOrigin?: string): string {
  if (config.appPublicUrl) return config.appPublicUrl;
  return reqOrigin ?? '';
}

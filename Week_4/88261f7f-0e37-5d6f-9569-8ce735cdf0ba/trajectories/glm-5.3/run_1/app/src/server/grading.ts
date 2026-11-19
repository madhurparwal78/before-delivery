import type { Request, Response } from 'express';
import { pool, withTransaction, id } from './db.js';
import { err } from './errors.js';
import { config } from './config.js';
import { nightOfInstant, addDays } from './dates.js';
import { priceNight, TaxRateRow, RatePlanRow } from './pricing.js';
import { hashPassword } from './auth.js';
import { issueCheckinLink } from './stays.js';

function requireGradingKey(req: Request): void {
  const header = req.headers['x-grading-key'];
  if (typeof header !== 'string' || !config.gradingKey || header !== config.gradingKey) {
    throw err.notFound();
  }
}

interface SetupBody {
  hotel?: { name?: string; timeZone?: string; businessDate?: string; now?: string | null };
  users?: Array<{ key: string; email: string; password: string; name: string; role: string }>;
  rooms?: Array<{ key: string; number: string; type?: string; status?: string }>;
  ratePlans?: Array<{ key: string; name: string; weeknightCents: number; weekendCents: number }>;
  taxRates?: Array<{ percent: string; startDate: string }>;
  guests?: Array<{ key: string; name: string; email?: string; phone?: string; company?: string; address?: string }>;
  stays?: Array<{ key: string; room: string; guest: string; ratePlan: string; arrival: string; departure: string; guests?: number; status?: string; checkinLink?: boolean }>;
  folios?: Array<{ key: string; stay: string; name?: string; payerName: string; payerEmail: string; entries?: Array<{ key: string; kind?: string; date: string; description: string; amountCents: number; roomNumber?: string | null }> }>;
  secondHotel?: SetupBody;
}

export async function setup(req: Request, res: Response) {
  requireGradingKey(req);
  const body = req.body as SetupBody;
  const first = await createHotel(body);
  const result: Record<string, unknown> = { ...first.ids };
  let secondIds: Record<string, unknown> | null = null;
  if (body.secondHotel) {
    const second = await createHotel(body.secondHotel);
    secondIds = second.ids;
  }
  res.status(201).json({
    ...result,
    ...(secondIds ? { secondHotel: secondIds } : {})
  });
}

async function createHotel(body: SetupBody) {
  if (!body.hotel || typeof body.hotel.name !== 'string') {
    throw err.validations({ setup: 'Send a hotel name.' });
  }
  const timeZone = body.hotel.timeZone ?? config.hotelTimeZoneDefault;
  const fixedNow = body.hotel.now ? new Date(body.hotel.now) : null;
  const ids: Record<string, Record<string, string>> = {
    users: {}, rooms: {}, ratePlans: {}, guests: {}, stays: {}, folios: {}, entries: {}
  };
  let hotelId = '';

  await withTransaction(async client => {
    hotelId = id('h');
    let businessDate = body.hotel!.businessDate;
    if (fixedNow) {
      businessDate = businessDate ?? nightOfInstant(fixedNow, timeZone);
    } else if (!businessDate) {
      businessDate = nightOfInstant(new Date(), timeZone);
    } else {
      // treat earlier dates as closed; business date is the given date
    }
    await client.query(
      'INSERT INTO hotels (id, name, time_zone, business_date, clock_fixed_at) VALUES ($1,$2,$3,$4,$5)',
      [hotelId, body.hotel!.name, timeZone, businessDate, fixedNow]);

    for (const user of body.users ?? []) {
      if (!user.key || !user.email || !user.password || !user.name || !user.role) {
        throw err.validations({ setup: 'Send a complete user.' });
      }
      const uid = id('u');
      ids.users[user.key] = uid;
      await client.query(
        'INSERT INTO users (id, hotel_id, email, password_hash, name, role) VALUES ($1,$2,$3,$4,$5,$6)',
        [uid, hotelId, user.email, hashPassword(user.password), user.name, user.role]);
    }

    for (const room of body.rooms ?? []) {
      if (!room.key || !room.number) throw err.validations({ setup: 'Send a complete room.' });
      const rid = id('r');
      ids.rooms[room.key] = rid;
      const status = room.status ?? 'clean';
      await client.query(
        'INSERT INTO rooms (id, hotel_id, number, type, status) VALUES ($1,$2,$3,$4,$5)',
        [rid, hotelId, room.number, room.type ?? 'Queen', status]);
    }

    // rate plans: default Flexible/Corporate when absent
    const plans = body.ratePlans ?? [
      { key: 'flex', name: 'Flexible', weeknightCents: 12000, weekendCents: 15000 },
      { key: 'corp', name: 'Corporate', weeknightCents: 12040, weekendCents: 12040 }
    ];
    for (const plan of plans) {
      if (!plan.key || !plan.name) throw err.validations({ setup: 'Send a complete rate plan.' });
      const pid = id('p');
      ids.ratePlans[plan.key] = pid;
      await client.query(
        'INSERT INTO rate_plans (id, hotel_id, name, weeknight_cents, weekend_cents) VALUES ($1,$2,$3,$4,$5)',
        [pid, hotelId, plan.name, plan.weeknightCents, plan.weekendCents]);
    }

    // default tax rate (8.75%) always present with startDate null
    await client.query(
      'INSERT INTO tax_rates (id, hotel_id, percent, start_date) VALUES ($1,$2,$3,NULL)',
      [id('t'), hotelId, config.defaultTaxPercent]);
    for (const rate of body.taxRates ?? []) {
      if (!rate.percent || !rate.startDate) throw err.validations({ setup: 'Send a complete tax rate.' });
      await client.query(
        'INSERT INTO tax_rates (id, hotel_id, percent, start_date) VALUES ($1,$2,$3,$4)',
        [id('t'), hotelId, rate.percent, rate.startDate]);
    }

    for (const guest of body.guests ?? []) {
      if (!guest.key || !guest.name) throw err.validations({ setup: 'Send a complete guest.' });
      const gid = id('g');
      ids.guests[guest.key] = gid;
      await client.query(
        'INSERT INTO guests (id, hotel_id, name, email, phone, company, address) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [gid, hotelId, guest.name, guest.email ?? '', guest.phone ?? '', guest.company ?? '', guest.address ?? '']);
    }

    const taxRates: TaxRateRow[] = [
      { id: 'default', percent: config.defaultTaxPercent, startDate: null },
      ...(body.taxRates ?? []).map(r => ({ id: 'x', percent: r.percent, startDate: r.startDate }))
    ];

    for (const stay of body.stays ?? []) {
      if (!stay.key || !stay.room || !stay.guest || !stay.ratePlan || !stay.arrival || !stay.departure) {
        throw err.validations({ setup: 'Send a complete stay.' });
      }
      const mappedRoom = ids.rooms[stay.room];
      const mappedGuest = ids.guests[stay.guest];
      const mappedPlan = ids.ratePlans[stay.ratePlan];
      if (!mappedRoom || !mappedGuest || !mappedPlan) {
        throw err.validations({ setup: 'Unknown key reference.' });
      }
      const stayId = id('s');
      ids.stays[stay.key] = stayId;
      const guestsCount = stay.guests ?? 1;
      const status = stay.status ?? 'booked';
      await client.query(
        `INSERT INTO stays (id, hotel_id, guest_id, rate_plan_id, guests, arrival, departure, status, check_in_night)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [stayId, hotelId, mappedGuest, mappedPlan, guestsCount, stay.arrival, stay.departure, status,
          status === 'in_house' || status === 'checked_out' ? stay.arrival : null]);

      // nights
      const nights = [];
      let date = stay.arrival;
      while (date < stay.departure) {
        nights.push(date);
        date = addDays(date, 1);
      }
      const roomRes = await client.query('SELECT number FROM rooms WHERE id = $1', [mappedRoom]);
      const roomNumber = roomRes.rows[0].number;
      const planRes = await client.query('SELECT id, name, weeknight_cents, weekend_cents FROM rate_plans WHERE id = $1', [mappedPlan]);
      const plan: RatePlanRow = {
        id: planRes.rows[0].id, name: planRes.rows[0].name,
        weeknightCents: planRes.rows[0].weeknight_cents, weekendCents: planRes.rows[0].weekend_cents
      };
      const active = status === 'booked' || status === 'in_house';
      for (const nightDate of nights) {
        const priced = priceNight({ plan, taxRates, date: nightDate, guests: guestsCount, totalNights: nights.length });
        await client.query(
          `INSERT INTO stay_nights (id, stay_id, hotel_id, date, room_id, room_cents, tax_cents, city_tax_cents, posted)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [id('n'), stayId, hotelId, nightDate, mappedRoom, priced.roomCents, priced.taxCents, priced.cityTaxCents, !active]);
      }
      await client.query(
        'INSERT INTO stay_segments (id, stay_id, room_id, first_night, nights) VALUES ($1,$2,$3,$4,$5)',
        [id('seg'), stayId, mappedRoom, stay.arrival, nights.length]);

      const guestRes = await client.query('SELECT name, email FROM guests WHERE id = $1', [mappedGuest]);
      if (stay.checkinLink && status === 'booked' && stay.arrival >= businessDate) {
        await issueCheckinLink(client, stayId, guestRes.rows[0].email, body.hotel!.name!,
          fixedNow ?? new Date());
      }
      const listedForStay = (body.folios ?? []).some(f => f.stay === stay.key);
      if (!listedForStay) {
        const folioId = id('f');
        await client.query(
          `INSERT INTO folios (id, hotel_id, stay_id, name, payer_name, payer_email, state, letter)
           VALUES ($1,$2,$3,'Folio A',$4,$5,'open','A')`,
          [folioId, hotelId, stayId, guestRes.rows[0].name, guestRes.rows[0].email]);
        ids.folios[`${stay.key}:A`] = folioId;
      }
    }

    for (const folio of body.folios ?? []) {
      if (!folio.key || !folio.stay) throw err.validations({ setup: 'Send a complete folio.' });
      const stayId = ids.stays[folio.stay];
      if (!stayId) throw err.validations({ setup: 'Unknown key reference.' });
      const folioId = id('f');
      const letter = (folio.name ?? 'Folio A').replace('Folio ', '') || 'A';
      await client.query(
        `INSERT INTO folios (id, hotel_id, stay_id, name, payer_name, payer_email, state, letter)
         VALUES ($1,$2,$3,$4,$5,$6,'open',$7)`,
        [folioId, hotelId, stayId, folio.name ?? `Folio ${letter}`, folio.payerName, folio.payerEmail, letter]);
      ids.folios[folio.key] = folioId;
      for (const entry of folio.entries ?? []) {
        if (!entry.key || !entry.date || !entry.description || typeof entry.amountCents !== 'number') {
          throw err.validations({ setup: 'Send a complete entry.' });
        }
        const entryId = id('e');
        ids.entries[entry.key] = entryId;
        await client.query(
          `INSERT INTO entries (id, folio_id, kind, date, description, amount_cents, room_number)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [entryId, folioId, entry.kind ?? 'charge', entry.date, entry.description, entry.amountCents, entry.roomNumber ?? null]);
      }
    }
  });

  return { ids: { hotelId, ...ids } };
}

export async function clock(req: Request, res: Response) {
  requireGradingKey(req);
  const hotelId = req.body.hotelId;
  const now = req.body.now === null || req.body.now === undefined ? null : new Date(req.body.now);
  if (typeof hotelId !== 'string') throw err.notFound();
  if (now !== null && Number.isNaN(now.getTime())) throw err.notFound();
  const res2 = await pool.query('SELECT id FROM hotels WHERE id = $1', [hotelId]);
  if (!res2.rows[0]) throw err.notFound();
  await pool.query('UPDATE hotels SET clock_fixed_at = $1 WHERE id = $2', [now, hotelId]);
  res.json({ hotelId, now: now ? now.toISOString() : null });
}

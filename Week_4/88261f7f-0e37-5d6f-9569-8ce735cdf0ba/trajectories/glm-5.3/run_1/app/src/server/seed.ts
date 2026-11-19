import type pg from 'pg';
import { pool, id } from './db.js';
import { config } from './config.js';
import { hashPassword } from './auth.js';
import { nightOfInstant, addDays, dateRange } from './dates.js';
import { priceNight, TaxRateRow, RatePlanRow } from './pricing.js';

/** Seed once at first start: one hotel with rooms, users, stays and posted nights. */
export async function seedIfEmpty(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['nightroll-seed']);
    const check = await client.query('SELECT COUNT(*)::int AS n FROM hotels');
    if (check.rows[0].n > 0) return;
    await client.query('BEGIN');
    await seedHotel(client);
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* already failed */ }
    throw e;
  } finally {
    try { await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['nightroll-seed']); } catch { /* connection lost */ }
    client.release();
  }
}

async function seedHotel(client: pg.PoolClient): Promise<void> {
  const businessDate = nightOfInstant(new Date(), config.hotelTimeZoneDefault);
  const hotelId = id('h');
  await client.query(
    'INSERT INTO hotels (id, name, time_zone, business_date) VALUES ($1,$2,$3,$4)',
    [hotelId, 'The Larkspur Inn', config.hotelTimeZoneDefault, businessDate]);

  const users = [
    ['owner@larkspur.example', 'night-owner-2027', 'Wren Abara', 'owner'],
    ['desk@larkspur.example', 'night-desk-2027', 'Theo Marsh', 'front_desk'],
    ['desk2@larkspur.example', 'night-desk2-2027', 'Lena Fisk', 'front_desk'],
    ['rooms@larkspur.example', 'night-rooms-2027', 'Ivo Pell', 'housekeeper']
  ];
  for (const [email, password, name, role] of users) {
    await client.query(
      'INSERT INTO users (id, hotel_id, email, password_hash, name, role) VALUES ($1,$2,$3,$4,$5,$6)',
      [id('u'), hotelId, email, hashPassword(password), name, role]);
  }

  const rooms: Array<[string, string, string]> = [
    ['101', 'Queen', 'clean'], ['102', 'Queen', 'clean'], ['103', 'King', 'clean'],
    ['104', 'King', 'dirty'], ['105', 'Twin', 'clean'], ['201', 'Queen', 'clean'],
    ['202', 'Queen', 'clean'], ['203', 'King', 'clean'], ['204', 'Twin', 'clean'],
    ['205', 'Suite', 'out_of_order'], ['301', 'Queen', 'inspected'], ['302', 'King', 'clean'],
    ['303', 'King', 'clean'], ['304', 'Suite', 'clean']
  ];
  const roomIds: Record<string, string> = {};
  for (const [number, type, status] of rooms) {
    const rid = id('r');
    roomIds[number] = rid;
    await client.query(
      'INSERT INTO rooms (id, hotel_id, number, type, status) VALUES ($1,$2,$3,$4,$5)',
      [rid, hotelId, number, type, status]);
  }

  const plans: Array<[string, string, number, number]> = [
    ['Flexible', 'flex', 12000, 15000],
    ['Corporate', 'corp', 12040, 12040]
  ];
  const planIds: Record<string, string> = {};
  const planRows: Record<string, RatePlanRow> = {};
  for (const [name, key, weeknight, weekend] of plans) {
    const pid = id('p');
    planIds[key] = pid;
    planRows[key] = { id: pid, name, weeknightCents: weeknight, weekendCents: weekend };
    await client.query(
      'INSERT INTO rate_plans (id, hotel_id, name, weeknight_cents, weekend_cents) VALUES ($1,$2,$3,$4,$5)',
      [pid, hotelId, name, weeknight, weekend]);
  }

  await client.query(
    'INSERT INTO tax_rates (id, hotel_id, percent, start_date) VALUES ($1,$2,$3,NULL)',
    [id('t'), hotelId, config.defaultTaxPercent]);
  const taxRates: TaxRateRow[] = [{ id: 'default', percent: config.defaultTaxPercent, startDate: null }];

  interface SeedStay { name: string; email: string; room: string; arrival: string; departure: string; plan: string; guests: number; status: string; folioB?: { payerName: string; payerEmail: string } }
  const stays: SeedStay[] = [
    { name: 'Mara Okafor', email: 'mara@guests.example', room: '101', arrival: addDays(businessDate, -1), departure: addDays(businessDate, 2), plan: 'flex', guests: 2, status: 'in_house' },
    { name: 'Tomas Lindqvist', email: 'tomas@guests.example', room: '103', arrival: addDays(businessDate, -1), departure: addDays(businessDate, 1), plan: 'corp', guests: 1, status: 'in_house', folioB: { payerName: 'Brightwell Surveying Ltd', payerEmail: 'accounts@brightwell.example' } },
    { name: 'Ines Duarte', email: 'ines@guests.example', room: '202', arrival: businessDate, departure: addDays(businessDate, 2), plan: 'flex', guests: 1, status: 'booked' },
    { name: 'Priya Raman', email: 'priya@guests.example', room: '302', arrival: businessDate, departure: addDays(businessDate, 1), plan: 'flex', guests: 2, status: 'booked' },
    { name: 'Callum Reyes', email: 'callum@guests.example', room: '105', arrival: addDays(businessDate, 1), departure: addDays(businessDate, 4), plan: 'flex', guests: 3, status: 'booked' },
    { name: 'Hana Sato', email: 'hana@guests.example', room: '304', arrival: addDays(businessDate, 2), departure: addDays(businessDate, 9), plan: 'corp', guests: 2, status: 'booked' },
    { name: 'Sam Whitlock', email: 'sam@guests.example', room: '201', arrival: addDays(businessDate, 3), departure: addDays(businessDate, 5), plan: 'flex', guests: 1, status: 'booked' },
    { name: 'Samuel Whitlock', email: 'samuel@guests.example', room: '204', arrival: addDays(businessDate, -3), departure: addDays(businessDate, -1), plan: 'flex', guests: 1, status: 'checked_out' }
  ];

  for (const stay of stays) {
    const guestId = id('g');
    await client.query(
      'INSERT INTO guests (id, hotel_id, name, email, phone) VALUES ($1,$2,$3,$4,$5)',
      [guestId, hotelId, stay.name, stay.email, '']);
    const stayId = id('s');
    const nights = dateRange(stay.arrival, addDays(stay.departure, -1));
    await client.query(
      `INSERT INTO stays (id, hotel_id, guest_id, rate_plan_id, guests, arrival, departure, status, check_in_night)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [stayId, hotelId, guestId, planIds[stay.plan], stay.guests, stay.arrival, stay.departure, stay.status,
        stay.status === 'in_house' ? stay.arrival : null]);
    const plan = planRows[stay.plan];
    for (const date of nights) {
      const priced = priceNight({ plan, taxRates, date, guests: stay.guests, totalNights: nights.length });
      const posted = stay.status === 'in_house' && date === addDays(businessDate, -1);
      await client.query(
        `INSERT INTO stay_nights (id, stay_id, hotel_id, date, room_id, room_cents, tax_cents, city_tax_cents, posted)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id('n'), stayId, hotelId, date, roomIds[stay.room], priced.roomCents, priced.taxCents, priced.cityTaxCents, posted]);
    }
    await client.query(
      'INSERT INTO stay_segments (id, stay_id, room_id, first_night, nights) VALUES ($1,$2,$3,$4,$5)',
      [id('seg'), stayId, roomIds[stay.room], stay.arrival, nights.length]);
    const folioA = id('f');
    await client.query(
      `INSERT INTO folios (id, hotel_id, stay_id, name, payer_name, payer_email, state, letter)
       VALUES ($1,$2,$3,'Folio A',$4,$5,'open','A')`,
      [folioA, hotelId, stayId, stay.name, stay.email]);
    if (stay.status === 'in_house') {
      // the night D-1 was posted to Folio A by the published rates
      const d1 = addDays(businessDate, -1);
      if (stay.arrival <= d1 && d1 < stay.departure) {
        const nightRow = await client.query(
          'SELECT room_cents, tax_cents, city_tax_cents FROM stay_nights WHERE stay_id = $1 AND date = $2',
          [stayId, d1]);
        const n = nightRow.rows[0];
        await client.query(
          `INSERT INTO entries (id, folio_id, kind, date, description, amount_cents, room_number)
           VALUES ($1,$2,'charge',$3,$4,$5,$6)`,
          [id('e'), folioA, d1, `Room charge, room ${stay.room}`, n.room_cents, stay.room]);
        await client.query(
          `INSERT INTO entries (id, folio_id, kind, date, description, amount_cents, room_number)
           VALUES ($1,$2,'charge',$3,$4,$5,$6)`,
          [id('e'), folioA, d1, `Tax, room ${stay.room}`, n.tax_cents, stay.room]);
        await client.query(
          `INSERT INTO entries (id, folio_id, kind, date, description, amount_cents, room_number)
           VALUES ($1,$2,'charge',$3,$4,$5,$6)`,
          [id('e'), folioA, d1, `City tax, room ${stay.room}`, n.city_tax_cents, stay.room]);
      }
    }
    if (stay.folioB) {
      await client.query(
        `INSERT INTO folios (id, hotel_id, stay_id, name, payer_name, payer_email, state, letter)
         VALUES ($1,$2,$3,'Folio B',$4,$5,'open','B')`,
        [id('f'), hotelId, stayId, stay.folioB.payerName, stay.folioB.payerEmail]);
    }
  }

  // the previous night's close figures feed the tally rail
  const d1 = addDays(businessDate, -1);
  const totalRes = await client.query('SELECT COUNT(*)::int AS n FROM rooms WHERE hotel_id = $1 AND status <> $2', [hotelId, 'out_of_order']);
  const soldRes = await client.query(
    `SELECT COUNT(DISTINCT sn.room_id)::int AS n FROM stay_nights sn JOIN stays s ON s.id = sn.stay_id
     WHERE sn.hotel_id = $1 AND sn.date = $2 AND s.status IN ('booked','in_house')`, [hotelId, d1]);
  const revenueRes = await client.query(
    `SELECT COALESCE(SUM(sn.room_cents),0)::int AS n FROM stay_nights sn JOIN stays s ON s.id = sn.stay_id
     WHERE sn.hotel_id = $1 AND sn.date = $2 AND s.status IN ('booked','in_house')`, [hotelId, d1]);
  await client.query(
    `INSERT INTO closed_nights (hotel_id, date, rooms_available, rooms_sold, room_revenue_cents)
     VALUES ($1,$2,$3,$4,$5)`,
    [hotelId, d1, totalRes.rows[0].n, soldRes.rows[0].n, revenueRes.rows[0].n]);

  // second hotel
  const hotel2 = id('h');
  await client.query(
    'INSERT INTO hotels (id, name, time_zone, business_date) VALUES ($1,$2,$3,$4)',
    [hotel2, 'Quarry Lane Rooms', config.hotelTimeZoneDefault, businessDate]);
  await client.query(
    'INSERT INTO users (id, hotel_id, email, password_hash, name, role) VALUES ($1,$2,$3,$4,$5,$6)',
    [id('u'), hotel2, 'owner@quarrylane.example', hashPassword('quarry-owner-2027'), 'Rue Dain', 'owner']);
  for (const number of ['1', '2']) {
    await client.query(
      'INSERT INTO rooms (id, hotel_id, number, type, status) VALUES ($1,$2,$3,$4,$5)',
      [id('r'), hotel2, number, 'Queen', 'clean']);
  }
}

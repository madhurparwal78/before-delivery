import type { Request, Response } from 'express';
import type pg from 'pg';
import { withTransaction, id } from './db.js';
import { err } from './errors.js';
import { hotelNow } from './guards.js';
import { isValidDate, addDays, dateRange, compareDates } from './dates.js';
import { loadTaxRates, loadPlan, priceNightForStay } from './stays.js';
import { serializeStay } from './serialize.js';
import { publish } from './live.js';
import { StayRow, firstHeldNight, stayNights, staySegments, stayFolios } from './store.js';

async function stayRow(client: pg.PoolClient, hotelId: string, stayId: string): Promise<StayRow> {
  const res = await client.query('SELECT * FROM stays WHERE id = $1 AND hotel_id = $2', [stayId, hotelId]);
  if (!res.rows[0]) throw err.notFound();
  return res.rows[0] as StayRow;
}

export async function getStay(req: Request, res: Response) {
  const user = req.user!;
  const hotel = await hotelNow(user.hotelId);
  const stay = await withTransaction(async client => {
    const row = await stayRow(client, user.hotelId, req.params.id);
    return serializeStay(client, row.id, { businessDate: hotel.businessDate, timeZone: hotel.timeZone, now: hotel.now });
  });
  res.json(stay);
}

export async function patchStay(req: Request, res: Response) {
  const user = req.user!;
  const result = await withTransaction(async client => {
    const hotel = await hotelRow(client, user.hotelId);
    const stay = await stayRow(client, user.hotelId, req.params.id);
    const now = hotel.clock_fixed_at ? new Date(hotel.clock_fixed_at) : new Date();

    // state: cancelled/checked_out/no_show are final and cannot be changed
    if (stay.status === 'cancelled' || stay.status === 'checked_out' || stay.status === 'no_show') {
      throw err.conflict('That stay cannot be moved.');
    }
    if (typeof req.body.version !== 'number' || req.body.version !== stay.version) {
      throw err.conflict('This stay was changed by someone else. It now shows the latest.');
    }

    const inHouse = stay.status === 'in_house';
    const changes: Record<string, unknown> = {};
    const errors: Record<string, string> = {};
    let newArrival = stay.arrival;
    let newDeparture = stay.departure;
    let newGuests = stay.guests;
    let planChanged = false;

    if (req.body.arrival !== undefined) {
      if (inHouse) throw err.conflict('An in-house stay cannot change its arrival.');
      if (typeof req.body.arrival !== 'string' || !isValidDate(req.body.arrival) || req.body.arrival < hotel.business_date) {
        errors.arrival = 'Arrival cannot be before the business date.';
      } else {
        newArrival = req.body.arrival;
        changes.arrival = newArrival;
      }
    }
    if (req.body.departure !== undefined) {
      if (typeof req.body.departure !== 'string' || !isValidDate(req.body.departure)) {
        errors.departure = 'Departure must be after arrival.';
      } else if (newArrival && compareDates(req.body.departure, newArrival) <= 0) {
        errors.departure = 'Departure must be after arrival.';
      } else if (dateRange(newArrival, addDays(req.body.departure, -1)).length > 90) {
        errors.departure = 'Stays are limited to 90 nights.';
      } else if (inHouse && compareDates(req.body.departure, hotel.business_date) < 0) {
        errors.departure = 'Departure cannot be before the business date.';
      } else {
        newDeparture = req.body.departure;
        changes.departure = newDeparture;
      }
    }
    if (req.body.guests !== undefined) {
      if (typeof req.body.guests !== 'number' || !Number.isInteger(req.body.guests) || req.body.guests < 1 || req.body.guests > 6) {
        errors.guests = 'Guests must be between 1 and 6.';
      } else {
        newGuests = req.body.guests;
        changes.guests = newGuests;
      }
    }
    if (req.body.ratePlanId !== undefined) {
      const plan = await loadPlan(client, user.hotelId, req.body.ratePlanId);
      if (!plan) errors.ratePlanId = 'Choose a rate plan.';
      else { changes.rate_plan_id = plan.id; }
    }
    if (Object.keys(errors).length) throw err.validations(errors);

    // Reprice unposted nights
    const nights = await stayNights(client, stay.id);
    const totalNights = dateRange(newArrival, addDays(newDeparture, -1)).length;
    const planId = (changes.rate_plan_id as string) ?? stay.rate_plan_id;
    const plan = await loadPlan(client, user.hotelId, planId);
    const taxRates = await loadTaxRates(client, user.hotelId);

    // Room for new nights: the stay keeps its nights' rooms; new nights go to the room of the previous night's room or the first segment room
    const oldRoomOf = new Map(nights.map(n => [n.date, n.room_id]));
    const segments = await staySegments(client, stay.id);
    const lastRoom = segments[segments.length - 1]?.room_id;

    // delete unposted nights beyond the new range, reprice unposted within
    const newDates = dateRange(newArrival, addDays(newDeparture, -1));
    for (const night of nights) {
      if (night.posted) continue;
      if (!newDates.includes(night.date)) {
        await client.query('DELETE FROM stay_nights WHERE id = $1', [night.id]);
      }
    }
    for (const date of newDates) {
      const existing = nights.find(n => n.date === date);
      if (existing && existing.posted) continue;
      const roomId = oldRoomOf.get(date) ?? lastRoom!;
      const roomRes = await client.query('SELECT number FROM rooms WHERE id = $1', [roomId]);
      const roomNumber = roomRes.rows[0]?.number ?? '';
      const priced = priceNightForStay(plan!, taxRates, date, newGuests, totalNights, roomNumber);
      if (existing) {
        await client.query(
          'UPDATE stay_nights SET room_id=$1, room_cents=$2, tax_cents=$3, city_tax_cents=$4 WHERE id=$5',
          [roomId, priced.roomCents, priced.taxCents, priced.cityTaxCents, existing.id]);
      } else {
        await client.query(
          `INSERT INTO stay_nights (id, stay_id, hotel_id, date, room_id, room_cents, tax_cents, city_tax_cents)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id('n'), stay.id, user.hotelId, date, roomId, priced.roomCents, priced.taxCents, priced.cityTaxCents]);
      }
    }

    // held-night check for nights added/changed
    await client.query('SELECT id FROM rooms WHERE id = $1 FOR UPDATE', [lastRoom!]);
    const held = await firstHeldNight(client, lastRoom!, newDates, stay.id);
    if (held) {
      const roomRes = await client.query('SELECT number FROM rooms WHERE id = $1', [lastRoom!]);
      throw err.conflict(`Room ${roomRes.rows[0].number} is occupied on ${held}.`);
    }

    // rebuild segments from unposted nights (posted nights keep their segments)
    await rebuildSegments(client, stay.id);

    await client.query(
      `UPDATE stays SET arrival=$1, departure=$2, guests=$3, rate_plan_id=$4, version=version+1 WHERE id=$5`,
      [newArrival, newDeparture, newGuests, planId, stay.id]);

    const serialized = await serializeStay(client, stay.id, { businessDate: hotel.business_date, timeZone: hotel.time_zone, now });
    return { serialized, guestName: serialized.guest.name };
  });
  publish(user.hotelId, { type: 'stay', notice: `Stay updated for ${result.guestName}.`, stayId: result.serialized.id });
  res.json(result.serialized);
}

export async function rebuildSegments(client: pg.PoolClient, stayId: string): Promise<void> {
  await client.query('DELETE FROM stay_segments WHERE stay_id = $1', [stayId]);
  const nights = await stayNights(client, stayId);
  const ordered = [...nights].sort((a, b) => compareDates(a.date, b.date));
  let current: { roomId: string; firstNight: string; nights: number } | null = null;
  for (const night of ordered) {
    if (current && current.roomId === night.room_id &&
        addDays(current.firstNight, current.nights) === night.date) {
      current.nights++;
    } else {
      if (current) await insertSegment(client, stayId, current);
      current = { roomId: night.room_id, firstNight: night.date, nights: 1 };
    }
  }
  if (current) await insertSegment(client, stayId, current);
}

async function insertSegment(client: pg.PoolClient, stayId: string, seg: { roomId: string; firstNight: string; nights: number }): Promise<void> {
  await client.query(
    'INSERT INTO stay_segments (id, stay_id, room_id, first_night, nights) VALUES ($1,$2,$3,$4,$5)',
    [id('seg'), stayId, seg.roomId, seg.firstNight, seg.nights]);
}

export async function moveStay(req: Request, res: Response) {
  const user = req.user!;
  const result = await withTransaction(async client => {
    const hotel = await hotelRow(client, user.hotelId);
    const now = hotel.clock_fixed_at ? new Date(hotel.clock_fixed_at) : new Date();
    const stay = await stayRow(client, user.hotelId, req.params.id);

    if (stay.status === 'cancelled' || stay.status === 'checked_out' || stay.status === 'no_show') {
      throw err.conflict('That stay cannot be moved.');
    }
    if (typeof req.body.version !== 'number' || req.body.version !== stay.version) {
      throw err.conflict('This stay was changed by someone else. It now shows the latest.');
    }
    if (typeof req.body.roomId !== 'string' || !req.body.roomId) {
      throw err.validation('roomId', 'Choose a room.');
    }
    const roomRes = await client.query('SELECT * FROM rooms WHERE id = $1 AND hotel_id = $2', [req.body.roomId, user.hotelId]);
    const room = roomRes.rows[0];
    if (!room) throw err.validation('roomId', 'Choose a room.');
    await client.query('SELECT id FROM rooms WHERE id = $1 FOR UPDATE', [room.id]);

    const sendsArrival = req.body.arrival !== undefined;
    const sendsFromNight = req.body.fromNight !== undefined && req.body.fromNight !== null && req.body.fromNight !== '';
    if (sendsArrival && sendsFromNight) {
      throw err.validation('arrival', 'Send arrival or fromNight, not both.');
    }

    const nights = await stayNights(client, stay.id);
    const ordered = [...nights].sort((a, b) => compareDates(a.date, b.date));

    if (sendsArrival) {
      // booked only
      if (stay.status !== 'booked') {
        throw err.validation('arrival', 'Only a booked stay can change its dates this way.');
      }
      const newArrival = req.body.arrival as string;
      if (!isValidDate(newArrival) || newArrival < hotel.business_date) {
        throw err.validation('arrival', 'Arrival cannot be before the business date.');
      }
      const stayNightsCount = ordered.length;
      const newDeparture = addDays(newArrival, stayNightsCount);
      const newDates = dateRange(newArrival, addDays(newDeparture, -1));
      const held = await firstHeldNight(client, room.id, newDates, stay.id);
      if (held) throw err.conflict(`Room ${room.number} is occupied on ${held}.`);
      const plan = await loadPlan(client, user.hotelId, stay.rate_plan_id);
      const taxRates = await loadTaxRates(client, user.hotelId);
      // delete all unposted nights and recreate with new dates (booked stays have no posted nights)
      for (const night of ordered) {
        if (!night.posted) await client.query('DELETE FROM stay_nights WHERE id = $1', [night.id]);
      }
      for (const date of newDates) {
        const priced = priceNightForStay(plan!, taxRates, date, stay.guests, stayNightsCount, room.number);
        await client.query(
          `INSERT INTO stay_nights (id, stay_id, hotel_id, date, room_id, room_cents, tax_cents, city_tax_cents)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id('n'), stay.id, date, room.id, priced.roomCents, priced.taxCents, priced.cityTaxCents]);
      }
      await client.query('UPDATE stays SET arrival=$1, departure=$2, version=version+1 WHERE id=$3',
        [newArrival, newDeparture, stay.id]);
    } else {
      // fromNight move or whole-stay move
      let fromNight: string;
      if (sendsFromNight) {
        fromNight = req.body.fromNight as string;
        if (!isValidDate(fromNight)) {
          throw err.validation('fromNight', 'Choose a night of this stay that is not before the business date.');
        }
      } else {
        fromNight = stay.status === 'in_house' ? hotel.business_date : stay.arrival;
      }
      const inHouse = stay.status === 'in_house';
      const minNight = inHouse ? hotel.business_date : stay.arrival;
      if (compareDates(fromNight, minNight) < 0) {
        throw err.validation('fromNight', 'Choose a night of this stay that is not before the business date.');
      }
      const hasNight = ordered.some(n => n.date === fromNight);
      if (!hasNight) {
        throw err.validation('fromNight', 'Choose a night of this stay that is not before the business date.');
      }
      if (inHouse && ordered.every(n => n.date < hotel.business_date)) {
        throw err.validation('fromNight', 'Choose a night of this stay that is not before the business date.');
      }
      // Room status guard for in-house move from the business date
      if (inHouse && compareDates(fromNight, hotel.business_date) === 0) {
        if (room.status !== 'clean' && room.status !== 'inspected') {
          throw err.conflict(`Room ${room.number} is ${room.status === 'out_of_order' ? 'out of order' : room.status} and cannot take an in-house guest.`);
        }
      }
      const moving = ordered.filter(n => compareDates(n.date, fromNight) >= 0 && !n.posted);
      if (moving.length === 0) {
        throw err.validation('fromNight', 'Choose a night of this stay that is not before the business date.');
      }
      const held = await firstHeldNight(client, room.id, moving.map(n => n.date), stay.id);
      if (held) throw err.conflict(`Room ${room.number} is occupied on ${held}.`);
      for (const night of moving) {
        await client.query('UPDATE stay_nights SET room_id=$1 WHERE id=$2', [room.id, night.id]);
      }
      if (inHouse && compareDates(fromNight, hotel.business_date) === 0) {
        // the room being left becomes dirty
        const oldRoomId = ordered.find(n => compareDates(n.date, hotel.business_date) === 0)?.room_id;
        if (oldRoomId && oldRoomId !== room.id) {
          await client.query(`UPDATE rooms SET status='dirty' WHERE id=$1`, [oldRoomId]);
          const oldRoomRes = await client.query('SELECT number FROM rooms WHERE id = $1', [oldRoomId]);
          const oldNumber = oldRoomRes.rows[0]?.number ?? '';
          publish(user.hotelId, { type: 'room', roomId: oldRoomId, notice: `Room ${oldNumber} is now dirty.`, number: oldNumber, status: 'dirty', arrival: null, departure: null });
        }
      }
      await client.query('UPDATE stays SET version=version+1 WHERE id=$1', [stay.id]);
    }

    await rebuildSegments(client, stay.id);
    const serialized = await serializeStay(client, stay.id, { businessDate: hotel.business_date, timeZone: hotel.time_zone, now });
    const roomNumber = serialized.segments[serialized.segments.length - 1]?.roomNumber ?? room.number;
    return { serialized, roomNumber };
  });
  publish(user.hotelId, { type: 'stay', notice: `Moved ${result.serialized.guest.name} to room ${result.roomNumber}.`, stayId: result.serialized.id });
  res.json(result.serialized);
}

export async function checkIn(req: Request, res: Response) {
  const user = req.user!;
  const result = await withTransaction(async client => {
    const hotel = await hotelRow(client, user.hotelId);
    const now = hotel.clock_fixed_at ? new Date(hotel.clock_fixed_at) : new Date();
    const stay = await stayRow(client, user.hotelId, req.params.id);
    if (stay.status !== 'booked') {
      throw err.conflict('This stay cannot be checked in.');
    }
    if (stay.arrival !== hotel.business_date) {
      throw err.conflict(`This stay arrives on ${stay.arrival}, not on business date ${hotel.business_date}.`);
    }
    const nights = await stayNights(client, stay.id);
    const night = nights.find(n => n.date === hotel.business_date);
    if (!night) throw err.conflict('This stay cannot be checked in.');
    const roomRes = await client.query('SELECT * FROM rooms WHERE id = $1', [night.room_id]);
    const room = roomRes.rows[0];
    if (room.status !== 'clean' && room.status !== 'inspected') {
      throw err.conflict(`Room ${room.number} is ${room.status === 'out_of_order' ? 'out of order' : room.status} and cannot be checked in.`);
    }
    await client.query(
      `UPDATE stays SET status='in_house', version=version+1, check_in_night=$1 WHERE id=$2`,
      [hotel.business_date, stay.id]);
    const serialized = await serializeStay(client, stay.id, { businessDate: hotel.business_date, timeZone: hotel.time_zone, now });
    return { serialized, roomNumber: room.number };
  });
  publish(user.hotelId, { type: 'stay', notice: `Checked in ${result.serialized.guest.name} to room ${result.roomNumber}.`, stayId: result.serialized.id });
  res.json(result.serialized);
}

export async function checkOut(req: Request, res: Response) {
  const user = req.user!;
  const result = await withTransaction(async client => {
    const hotel = await hotelRow(client, user.hotelId);
    const now = hotel.clock_fixed_at ? new Date(hotel.clock_fixed_at) : new Date();
    const stay = await stayRow(client, user.hotelId, req.params.id);
    if (stay.status !== 'in_house') {
      throw err.conflict('This stay cannot be checked out.');
    }
    if (compareDates(stay.departure, hotel.business_date) > 0) {
      throw err.conflict(`This stay departs on ${stay.departure}. Change its dates before checking out early.`);
    }
    const segments = await staySegments(client, stay.id);
    const lastRoomId = segments[segments.length - 1]?.room_id;
    await client.query(`UPDATE stays SET status='checked_out', version=version+1 WHERE id=$1`, [stay.id]);
    if (lastRoomId) {
      await client.query(`UPDATE rooms SET status='dirty' WHERE id=$1`, [lastRoomId]);
      const roomRes = await client.query('SELECT number FROM rooms WHERE id = $1', [lastRoomId]);
      const number = roomRes.rows[0]?.number ?? '';
      publish(user.hotelId, { type: 'room', roomId: lastRoomId, notice: `Room ${number} is now dirty.`, number, status: 'dirty', arrival: null, departure: null });
    }
    const serialized = await serializeStay(client, stay.id, { businessDate: hotel.business_date, timeZone: hotel.time_zone, now });
    return { serialized, roomNumber: serialized.segments[serialized.segments.length - 1]?.roomNumber ?? '' };
  });
  publish(user.hotelId, { type: 'stay', notice: `Checked out ${result.serialized.guest.name} from room ${result.roomNumber}.`, stayId: result.serialized.id });
  res.json(result.serialized);
}

export async function cancelStay(req: Request, res: Response) {
  const user = req.user!;
  const result = await withTransaction(async client => {
    const hotel = await hotelRow(client, user.hotelId);
    const now = hotel.clock_fixed_at ? new Date(hotel.clock_fixed_at) : new Date();
    const stay = await stayRow(client, user.hotelId, req.params.id);
    if (stay.status !== 'booked') {
      throw err.conflict('This stay can no longer be cancelled.');
    }
    const nights = await stayNights(client, stay.id);
    const ordered = [...nights].sort((a, b) => compareDates(a.date, b.date));
    const first = ordered[0];
    const { localEvening } = await import('./dates.js');
    const deadline = localEvening(addDays(first.date, -1), hotel.time_zone);
    const fee = now.getTime() >= deadline.getTime() ? first.room_cents + first.tax_cents + first.city_tax_cents : 0;

    await client.query(`UPDATE stays SET status='cancelled', version=version+1 WHERE id=$1`, [stay.id]);
    await client.query('DELETE FROM stay_nights WHERE stay_id = $1', [stay.id]);
    await client.query('UPDATE checkin_tokens SET accepted_at = $1 WHERE stay_id = $2 AND accepted_at IS NULL', [now, stay.id]);

    if (fee > 0) {
      const folios = await stayFolios(client, stay.id);
      const open = folios.find(f => f.state === 'open');
      let folioId = open?.id;
      if (!folioId) {
        const { nextFolioLetter } = await import('./store.js');
        const letter = nextFolioLetter(folios.map(f => f.letter));
        folioId = id('f');
        const guestRes = await client.query('SELECT name, email FROM guests WHERE id = $1', [stay.guest_id]);
        await client.query(
          `INSERT INTO folios (id, hotel_id, stay_id, name, payer_name, payer_email, state, letter)
           VALUES ($1,$2,$3,$4,$5,$6,'open',$7)`,
          [folioId, user.hotelId, stay.id, `Folio ${letter}`, guestRes.rows[0].name, guestRes.rows[0].email, letter]);
      }
      const roomNumRes = await client.query('SELECT number FROM rooms WHERE id = $1', [first.room_id]);
      await client.query(
        `INSERT INTO entries (id, folio_id, kind, date, description, amount_cents, room_number)
         VALUES ($1,$2,'charge',$3,'Late cancellation fee',$4,$5)`,
        [id('e'), folioId, hotel.business_date, fee, roomNumRes.rows[0].number]);
    }
    const serialized = await serializeStay(client, stay.id, { businessDate: hotel.business_date, timeZone: hotel.time_zone, now });
    return { serialized, fee };
  });
  const feeText = result.fee > 0 ? ` Fee: $${(result.fee / 100).toFixed(2)}.` : ' No fee.';
  publish(user.hotelId, { type: 'stay', notice: `Cancelled ${result.serialized.guest.name}'s stay.${feeText}`, stayId: result.serialized.id });
  res.json(result.serialized);
}

export async function resendLink(req: Request, res: Response) {
  const user = req.user!;
  const { serialized, sent, notice } = await withTransaction(async client => {
    const hotel = await hotelRow(client, user.hotelId);
    const now = hotel.clock_fixed_at ? new Date(hotel.clock_fixed_at) : new Date();
    const stay = await stayRow(client, user.hotelId, req.params.id);
    if (stay.status !== 'booked' || stay.checked_in_online) {
      throw err.conflict('This stay is no longer waiting for check-in.');
    }
    const guestRes = await client.query('SELECT email FROM guests WHERE id = $1', [stay.guest_id]);
    const { issueCheckinLink } = await import('./stays.js');
    const origin = `${req.protocol}://${req.get('host') ?? 'localhost:4173'}`;
    const link = await issueCheckinLink(client, stay.id, guestRes.rows[0].email, hotel.name, now, origin);
    if (!link.sent) {
      // the new link replaces the old only once the provider accepts it
      await client.query('DELETE FROM checkin_tokens WHERE stay_id = $1 AND mail_sent = FALSE', [stay.id]);
      throw err.unavailable('The check-in link could not be sent. The mail service is unavailable.');
    }
    const serialized = await serializeStay(client, stay.id, { businessDate: hotel.business_date, timeZone: hotel.time_zone, now });
    return { serialized, sent: link.sent, notice: link.notice };
  });
  if (!sent) throw err.unavailable(notice ?? 'The check-in link could not be sent. The mail service is unavailable.');
  publish(user.hotelId, { type: 'stay', notice: `Check-in link sent to ${serialized.guest.name}.`, stayId: serialized.id });
  res.json(serialized);
}

async function hotelRow(client: pg.PoolClient, hotelId: string) {
  const res = await client.query('SELECT * FROM hotels WHERE id = $1', [hotelId]);
  const row = res.rows[0];
  if (!row) throw err.notFound();
  return row as { id: string; name: string; time_zone: string; business_date: string; clock_fixed_at: Date | null };
}

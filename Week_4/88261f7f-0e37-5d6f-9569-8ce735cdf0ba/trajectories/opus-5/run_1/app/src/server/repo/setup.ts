import { randomUUID } from 'node:crypto';
import { Db } from '../db';
import { config } from '../config';
import { dateRange, daysBetween, isPlainDate, PlainDate } from '../../shared/dates';
import { isTimeZone, nightOf } from '../domain/clock';
import { priceRoomNights } from '../domain/pricing';
import { DEFAULT_TAX_PERCENT, isTaxPercentText } from '../../shared/rates';
import { isRole, Role } from '../domain/roles';
import { isRoomStatus, RoomStatus } from '../../shared/roomStatus';
import { isStayStatus, StayStatus } from '../domain/stayState';
import { hashPassword } from '../http/session';
import { firstHeldNight, replaceSegments } from './stays';
import { roomSortKey } from './hotels';
import { LETTERS } from '../../shared/folioNames';

/** A setup body the grading route refuses. */
export class SetupError extends Error {}

function fail(message: string): never {
  throw new SetupError(message);
}

interface Spec {
  hotel: { name: string; timeZone?: string; businessDate?: string; now?: string | null };
  users?: Array<{ key: string; email: string; password: string; name: string; role: string }>;
  rooms?: Array<{ key: string; number: string; type?: string; status?: string }>;
  ratePlans?: Array<{ key: string; name: string; weeknightCents: number; weekendCents: number }>;
  taxRates?: Array<{ percent: string; startDate: string }>;
  guests?: Array<{
    key: string;
    name: string;
    email?: string;
    phone?: string;
    company?: string;
    address?: string;
  }>;
  stays?: Array<{
    key: string;
    room: string;
    guest: string;
    ratePlan: string;
    arrival: string;
    departure: string;
    guests?: number;
    status?: string;
    checkinLink?: boolean;
  }>;
  folios?: Array<{
    key: string;
    stay: string;
    name?: string;
    payerName?: string;
    payerEmail?: string;
    entries?: Array<{
      key: string;
      kind: string;
      date: string;
      description: string;
      amountCents: number;
      roomNumber?: string;
    }>;
  }>;
}

export interface SetupIds {
  hotelId: string;
  users: Record<string, string>;
  rooms: Record<string, string>;
  ratePlans: Record<string, string>;
  guests: Record<string, string>;
  stays: Record<string, string>;
  folios: Record<string, string>;
  entries: Record<string, string>;
}

const DEFAULT_RATE_PLANS = [
  { name: 'Flexible', weeknightCents: 12000, weekendCents: 15000 },
  { name: 'Corporate', weeknightCents: 12040, weekendCents: 12040 },
];

function lookup(map: Record<string, string>, key: unknown, what: string): string {
  if (typeof key !== 'string' || !(key in map)) fail(`Unknown ${what} reference.`);
  return map[key as string];
}

function readDate(value: unknown, what: string): PlainDate {
  if (!isPlainDate(value)) fail(`Enter a valid ${what}.`);
  return value as PlainDate;
}

export async function createHotelFromSpec(db: Db, raw: unknown): Promise<SetupIds> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail('Send a setup body.');
  const spec = raw as Spec;
  if (!spec.hotel || typeof spec.hotel.name !== 'string' || spec.hotel.name.trim() === '') {
    fail('Enter the hotel name.');
  }
  const timeZone = spec.hotel.timeZone ?? config.hotelTimeZoneDefault;
  if (!isTimeZone(timeZone)) fail('Enter a valid time zone.');
  const nowText = spec.hotel.now ?? null;
  let clockNow: Date | null = null;
  if (nowText !== null) {
    const parsed = new Date(nowText);
    if (Number.isNaN(parsed.getTime())) fail('Enter a valid now.');
    clockNow = parsed;
  }
  const businessDate =
    spec.hotel.businessDate === undefined
      ? nightOf(timeZone, clockNow ?? new Date())
      : readDate(spec.hotel.businessDate, 'businessDate');

  const hotelId = randomUUID();
  await db.query(
    'insert into hotels (id, name, time_zone, business_date, clock_now) values ($1,$2,$3,$4,$5)',
    [hotelId, spec.hotel.name, timeZone, businessDate, clockNow],
  );

  const ids: SetupIds = {
    hotelId,
    users: {},
    rooms: {},
    ratePlans: {},
    guests: {},
    stays: {},
    folios: {},
    entries: {},
  };

  for (const user of spec.users ?? []) {
    if (!isRole(user.role)) fail('Enter a valid role.');
    const id = randomUUID();
    await db.query(
      'insert into users (id, hotel_id, email, password_hash, name, role) values ($1,$2,$3,$4,$5,$6)',
      [id, hotelId, user.email, hashPassword(user.password), user.name, user.role as Role],
    );
    ids.users[user.key] = id;
  }

  for (const room of spec.rooms ?? []) {
    const status = room.status ?? 'clean';
    if (!isRoomStatus(status)) fail('Enter a valid room status.');
    const id = randomUUID();
    await db.query(
      'insert into rooms (id, hotel_id, number, type, status, sort_key) values ($1,$2,$3,$4,$5,$6)',
      [id, hotelId, room.number, room.type ?? 'Queen', status as RoomStatus, roomSortKey(room.number)],
    );
    ids.rooms[room.key] = id;
  }

  const plans = spec.ratePlans ?? DEFAULT_RATE_PLANS.map((plan, index) => ({
    key: `plan${index}`,
    ...plan,
  }));
  let ord = 0;
  for (const plan of plans) {
    const id = randomUUID();
    await db.query(
      'insert into rate_plans (id, hotel_id, name, weeknight_cents, weekend_cents, ord) values ($1,$2,$3,$4,$5,$6)',
      [id, hotelId, plan.name, plan.weeknightCents, plan.weekendCents, ord],
    );
    ids.ratePlans[plan.key] = id;
    ord += 1;
  }

  await db.query(
    'insert into tax_rates (id, hotel_id, percent, start_date) values ($1,$2,$3,null)',
    [randomUUID(), hotelId, DEFAULT_TAX_PERCENT],
  );
  for (const rate of spec.taxRates ?? []) {
    if (!isTaxPercentText(String(rate.percent))) fail('Enter a valid tax rate.');
    await db.query(
      `insert into tax_rates (id, hotel_id, percent, start_date) values ($1,$2,$3,$4)
       on conflict (hotel_id, start_date) do update set percent = excluded.percent`,
      [randomUUID(), hotelId, String(rate.percent), readDate(rate.startDate, 'startDate')],
    );
  }

  for (const guest of spec.guests ?? []) {
    const id = randomUUID();
    await db.query(
      'insert into guests (id, hotel_id, name, email, phone, company, address) values ($1,$2,$3,$4,$5,$6,$7)',
      [
        id,
        hotelId,
        guest.name,
        guest.email ?? '',
        guest.phone ?? '',
        guest.company ?? '',
        guest.address ?? '',
      ],
    );
    ids.guests[guest.key] = id;
  }

  const planPrices = new Map<string, { weeknightCents: number; weekendCents: number }>();
  for (const plan of plans) {
    planPrices.set(ids.ratePlans[plan.key], {
      weeknightCents: plan.weeknightCents,
      weekendCents: plan.weekendCents,
    });
  }

  const foliosByStay = new Map<string, NonNullable<Spec['folios']>>();
  for (const folio of spec.folios ?? []) {
    const list = foliosByStay.get(folio.stay) ?? [];
    list.push(folio);
    foliosByStay.set(folio.stay, list);
  }

  for (const stay of spec.stays ?? []) {
    const roomId = lookup(ids.rooms, stay.room, 'room');
    const guestId = lookup(ids.guests, stay.guest, 'guest');
    const ratePlanId = lookup(ids.ratePlans, stay.ratePlan, 'rate plan');
    const arrival = readDate(stay.arrival, 'arrival');
    const departure = readDate(stay.departure, 'departure');
    if (departure <= arrival) fail('Departure must be after arrival.');
    const status = (stay.status ?? 'booked') as StayStatus;
    if (!isStayStatus(status)) fail('Enter a valid stay status.');
    const guests = stay.guests ?? 1;
    const nights = daysBetween(arrival, departure);
    const stayId = randomUUID();

    if (status === 'booked' || status === 'in_house' || status === 'checked_out') {
      const held = await firstHeldNight(db, roomId, dateRange(arrival, nights), null);
      if (held !== null) fail(`Room is already held on ${held}.`);
    }

    await db.query(
      `insert into stays (id, hotel_id, guest_id, rate_plan_id, guests, arrival, departure, status,
                          check_in_night)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        stayId,
        hotelId,
        guestId,
        ratePlanId,
        guests,
        arrival,
        departure,
        status,
        status === 'in_house' || status === 'checked_out' ? arrival : null,
      ],
    );
    await replaceSegments(db, stayId, [{ roomId, firstNight: arrival, nights }]);
    const prices = planPrices.get(ratePlanId);
    if (prices) {
      for (const night of priceRoomNights(prices, arrival, nights, guests)) {
        await db.query(
          'insert into stay_nights (stay_id, date, room_cents, posted) values ($1,$2,$3,false)',
          [stayId, night.date, night.roomCents],
        );
      }
    }
    ids.stays[stay.key] = stayId;

    const listed = foliosByStay.get(stay.key) ?? [];
    if (listed.length === 0) {
      const guest = await db.query<{ name: string; email: string }>(
        'select name, email from guests where id = $1',
        [guestId],
      );
      await db.query(
        `insert into folios (id, stay_id, name, payer_name, payer_email, state, ord)
         values ($1,$2,'Folio A',$3,$4,'open',0)`,
        [randomUUID(), stayId, guest.rows[0]?.name ?? '', guest.rows[0]?.email ?? ''],
      );
      continue;
    }
    for (const folio of listed) {
      const name = folio.name ?? 'Folio A';
      const letterIndex = LETTERS.indexOf(name.replace('Folio ', ''));
      if (letterIndex < 0) fail('Enter a valid folio name.');
      const folioId = randomUUID();
      await db.query(
        `insert into folios (id, stay_id, name, payer_name, payer_email, state, ord)
         values ($1,$2,$3,$4,$5,'open',$6)`,
        [folioId, stayId, name, folio.payerName ?? '', folio.payerEmail ?? '', letterIndex],
      );
      ids.folios[folio.key] = folioId;
      for (const entry of folio.entries ?? []) {
        if (entry.kind !== 'charge' && entry.kind !== 'payment') fail('Enter a valid entry kind.');
        const entryId = randomUUID();
        await db.query(
          `insert into entries (id, folio_id, kind, date, description, amount_cents, room_number)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [
            entryId,
            folioId,
            entry.kind,
            readDate(entry.date, 'entry date'),
            entry.description,
            entry.amountCents,
            entry.roomNumber ?? null,
          ],
        );
        ids.entries[entry.key] = entryId;
      }
    }
  }

  return ids;
}

export function staysNeedingLink(raw: unknown): string[] {
  if (raw === null || typeof raw !== 'object') return [];
  const spec = raw as Spec;
  return (spec.stays ?? []).filter((stay) => stay.checkinLink === true).map((stay) => stay.key);
}

import { one, withTransaction } from './db';
import { config } from './config';
import { addDays, PlainDate } from '../shared/dates';
import { nightOf } from './domain/clock';
import { completeNights, segmentsOf, storedNights } from './repo/stays';
import { entryDescriptions, insertEntry } from './repo/folios';
import { createHotelFromSpec } from './repo/setup';
import { listTaxRates } from './repo/hotels';
import { nightTally } from './repo/reports';

const SEED_FLAG = 'seed-applied';

function larkspurSpec(businessDate: PlainDate): Record<string, unknown> {
  const day = (offset: number): PlainDate => addDays(businessDate, offset);
  return {
    hotel: {
      name: 'The Larkspur Inn',
      timeZone: config.hotelTimeZoneDefault,
      businessDate,
    },
    users: [
      {
        key: 'owner',
        email: 'owner@larkspur.example',
        password: 'night-owner-2027',
        name: 'Wren Abara',
        role: 'owner',
      },
      {
        key: 'desk',
        email: 'desk@larkspur.example',
        password: 'night-desk-2027',
        name: 'Theo Marsh',
        role: 'front_desk',
      },
      {
        key: 'desk2',
        email: 'desk2@larkspur.example',
        password: 'night-desk2-2027',
        name: 'Lena Fisk',
        role: 'front_desk',
      },
      {
        key: 'rooms',
        email: 'rooms@larkspur.example',
        password: 'night-rooms-2027',
        name: 'Ivo Pell',
        role: 'housekeeper',
      },
    ],
    rooms: [
      { key: 'r101', number: '101', type: 'Queen' },
      { key: 'r102', number: '102', type: 'Queen' },
      { key: 'r103', number: '103', type: 'King' },
      { key: 'r104', number: '104', type: 'King', status: 'dirty' },
      { key: 'r105', number: '105', type: 'Twin' },
      { key: 'r201', number: '201', type: 'Queen' },
      { key: 'r202', number: '202', type: 'Queen' },
      { key: 'r203', number: '203', type: 'King' },
      { key: 'r204', number: '204', type: 'Twin' },
      { key: 'r205', number: '205', type: 'Suite', status: 'out_of_order' },
      { key: 'r301', number: '301', type: 'Queen', status: 'inspected' },
      { key: 'r302', number: '302', type: 'King' },
      { key: 'r303', number: '303', type: 'King' },
      { key: 'r304', number: '304', type: 'Suite' },
    ],
    guests: [
      { key: 'mara', name: 'Mara Okafor', email: 'mara@guests.example', phone: '+1 555 0111' },
      {
        key: 'tomas',
        name: 'Tomas Lindqvist',
        email: 'tomas@guests.example',
        phone: '+1 555 0112',
        company: 'Brightwell Surveying Ltd',
      },
      { key: 'ines', name: 'Ines Duarte', email: 'ines@guests.example', phone: '+1 555 0113' },
      { key: 'priya', name: 'Priya Raman', email: 'priya@guests.example', phone: '+1 555 0114' },
      { key: 'callum', name: 'Callum Reyes', email: 'callum@guests.example', phone: '+1 555 0115' },
      { key: 'hana', name: 'Hana Sato', email: 'hana@guests.example', phone: '+1 555 0116' },
      { key: 'sam', name: 'Sam Whitlock', email: 'sam@guests.example', phone: '+1 555 0117' },
      {
        key: 'samuel',
        name: 'Samuel Whitlock',
        email: 'samuel@guests.example',
        phone: '+1 555 0118',
      },
    ],
    stays: [
      {
        key: 'mara',
        room: 'r101',
        guest: 'mara',
        ratePlan: 'plan0',
        arrival: day(-1),
        departure: day(2),
        guests: 2,
        status: 'in_house',
      },
      {
        key: 'tomas',
        room: 'r103',
        guest: 'tomas',
        ratePlan: 'plan1',
        arrival: day(-1),
        departure: day(1),
        guests: 1,
        status: 'in_house',
      },
      {
        key: 'ines',
        room: 'r202',
        guest: 'ines',
        ratePlan: 'plan0',
        arrival: day(0),
        departure: day(2),
        guests: 1,
        status: 'booked',
      },
      {
        key: 'priya',
        room: 'r302',
        guest: 'priya',
        ratePlan: 'plan0',
        arrival: day(0),
        departure: day(1),
        guests: 2,
        status: 'booked',
      },
      {
        key: 'callum',
        room: 'r105',
        guest: 'callum',
        ratePlan: 'plan0',
        arrival: day(1),
        departure: day(4),
        guests: 3,
        status: 'booked',
      },
      {
        key: 'hana',
        room: 'r304',
        guest: 'hana',
        ratePlan: 'plan1',
        arrival: day(2),
        departure: day(9),
        guests: 2,
        status: 'booked',
      },
      {
        key: 'sam',
        room: 'r201',
        guest: 'sam',
        ratePlan: 'plan0',
        arrival: day(3),
        departure: day(5),
        guests: 1,
        status: 'booked',
      },
      {
        key: 'samuel',
        room: 'r204',
        guest: 'samuel',
        ratePlan: 'plan0',
        arrival: day(-3),
        departure: day(-1),
        guests: 1,
        status: 'checked_out',
      },
    ],
    folios: [
      {
        key: 'maraA',
        stay: 'mara',
        name: 'Folio A',
        payerName: 'Mara Okafor',
        payerEmail: 'mara@guests.example',
      },
      {
        key: 'tomasA',
        stay: 'tomas',
        name: 'Folio A',
        payerName: 'Tomas Lindqvist',
        payerEmail: 'tomas@guests.example',
      },
      {
        key: 'tomasB',
        stay: 'tomas',
        name: 'Folio B',
        payerName: 'Brightwell Surveying Ltd',
        payerEmail: 'accounts@brightwell.example',
      },
    ],
    secondHotel: {
      hotel: { name: 'Quarry Lane Rooms', timeZone: config.hotelTimeZoneDefault, businessDate },
      users: [
        {
          key: 'owner',
          email: 'owner@quarrylane.example',
          password: 'quarry-owner-2027',
          name: 'Dara Finch',
          role: 'owner',
        },
      ],
      rooms: [
        { key: 'r1', number: '1', type: 'Queen' },
        { key: 'r2', number: '2', type: 'Queen' },
      ],
    },
  };
}

/** Applies the first-look data once, leaving existing records alone at later starts. */
export async function applySeed(): Promise<void> {
  await withTransaction(async (db) => {
    const claimed = await one<{ name: string }>(
      db,
      'insert into app_flags (name) values ($1) on conflict (name) do nothing returning name',
      [SEED_FLAG],
    );
    if (!claimed) return;

    const businessDate = nightOf(config.hotelTimeZoneDefault, new Date());
    const spec = larkspurSpec(businessDate);
    const ids = await createHotelFromSpec(db, spec);
    const second = spec.secondHotel;
    if (second) await createHotelFromSpec(db, second);

    const closedNight = addDays(businessDate, -1);
    const taxRates = await listTaxRates(db, ids.hotelId);
    for (const stayKey of ['mara', 'tomas']) {
      const stayId = ids.stays[stayKey];
      const folioId = ids.folios[`${stayKey}A`];
      const segments = await segmentsOf(db, stayId);
      const stored = await storedNights(db, stayId);
      const night = stored.find((candidate) => candidate.date === closedNight);
      if (!night) continue;
      const stay = await one<{ guests: number }>(db, 'select guests from stays where id = $1', [
        stayId,
      ]);
      const completed = completeNights([night], segments, stay ? stay.guests : 1, taxRates)[0];
      const roomNumber = completed.roomNumber;
      await insertEntry(db, {
        folioId,
        kind: 'charge',
        date: closedNight,
        description: entryDescriptions.roomCharge(roomNumber),
        amountCents: completed.roomCents,
        roomNumber,
      });
      await insertEntry(db, {
        folioId,
        kind: 'charge',
        date: closedNight,
        description: entryDescriptions.tax(roomNumber),
        amountCents: completed.taxCents,
        roomNumber,
      });
      await insertEntry(db, {
        folioId,
        kind: 'charge',
        date: closedNight,
        description: entryDescriptions.cityTax(roomNumber),
        amountCents: completed.cityTaxCents,
        roomNumber,
      });
      await db.query(
        `update stay_nights set posted = true, posted_tax_cents = $3, posted_city_tax_cents = $4
          where stay_id = $1 and date = $2`,
        [stayId, closedNight, completed.taxCents, completed.cityTaxCents],
      );
      await db.query(
        `insert into close_rows (hotel_id, date, room_id, room_number, stay_id, posted_cents)
         values ($1,$2,$3,$4,$5,$6)`,
        [
          ids.hotelId,
          closedNight,
          segments[0].roomId,
          roomNumber,
          stayId,
          completed.roomCents + completed.taxCents + completed.cityTaxCents,
        ],
      );
    }

    const tally = await nightTally(db, ids.hotelId, closedNight);
    await db.query(
      `insert into closed_days (hotel_id, date, rooms_available, rooms_sold, room_revenue_cents,
                                rooms_charged, no_shows)
       values ($1,$2,$3,$4,$5,2,0)`,
      [
        ids.hotelId,
        closedNight,
        tally.roomsAvailable,
        tally.roomsSold,
        tally.roomRevenueCents,
      ],
    );
  });
}

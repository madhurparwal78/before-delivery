import { segmentPriceCents } from '../shared/pricing.js';
import { randomUUID } from 'node:crypto';
import { now } from './clock.js';
import { db, withTransaction, type Queryable } from './db.js';
import type { City } from '../shared/cities.js';
import { routeKm, routeStops } from './domain/route.js';

import { fromZoned, isoZoned } from './domain/time.js';
import { dateLabel } from '../shared/zoned.js';
import * as ledger from './domain/ledger.js';
import { insertRide } from './actions/rides.js';
import { boardingTimeOf, loadRide, type RideRecord } from './model.js';

interface SeedMember {
  displayName: string;
  email: string;
  roles: string[];
  idState: string;
  topUpCents: number;
}

const MEMBERS: SeedMember[] = [
  {
    displayName: 'Wren Halloway',
    email: 'founder@longseat.test',
    roles: ['founder'],
    idState: 'verified',
    topUpCents: 0,
  },
  {
    displayName: 'Mara Quell',
    email: 'mara@longseat.test',
    roles: ['driver', 'passenger'],
    idState: 'verified',
    topUpCents: 0,
  },
  {
    displayName: 'Idris Penhallow',
    email: 'idris@longseat.test',
    roles: ['driver', 'passenger'],
    idState: 'verified',
    topUpCents: 0,
  },
  {
    displayName: 'Lune Ostrander',
    email: 'lune@longseat.test',
    roles: ['driver', 'passenger'],
    idState: 'none',
    topUpCents: 6000,
  },
  {
    displayName: 'Tobin Areck',
    email: 'tobin@longseat.test',
    roles: ['driver', 'passenger'],
    idState: 'none',
    topUpCents: 4000,
  },
];

async function addMember(tx: Queryable, member: SeedMember, at: Date): Promise<string> {
  const id = randomUUID();
  await tx.query(
    `insert into members (id, display_name, email, roles, id_state, created_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, member.displayName, member.email, member.roles, member.idState, at],
  );
  if (member.topUpCents > 0) await ledger.topUp(tx, at, id, member.topUpCents);
  return id;
}

async function addVehicle(
  tx: Queryable,
  ownerId: string,
  makeModel: string,
  colour: string,
  seats: number,
  at: Date,
): Promise<string> {
  const id = randomUUID();
  await tx.query(
    `insert into vehicles (id, owner_id, make_model, colour, seats, created_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, ownerId, makeModel, colour, seats, at],
  );
  return id;
}

async function addRide(
  tx: Queryable,
  driverId: string,
  vehicleId: string,
  cities: City[],
  departure: Date,
  seats: number,
  priceCents: number,
  mode: 'instant' | 'request',
): Promise<string> {
  return insertRide(
    tx,
    { driverId, vehicleId, cities, departure, seats, priceCents, bookingMode: mode },
    routeKm(cities),
    routeStops(cities),
  );
}

/** The demo network, written once when the database holds no members. */
export async function seedIfEmpty(): Promise<void> {
  const { rows } = await db.query<{ count: number }>(
    'select count(*)::int as count from members',
  );
  if (Number(rows[0]?.count ?? 0) > 0) return;

  await withTransaction(async (tx) => {
    const at = now();
    const ids = new Map<string, string>();
    for (const member of MEMBERS) {
      ids.set(member.email, await addMember(tx, member, at));
    }
    const mara = ids.get('mara@longseat.test') as string;
    const idris = ids.get('idris@longseat.test') as string;
    const lune = ids.get('lune@longseat.test') as string;

    const rowan = await addVehicle(tx, mara, 'Rowan Estate', 'Slate grey', 3, at);
    const fenwick = await addVehicle(tx, idris, 'Fenwick Compact', 'Moss green', 4, at);

    const ride1 = await addRide(
      tx,
      mara,
      rowan,
      ['Kestrevel', 'Brisanne', 'Oakhythe', 'Tollemarch'],
      fromZoned(2027, 1, 16, 8, 30),
      3,
      2150,
      'instant',
    );
    await addRide(
      tx,
      idris,
      fenwick,
      ['Vardholm', 'Kestrevel', 'Hesketh Mere'],
      fromZoned(2027, 1, 16, 14, 0),
      4,
      1500,
      'request',
    );
    await addRide(
      tx,
      mara,
      rowan,
      ['Tollemarch', 'Corrandy', 'Saint Ivrel'],
      fromZoned(2027, 1, 17, 17, 15),
      3,
      2000,
      'instant',
    );

    const ride = (await loadRide(tx, ride1)) as RideRecord;
    const segKm = (ride.stops[1]?.km ?? 0) - (ride.stops[0]?.km ?? 0);
    const priceCents = segmentPriceCents(ride.price_cents, segKm, ride.route_km);
    const bookingId = randomUUID();
    await tx.query(
      `insert into bookings (id, ride_id, passenger_id, boarding_idx, alighting_idx, seats,
         seat_numbers, segment_km, price_cents, state, created_at)
       values ($1, $2, $3, 0, 1, 1, $4, $5, $6, 'confirmed', $7)`,
      [bookingId, ride.id, lune, [1], segKm, priceCents, at],
    );
    for (const state of ['held', 'confirmed']) {
      await tx.query(
        'insert into booking_history (booking_id, state, at) values ($1, $2, $3)',
        [bookingId, state, at],
      );
    }
    await ledger.payment(
      tx,
      at,
      bookingId,
      lune,
      priceCents,
      `Seat booked: ${ride.stops[0]?.city} to ${ride.stops[1]?.city}, ${dateLabel(
        isoZoned(boardingTimeOf(ride, 0)),
      )}`,
    );
    await tx.query('insert into seed_marker (id, done_at) values (1, $1)', [at]);
  });
}

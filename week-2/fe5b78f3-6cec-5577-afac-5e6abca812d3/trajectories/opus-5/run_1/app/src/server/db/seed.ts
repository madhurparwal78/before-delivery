import { randomUUID } from 'node:crypto';
import { SEED_ACCOUNTS, SEED_TRAINS, seedStations } from '../domain/seed-data';
import { hashPassword } from '../passwords';
import type { Database } from './pool';
import { SCHEMA_SQL } from './schema';

/** The schema and seed data are applied idempotently on every server start. */
export async function applySchemaAndSeed(database: Database): Promise<void> {
  await database.query(SCHEMA_SQL);

  const stations = seedStations();
  for (const [index, station] of stations.entries()) {
    await database.query(
      `insert into stations (code, name, seq) values ($1, $2, $3)
       on conflict (code) do update set name = excluded.name, seq = excluded.seq`,
      [station.code, station.name, index + 1],
    );
  }

  for (const [trainIndex, train] of SEED_TRAINS.entries()) {
    await database.query(
      `insert into trains (number, name, seq) values ($1, $2, $3)
       on conflict (number) do update set name = excluded.name, seq = excluded.seq`,
      [train.number, train.name, trainIndex + 1],
    );
    for (const [stopIndex, stop] of train.stops.entries()) {
      await database.query(
        `insert into train_stops
           (train_number, seq, station_code, km, stop_time, day_offset, remote)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (train_number, seq) do update set
           station_code = excluded.station_code, km = excluded.km,
           stop_time = excluded.stop_time, day_offset = excluded.day_offset,
           remote = excluded.remote`,
        [train.number, stopIndex + 1, stop.code, stop.km, stop.time, stop.dayOffset, stop.remote],
      );
    }
    for (const [coachIndex, coach] of train.coaches.entries()) {
      await database.query(
        `insert into coaches (train_number, code, travel_class, seq) values ($1, $2, $3, $4)
         on conflict (train_number, code) do update set
           travel_class = excluded.travel_class, seq = excluded.seq`,
        [train.number, coach.code, coach.travelClass, coachIndex + 1],
      );
    }
  }

  for (const account of SEED_ACCOUNTS) {
    const existing = await database.query<{ id: string }>(
      'select id from accounts where email = $1',
      [account.email],
    );
    if (existing.length > 0) continue;
    await database.query(
      `insert into accounts (id, name, email, password_hash, phone)
       values ($1, $2, $3, $4, $5)
       on conflict (email) do nothing`,
      [randomUUID(), account.name, account.email, await hashPassword(account.password), account.phone],
    );
  }
}

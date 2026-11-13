import { pool, query } from './db.ts';
import schema from './schema.sql';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  OPERATOR_TEAM_NAME,
  SEED_CLUBS,
  SEED_PLAYERS,
  TOTAL_GAMEWEEKS,
} from './domain/seed.ts';
import { ensureNoticesCollection, ensureOperatorUser } from './services/pocketbase.ts';
import { ensureBucket } from './services/storage.ts';
import { ensureManagerRecord } from './game/accounts.ts';

export const applySchemaAndSeed = async (): Promise<void> => {
  await pool.query(schema);

  for (const [index, club] of SEED_CLUBS.entries()) {
    await query(
      pool,
      `insert into clubs (code, name, tier, sort_index) values ($1, $2, $3, $4)
       on conflict (code) do update set name = $2, tier = $3, sort_index = $4`,
      [club.code, club.name, club.tier, index],
    );
  }
  for (const player of SEED_PLAYERS) {
    await query(
      pool,
      `insert into players (id, name, club, position, price_tenths) values ($1, $2, $3, $4, $5)
       on conflict (id) do update set name = $2, club = $3, position = $4`,
      [player.id, player.name, player.club, player.position, player.price_tenths],
    );
  }
  for (let number = 1; number <= TOTAL_GAMEWEEKS; number += 1) {
    await query(
      pool,
      `insert into gameweeks (number, status) values ($1, $2) on conflict (number) do nothing`,
      [number, number === 1 ? 'open' : 'upcoming'],
    );
  }
};

export const setUpPocketBase = async (): Promise<void> => {
  await ensureNoticesCollection();
  const operator = await ensureOperatorUser(
    OPERATOR_EMAIL,
    OPERATOR_PASSWORD,
    OPERATOR_TEAM_NAME,
  );
  await ensureManagerRecord({ ...operator, team_name: OPERATOR_TEAM_NAME });
};

export const setUpStorage = async (): Promise<void> => {
  await ensureBucket();
};

import { roundKindForNumber } from '../shared/rounds.js';
import { simulateRound } from '../shared/sim/index.js';
import type { InputRecord } from '../shared/types.js';
import { type Tx, queryOne, transaction } from './db.js';
import { fail } from './errors.js';
import { hashPassword } from './services/accounts.js';
import { createSoloParty } from './services/parties.js';

const SEED_PASSWORD = 'Bounce-Seed-2026';

const PLAYERS: readonly { id: number; handle: string; verified: boolean }[] = [
  { id: 1, handle: 'pip_bounce', verified: true },
  { id: 2, handle: 'juniper_jolt', verified: true },
  { id: 3, handle: 'marlo_tumble', verified: true },
  { id: 4, handle: 'sunny_skid', verified: true },
  { id: 5, handle: 'otto_wobble', verified: true },
  { id: 6, handle: 'rue_flop', verified: true },
  { id: 7, handle: 'kit_kaboom', verified: true },
  { id: 8, handle: 'bea_boing', verified: true },
  { id: 9, handle: 'nico_noodle', verified: true },
  { id: 10, handle: 'tamsin_trip', verified: true },
  { id: 11, handle: 'wren_whoops', verified: true },
  { id: 12, handle: 'ivo_splat', verified: true },
  { id: 13, handle: 'lula_leap', verified: true },
  { id: 14, handle: 'dex_dash', verified: true },
  { id: 15, handle: 'cleo_clatter', verified: true },
  { id: 16, handle: 'fen_fumble', verified: true },
  { id: 17, handle: 'late_lark', verified: false },
];

const FRIENDSHIPS: readonly [number, number][] = [
  [1, 2],
  [1, 3],
  [2, 3],
];

const SEED_ROUND_SEEDS: readonly number[] = [20261026, 4242, 777];
const MATCH_STARTED_AT = '2026-10-25T19:00:00.000Z';
const MATCH_FINISHED_AT = '2026-10-25T19:06:00.000Z';

function seededInputs(n: number, starters: readonly number[]): InputRecord[] {
  if (n === 1) {
    return starters
      .filter((userId) => userId <= 10)
      .map((userId) => ({ tick: 0, userId, buttons: 1 }));
  }
  if (n === 3) return starters.map((userId) => ({ tick: 0, userId, buttons: 1 }));
  return [];
}

async function seedPlayers(tx: Tx): Promise<void> {
  const passwordHash = hashPassword(SEED_PASSWORD);
  for (const player of PLAYERS) {
    await tx.query(
      `INSERT INTO users (id, email, handle, password_hash, email_verified)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        player.id,
        `${player.handle}@wobblewell.test`,
        player.handle,
        passwordHash,
        player.verified,
      ],
    );
    await createSoloParty(tx, player.id);
  }
  await tx.query(`SELECT setval('users_id_seq', (SELECT max(id) FROM users))`);
  for (const [low, high] of FRIENDSHIPS) {
    await tx.query('INSERT INTO friendships (low_user_id, high_user_id) VALUES ($1, $2)', [
      low,
      high,
    ]);
  }
  await tx.query('INSERT INTO friend_requests (from_user_id, to_user_id) VALUES ($1, $2)', [4, 1]);
}

/** Match 1 is stored exactly like any other match: the simulation decides it. */
async function seedMatch(tx: Tx): Promise<void> {
  const lobby = await tx.queryOne<{ id: number }>(
    `INSERT INTO lobbies (state) VALUES ('finished') RETURNING id`,
  );
  if (lobby === null) throw fail.internal();
  await tx.query(
    `INSERT INTO matches (id, lobby_id, state, started_at, finished_at)
     VALUES (1, $1, 'finished', $2, $3)`,
    [lobby.id, MATCH_STARTED_AT, MATCH_FINISHED_AT],
  );
  await tx.query(`SELECT setval('matches_id_seq', (SELECT max(id) FROM matches))`);
  await tx.query('UPDATE lobbies SET match_id = 1 WHERE id = $1', [lobby.id]);

  let starters: number[] = PLAYERS.slice(0, 12).map((player) => player.id);
  for (const userId of starters) {
    await tx.query('INSERT INTO match_participants (match_id, user_id) VALUES (1, $1)', [userId]);
  }
  let winnerId: number | null = null;
  for (let n = 1; n <= 3; n += 1) {
    const kind = roundKindForNumber(n);
    const roundSeed = SEED_ROUND_SEEDS[n - 1];
    const inputs = seededInputs(n, starters);
    const engine = simulateRound(kind, roundSeed, starters, inputs, []);
    const round = await tx.queryOne<{ id: number }>(
      `INSERT INTO rounds (match_id, n, kind, seed, state, starters, slots, last_tick)
       VALUES (1, $1, $2, $3, 'resolved', $4, $5, $6) RETURNING id`,
      [n, kind, roundSeed, starters, engine.slots, engine.lastTick],
    );
    if (round === null) throw fail.internal();
    for (const input of inputs) {
      await tx.query(
        'INSERT INTO round_inputs (round_id, tick, user_id, buttons) VALUES ($1, $2, $3, $4)',
        [round.id, input.tick, input.userId, input.buttons],
      );
    }
    for (const result of engine.results()) {
      await tx.query(
        `INSERT INTO round_results (round_id, user_id, outcome, finish_tick, eliminated_tick, position)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          round.id,
          result.userId,
          result.outcome,
          result.finishTick,
          result.eliminatedTick,
          result.position,
        ],
      );
    }
    starters = engine.qualifiers();
    if (n === 3) winnerId = starters[0] ?? null;
  }
  await tx.query('UPDATE matches SET winner_id = $1 WHERE id = 1', [winnerId]);
}

/** Seeding runs idempotently at serve time. */
export async function seed(): Promise<void> {
  const player = await queryOne<{ id: number }>('SELECT id FROM users WHERE handle = $1', [
    'pip_bounce',
  ]);
  if (player === null) await transaction(seedPlayers);
  const match = await queryOne<{ id: number }>('SELECT id FROM matches WHERE id = 1');
  if (match === null) await transaction(seedMatch);
}

import type { Pool, PoolClient } from "pg";
import { hashPassword } from "../auth.js";
import type { RoundKind } from "../../shared/domain.js";
import { simulateRound, type InputEntry } from "../sim/sim.js";

const SEED_PASSWORD = "Bounce-Seed-2026";

export const SEED_USERS: { id: number; handle: string; verified: boolean }[] = [
  { id: 1, handle: "pip_bounce", verified: true },
  { id: 2, handle: "juniper_jolt", verified: true },
  { id: 3, handle: "marlo_tumble", verified: true },
  { id: 4, handle: "sunny_skid", verified: true },
  { id: 5, handle: "otto_wobble", verified: true },
  { id: 6, handle: "rue_flop", verified: true },
  { id: 7, handle: "kit_kaboom", verified: true },
  { id: 8, handle: "bea_boing", verified: true },
  { id: 9, handle: "nico_noodle", verified: true },
  { id: 10, handle: "tamsin_trip", verified: true },
  { id: 11, handle: "wren_whoops", verified: true },
  { id: 12, handle: "ivo_splat", verified: true },
  { id: 13, handle: "lula_leap", verified: true },
  { id: 14, handle: "dex_dash", verified: true },
  { id: 15, handle: "cleo_clatter", verified: true },
  { id: 16, handle: "fen_fumble", verified: true },
  { id: 17, handle: "late_lark", verified: false }
];

const SEED_FRIENDSHIPS: [number, number][] = [
  [1, 2],
  [1, 3],
  [2, 3]
];

const MATCH1_ROUND_SEEDS: Record<number, number> = { 1: 20261026, 2: 4242, 3: 777 };

/** Seeds people, friendships, match 1 and its simulated results, idempotently. */
/** Seeds idempotently: every insert conflicts away when its row already exists. */
export async function seed(pool: Pool): Promise<void> {
  await backfillSequences(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const passwordHash = await hashPassword(SEED_PASSWORD);
    for (const user of SEED_USERS) {
      await client.query(
        `INSERT INTO users (id, handle, handle_lower, email, password_hash, email_verified)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [user.id, user.handle, user.handle, `${user.handle}@wobblewell.test`, passwordHash, user.verified]
      );
      const existingMember = await client.query("SELECT 1 FROM party_members WHERE user_id = $1", [user.id]);
      if (!existingMember.rows[0]) {
        const inserted = await client.query<{ id: number }>(
          "INSERT INTO parties (state, leader_id) VALUES ('idle', $1) RETURNING id",
          [user.id]
        );
        const partyId = (inserted.rows[0] as { id: number }).id;
        await client.query("INSERT INTO party_members (party_id, user_id) VALUES ($1, $2)", [partyId, user.id]);
      }
    }
    await client.query("SELECT setval('users_id_seq', (SELECT max(id) FROM users))");

    for (const [a, b] of SEED_FRIENDSHIPS) {
      await client.query("INSERT INTO friendships (user_a, user_b) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
        Math.min(a, b),
        Math.max(a, b)
      ]);
    }
    const requestExists = await client.query("SELECT 1 FROM friend_requests WHERE from_user = 4 AND to_user = 1");
    if (!requestExists.rows[0]) {
      await client.query("INSERT INTO friend_requests (from_user, to_user) VALUES (4, 1)");
    }

    const anyMatch = await client.query("SELECT 1 FROM matches LIMIT 1");
    if (!anyMatch.rows[0]) {
      await seedMatch1(client);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

async function backfillSequences(pool: Pool): Promise<void> {
  await pool.query("SELECT setval('users_id_seq', (SELECT max(id) FROM users))");
}

/**
 * Seeds match 1: a finished 12-player cup whose slots, qualifiers, last ticks,
 * results and winner are computed once by the simulation and stored like any
 * other round.
 */
async function seedMatch1(client: PoolClient): Promise<void> {
  const startedAt = new Date("2026-10-25T19:00:00Z");
  const finishedAt = new Date("2026-10-25T19:06:00Z");
  const lobby = await client.query<{ id: number }>("INSERT INTO lobbies (state) VALUES ('finished') RETURNING id");
  const lobbyId = (lobby.rows[0] as { id: number }).id;
  const match = await client.query<{ id: number }>(
    "INSERT INTO matches (name, state, lobby_id, started_at, finished_at, winner_id) VALUES ($1, 'finished', $2, $3, $4, NULL) RETURNING id",
    ["Cup #", lobbyId, startedAt, finishedAt]
  );
  const matchId = (match.rows[0] as { id: number }).id;
  await client.query("UPDATE matches SET name = $1 WHERE id = $2", [`Cup #${matchId}`, matchId]);
  await client.query("UPDATE lobbies SET match_id = $1 WHERE id = $2", [matchId, lobbyId]);

  // The seeded lobby is already finished, so it holds no seats: the match's
  // participants are recorded by its rounds' starters.
  const kinds: Record<number, RoundKind> = { 1: "race", 2: "survival", 3: "final" };
  const finalAt = new Date("2026-10-25T19:06:00Z");
  let starters: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  let winnerId: number | null = null;

  for (const n of [1, 2, 3]) {
    const kind = kinds[n] as RoundKind;
    if (starters.length <= 1) {
      winnerId = starters[0] ?? null;
      break;
    }
    const seedValue = MATCH1_ROUND_SEEDS[n] as number;
    const inputs = matchInputsFor(n, starters);
    const sim = simulateRound({ kind, seed: seedValue, starters, inputs, recordFrames: true });
    if (sim.lastTick === null) continue;
    const slots = sim.slots;
    await client.query(
      `INSERT INTO rounds (match_id, n, kind, seed, state, slots, starters, last_tick, started_at)
       VALUES ($1, $2, $3, $4, 'resolved', $5, $6, $7, $8)`,
      [matchId, n, kind, seedValue, slots, starters, sim.lastTick, startedAt]
    );
    for (const entry of inputs) {
      await client.query(
        "INSERT INTO round_inputs (match_id, round_n, user_id, tick, buttons) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
        [matchId, n, entry.userId, entry.tick, entry.buttons]
      );
    }
    for (const result of sim.results) {
      await client.query(
        `INSERT INTO round_results (match_id, round_n, user_id, outcome, finish_tick, eliminated_tick, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [matchId, n, result.userId, result.outcome, result.finishTick, result.eliminatedTick, result.position]
      );
    }
    const qualifiers = sim.results.filter((r) => r.outcome === "qualified").map((r) => r.userId).sort((a, b) => a - b);
    if (qualifiers.length === 0) break;
    if (n === 3) {
      const winner = sim.results.find((r) => r.outcome === "qualified" && r.position === 1);
      winnerId = winner?.userId ?? null;
    }
    starters = qualifiers;
  }

  await client.query("UPDATE matches SET winner_id = $1, finished_at = $2 WHERE id = $3", [winnerId, finalAt, matchId]);
  await client.query("UPDATE parties SET state = 'idle' WHERE id IN (SELECT party_id FROM lobby_seats WHERE lobby_id = $1)", [lobbyId]);
}

/** The stored inputs of match 1 as the brief describes them. */
function matchInputsFor(roundN: number, starters: number[]): InputEntry[] {
  if (roundN === 1) {
    // Players 1 to 10 hold buttons 1 from tick 0; players 11 and 12 send nothing.
    const inputs: InputEntry[] = [];
    for (const userId of starters) {
      if (userId >= 1 && userId <= 10) inputs.push({ tick: 0, userId, buttons: 1 });
    }
    return inputs;
  }
  if (roundN === 2) {
    return [];
  }
  // Round 3: every starter holds buttons 1 from tick 0.
  return starters.map((userId) => ({ tick: 0, userId, buttons: 1 }));
}


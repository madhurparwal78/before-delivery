// Invented seed players, friendships and the finished Cup #1, applied idempotently when the server starts.
import type pg from "pg";
import { one, query } from "./db.js";
import { hashPassword } from "./auth.js";
import { startSoloParty } from "./party.js";
import { type InputEntry, ReplayedRound } from "../shared/sim.js";
import { afterRound, ROUNDS } from "../shared/rules.js";

const SEED_PASSWORD = "Bounce-Seed-2026";
const HANDLES = [
  "pip_bounce", "juniper_jolt", "marlo_tumble", "sunny_skid", "otto_wobble", "rue_flop", "kit_kaboom", "bea_boing",
  "nico_noodle", "tamsin_trip", "wren_whoops", "ivo_splat", "lula_leap", "dex_dash", "cleo_clatter", "fen_fumble", "late_lark",
];
const UNVERIFIED = new Set(["late_lark"]);
const FRIENDS: [number, number][] = [[1, 2], [1, 3], [2, 3]];
const MATCH_PLAYERS = Array.from({ length: 12 }, (_, index) => index + 1);
const STARTED = new Date(Date.UTC(2026, 9, 25, 19, 0, 0));
const FINISHED = new Date(Date.UTC(2026, 9, 25, 19, 6, 0));

const ROUND_PLAN: { seed: number; inputs: (starters: number[]) => InputEntry[] }[] = [
  { seed: 20261026, inputs: () => MATCH_PLAYERS.slice(0, 10).map((userId) => ({ tick: 0, userId, buttons: 1 })) },
  { seed: 4242, inputs: () => [] },
  { seed: 777, inputs: (starters) => starters.map((userId) => ({ tick: 0, userId, buttons: 1 })) },
];

async function syncSequence(client: pg.PoolClient, table: string): Promise<void> {
  await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), (SELECT max(id) FROM ${table}))`);
}

export async function seed(client: pg.PoolClient): Promise<void> {
  if ((await one("SELECT 1 FROM users WHERE id = 1", [], client)) !== undefined) return;
  await client.query("BEGIN");
  try {
    for (const [index, handle] of HANDLES.entries()) {
      await query("INSERT INTO users (id, email, handle, password_hash, email_verified, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [index + 1, `${handle}@wobblewell.test`, handle, await hashPassword(SEED_PASSWORD), !UNVERIFIED.has(handle), STARTED], client);
    }
    await syncSequence(client, "users");
    for (const userId of HANDLES.keys()) await startSoloParty(client, userId + 1);
    for (const [a, b] of FRIENDS) await query("INSERT INTO friendships (low_id, high_id, since) VALUES ($1, $2, $3)", [a, b, STARTED], client);
    await query("INSERT INTO friend_requests (from_id, to_id, sent_at) VALUES (4, 1, $1)", [STARTED], client);
    await seedMatch(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function seedMatch(client: pg.PoolClient): Promise<void> {
  await query("INSERT INTO lobbies (id, state, host_instance, created_at) VALUES (1, 'finished', 'seed', $1)", [STARTED], client);
  await syncSequence(client, "lobbies");
  for (const userId of MATCH_PLAYERS) {
    const party = await one<{ party_id: number }>("SELECT party_id FROM party_members WHERE user_id = $1", [userId], client);
    await query("INSERT INTO seats (lobby_id, seat, user_id, party_id, seated_at) VALUES (1, $1, $1, $2, $3)", [userId, party?.party_id, STARTED], client);
  }
  await query("INSERT INTO matches (id, lobby_id, state, started_at, finished_at) VALUES (1, 1, 'finished', $1, $2)", [STARTED, FINISHED], client);
  await syncSequence(client, "matches");
  await query("UPDATE lobbies SET match_id = 1 WHERE id = 1", [], client);
  await query("INSERT INTO match_participants (match_id, user_id) SELECT 1, unnest($1::int[])", [MATCH_PLAYERS], client);
  let starters = MATCH_PLAYERS;
  let spec = ROUNDS[0];
  let winner: number | null = null;
  while (spec !== undefined) {
    const plan = ROUND_PLAN[spec.n - 1];
    if (plan === undefined) break;
    const inputs = plan.inputs(starters);
    const replay = new ReplayedRound(spec.kind, plan.seed, starters, inputs, []);
    const round = await one<{ id: number }>(
      "INSERT INTO rounds (match_id, n, kind, seed, state, starters, slots, last_tick) VALUES (1, $1, $2, $3, 'resolved', $4, $5, $6) RETURNING id",
      [spec.n, spec.kind, plan.seed, starters, replay.slots, replay.lastTick], client);
    for (const input of inputs) {
      await query("INSERT INTO round_inputs (round_id, tick, user_id, buttons) VALUES ($1, $2, $3, $4)", [round?.id, input.tick, input.userId, input.buttons], client);
    }
    for (const result of replay.results) {
      await query("INSERT INTO round_results (round_id, user_id, outcome, finish_tick, eliminated_tick, position) VALUES ($1, $2, $3, $4, $5, $6)",
        [round?.id, result.userId, result.outcome, result.finishTick, result.eliminatedTick, result.position], client);
    }
    const qualifiers = replay.results.filter((result) => result.outcome === "qualified").map((result) => result.userId).sort((a, b) => a - b);
    const after = afterRound(spec.n, qualifiers);
    if ("winner" in after) {
      winner = after.winner;
      spec = undefined;
    } else {
      spec = after.next;
      starters = qualifiers;
    }
  }
  await query("UPDATE matches SET winner_id = $1 WHERE id = 1", [winner], client);
}

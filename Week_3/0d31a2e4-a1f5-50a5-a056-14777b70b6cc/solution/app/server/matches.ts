// Matches and rounds as stored, and the forfeit endpoint.
import { db, emit, one, type Queryable, query } from "./db.js";
import { ApiError, transitionError } from "./errors.js";
import { route } from "./http.js";
import { forfeitHere } from "./live.js";
import { iso, toUser } from "./users.js";
import type { Match, Round } from "../shared/api.js";
import type { RoundResult } from "../shared/sim.js";
import { matchName, type RoundKind, type RoundState, roundSpec } from "../shared/rules.js";


export interface StoredRound {
  id: number;
  n: number;
  kind: RoundKind;
  seed: number;
  state: RoundState;
  starters: number[];
  slots: number;
  last_tick: number | null;
}

const ROUND_COLUMNS = "id, n, kind, seed, state, starters, slots, last_tick";

async function resultsOf(roundId: number, on?: Queryable): Promise<RoundResult[]> {
  const rows = await query(
    "SELECT user_id, outcome, finish_tick, eliminated_tick, position FROM round_results WHERE round_id = $1 ORDER BY position", [roundId], on);
  return rows.map((row) => ({
    userId: Number(row["user_id"]),
    outcome: row["outcome"] === "qualified" ? "qualified" : "eliminated",
    finishTick: row["finish_tick"] === null ? null : Number(row["finish_tick"]),
    eliminatedTick: row["eliminated_tick"] === null ? null : Number(row["eliminated_tick"]),
    position: Number(row["position"]),
  }));
}

async function toRound(row: StoredRound, on?: Queryable): Promise<Round> {
  return {
    n: row.n,
    kind: row.kind,
    name: roundSpec(row.n)?.name ?? "",
    seed: row.seed,
    state: row.state,
    starters: row.starters,
    slots: row.slots,
    lastTick: row.last_tick,
    results: row.state === "resolved" ? await resultsOf(row.id, on) : [],
  };
}

export async function roundJson(roundId: number): Promise<Round> {
  const row = await one<StoredRound>(`SELECT ${ROUND_COLUMNS} FROM rounds WHERE id = $1`, [roundId]);
  if (row === undefined) throw new Error(`round ${roundId} missing`);
  return toRound(row);
}

export async function storedRound(matchId: number, n: number): Promise<StoredRound | undefined> {
  return one<StoredRound>(`SELECT ${ROUND_COLUMNS} FROM rounds WHERE match_id = $1 AND n = $2`, [matchId, n]);
}

// Ids are positive integers that fit the id columns; anything else names no row and parses to 0.
export function positiveId(raw: unknown): number {
  const value = typeof raw === "string" ? Number(raw) : raw;
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value < 2 ** 31 ? value : 0;
}


async function matchJson(matchId: number): Promise<Match | null> {
  const match = await one<{ id: number; state: "running" | "finished"; lobby_id: number | null; started_at: Date; finished_at: Date | null; winner_id: number | null }>(
    "SELECT id, state, lobby_id, started_at, finished_at, winner_id FROM matches WHERE id = $1", [matchId]);
  if (match === undefined) return null;
  const participants = await query(
    "SELECT u.id, u.handle FROM match_participants p JOIN users u ON u.id = p.user_id WHERE p.match_id = $1 ORDER BY u.id", [matchId]);
  const rounds = await query<StoredRound>(`SELECT ${ROUND_COLUMNS} FROM rounds WHERE match_id = $1 ORDER BY n`, [matchId]);
  return {
    id: match.id,
    name: matchName(match.id),
    state: match.state,
    lobbyId: match.lobby_id,
    startedAt: iso(match.started_at),
    finishedAt: match.finished_at === null ? null : iso(match.finished_at),
    winnerId: match.winner_id,
    participants: participants.map((row) => toUser(row)),
    rounds: await Promise.all(rounds.map((row) => toRound(row))),
  };
}

route("GET", "/api/matches/:id", "session", async ({ params }) => {
  const match = await matchJson(positiveId(params[0]));
  if (match === null) throw new ApiError("match_not_found");
  return { status: 200, body: { match } };
});

// The hosting process judges the forfeit; another process hands it over through the database.
route("POST", "/api/matches/:id/forfeit", "session", async ({ me, params }) => {
  const matchId = positiveId(params[0]);
  const here = await forfeitHere(matchId, me.id);
  if (here === true) return { status: 200, body: { result: { outcome: "eliminated" } } };
  const running = await one<{ id: number }>(
    `SELECT r.id FROM rounds r JOIN matches m ON m.id = r.match_id
     WHERE r.match_id = $1 AND m.state = 'running' AND r.state = 'running' AND $2 = ANY(r.starters)
       AND NOT EXISTS (SELECT 1 FROM round_forfeits f WHERE f.round_id = r.id AND f.user_id = $2)`, [matchId, me.id]);
  if (here === null && running !== undefined) {
    await emit(db(), { kind: "forfeit", matchId, userId: me.id });
    return { status: 200, body: { result: { outcome: "eliminated" } } };
  }
  throw transitionError("not_in_play");
});

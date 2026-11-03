import { randomInt } from 'node:crypto';
import {
  ROUND_ORDER,
  roundKindForNumber,
  roundName,
  slotsFor,
} from '../../shared/rounds.js';
import { type RoundEngine, simulateRound } from '../../shared/sim/index.js';
import type {
  ForfeitRecord,
  InputRecord,
  Match,
  ProfileMatchEntry,
  Round,
  RoundKind,
  RoundResult,
  RoundState,
} from '../../shared/types.js';
import { type Tx, query, queryOne, transaction } from '../db.js';
import { fail } from '../errors.js';
import { toUser } from './accounts.js';

export interface RoundRow {
  id: number;
  match_id: number;
  n: number;
  kind: RoundKind;
  seed: string;
  state: RoundState;
  starters: number[];
  slots: number;
  last_tick: number | null;
}

const ROUND_COLUMNS = 'id, match_id, n, kind, seed, state, starters, slots, last_tick';

export async function roundResults(roundId: number): Promise<RoundResult[]> {
  const rows = await query<{
    user_id: number;
    outcome: 'qualified' | 'eliminated';
    finish_tick: number | null;
    eliminated_tick: number | null;
    position: number;
  }>(
    `SELECT user_id, outcome, finish_tick, eliminated_tick, position
     FROM round_results WHERE round_id = $1 ORDER BY position`,
    [roundId],
  );
  return rows.map((row) => ({
    userId: row.user_id,
    outcome: row.outcome,
    finishTick: row.finish_tick,
    eliminatedTick: row.eliminated_tick,
    position: row.position,
  }));
}

export async function roundPayload(row: RoundRow): Promise<Round> {
  return {
    n: row.n,
    kind: row.kind,
    name: roundName(row.kind),
    seed: Number(row.seed),
    state: row.state,
    starters: row.starters,
    slots: row.slots,
    lastTick: row.last_tick,
    results: row.state === 'resolved' ? await roundResults(row.id) : [],
  };
}

export async function findRound(matchId: number, n: number): Promise<RoundRow | null> {
  return queryOne<RoundRow>(
    `SELECT ${ROUND_COLUMNS} FROM rounds WHERE match_id = $1 AND n = $2`,
    [matchId, n],
  );
}

export async function loadMatch(matchId: number): Promise<Match | null> {
  const match = await queryOne<{
    id: number;
    lobby_id: number;
    state: 'running' | 'finished';
    started_at: Date;
    finished_at: Date | null;
    winner_id: number | null;
  }>(
    `SELECT id, lobby_id, state, started_at, finished_at, winner_id FROM matches WHERE id = $1`,
    [matchId],
  );
  if (match === null) return null;
  const participants = await query<{ id: number; handle: string }>(
    `SELECT u.id, u.handle FROM match_participants p JOIN users u ON u.id = p.user_id
     WHERE p.match_id = $1 ORDER BY u.id`,
    [matchId],
  );
  const roundRows = await query<RoundRow>(
    `SELECT ${ROUND_COLUMNS} FROM rounds WHERE match_id = $1 ORDER BY n`,
    [matchId],
  );
  const rounds: Round[] = [];
  for (const row of roundRows) rounds.push(await roundPayload(row));
  return {
    id: match.id,
    name: `Cup #${match.id}`,
    state: match.state,
    lobbyId: match.lobby_id,
    startedAt: match.started_at.toISOString(),
    finishedAt: match.finished_at?.toISOString() ?? null,
    winnerId: match.winner_id,
    participants: participants.map(toUser),
    rounds,
  };
}

export async function createRound(
  tx: Tx,
  matchId: number,
  n: number,
  starters: readonly number[],
): Promise<RoundRow> {
  const kind = roundKindForNumber(n);
  const row = await tx.queryOne<RoundRow>(
    `INSERT INTO rounds (match_id, n, kind, seed, starters, slots)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${ROUND_COLUMNS}`,
    [matchId, n, kind, randomInt(0, 4294967296), [...starters], slotsFor(kind, starters.length)],
  );
  if (row === null) throw fail.internal();
  return row;
}

export async function setRoundState(roundId: number, state: RoundState): Promise<void> {
  await query('UPDATE rounds SET state = $2 WHERE id = $1', [roundId, state]);
}

export async function storeInputs(
  roundId: number,
  tick: number,
  entries: ReadonlyMap<number, number>,
): Promise<void> {
  if (entries.size === 0) return;
  const values: unknown[] = [roundId, tick];
  const tuples: string[] = [];
  for (const [userId, buttons] of entries) {
    values.push(userId, buttons);
    tuples.push(`($1, $2, $${values.length - 1}, $${values.length})`);
  }
  await query(
    `INSERT INTO round_inputs (round_id, tick, user_id, buttons) VALUES ${tuples.join(', ')}`,
    values,
  );
}

export async function storeForfeit(
  roundId: number,
  userId: number,
  tick: number,
): Promise<void> {
  await query(
    `INSERT INTO round_forfeits (round_id, user_id, tick) VALUES ($1, $2, $3)
     ON CONFLICT (round_id, user_id) DO NOTHING`,
    [roundId, userId, tick],
  );
}

export async function storeResolution(
  roundId: number,
  lastTick: number,
  results: readonly RoundResult[],
): Promise<void> {
  await transaction(async (tx) => {
    await tx.query(`UPDATE rounds SET state = 'resolved', last_tick = $2 WHERE id = $1`, [
      roundId,
      lastTick,
    ]);
    for (const result of results) {
      await tx.query(
        `INSERT INTO round_results (round_id, user_id, outcome, finish_tick, eliminated_tick, position)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (round_id, user_id) DO UPDATE SET
           outcome = excluded.outcome, finish_tick = excluded.finish_tick,
           eliminated_tick = excluded.eliminated_tick, position = excluded.position`,
        [
          roundId,
          result.userId,
          result.outcome,
          result.finishTick,
          result.eliminatedTick,
          result.position,
        ],
      );
    }
  });
}

export interface StoredRoundInputs {
  inputs: InputRecord[];
  forfeits: ForfeitRecord[];
}

export async function storedInputs(roundId: number): Promise<StoredRoundInputs> {
  const inputs = await query<{ tick: number; user_id: number; buttons: number }>(
    `SELECT tick, user_id, buttons FROM round_inputs WHERE round_id = $1 ORDER BY tick, user_id`,
    [roundId],
  );
  const forfeits = await query<{ tick: number; user_id: number }>(
    `SELECT tick, user_id FROM round_forfeits WHERE round_id = $1 ORDER BY tick, user_id`,
    [roundId],
  );
  return {
    inputs: inputs.map((row) => ({ tick: row.tick, userId: row.user_id, buttons: row.buttons })),
    forfeits: forfeits.map((row) => ({ tick: row.tick, userId: row.user_id })),
  };
}

const replayCache = new Map<number, RoundEngine>();

/** Re-simulates a resolved round from what PostgreSQL stored. */
export async function replayRound(row: RoundRow): Promise<RoundEngine> {
  if (row.state !== 'resolved') throw fail.roundNotResolved();
  const cached = replayCache.get(row.id);
  if (cached !== undefined) return cached;
  const stored = await storedInputs(row.id);
  const engine = simulateRound(
    row.kind,
    Number(row.seed),
    row.starters,
    stored.inputs,
    stored.forfeits,
  );
  if (replayCache.size > 64) replayCache.clear();
  replayCache.set(row.id, engine);
  return engine;
}

export async function handlesFor(userIds: readonly number[]): Promise<Map<number, string>> {
  const rows = await query<{ id: number; handle: string }>(
    'SELECT id, handle FROM users WHERE id = ANY($1::int[])',
    [userIds],
  );
  return new Map(rows.map((row) => [row.id, row.handle]));
}

export async function profileCounts(userId: number): Promise<{ played: number; wins: number }> {
  const row = await queryOne<{ played: number; wins: number }>(
    `SELECT count(*)::int AS played,
            count(*) FILTER (WHERE m.winner_id = $1)::int AS wins
     FROM match_participants p JOIN matches m ON m.id = p.match_id
     WHERE p.user_id = $1 AND m.state = 'finished'`,
    [userId],
  );
  return { played: row?.played ?? 0, wins: row?.wins ?? 0 };
}

export async function profileMatches(userId: number): Promise<ProfileMatchEntry[]> {
  const rows = await query<{
    id: number;
    finished_at: Date;
    winner_id: number | null;
    round: number | null;
  }>(
    `SELECT m.id, m.finished_at, m.winner_id,
            (SELECT r.n FROM round_results rr JOIN rounds r ON r.id = rr.round_id
             WHERE r.match_id = m.id AND rr.user_id = $1 AND rr.outcome = 'eliminated'
             ORDER BY r.n LIMIT 1) AS round
     FROM match_participants p JOIN matches m ON m.id = p.match_id
     WHERE p.user_id = $1 AND m.state = 'finished'
     ORDER BY m.finished_at DESC, m.id DESC LIMIT 20`,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: `Cup #${row.id}`,
    finishedAt: row.finished_at.toISOString(),
    outcome: row.winner_id === userId ? 'winner' : 'eliminated',
    round: row.winner_id === userId ? null : row.round,
  }));
}

export const ROUND_COUNT = ROUND_ORDER.length;

import type pg from 'pg';
import type { GameShape, GameStatus, ResultShape } from '../shared/api';
import type { DailyResultState } from '../shared/daily';
import { Game, emptyStartBoard, type LoggedMove, type StartBoard } from '../shared/engine';
import { type Level, levelPuzzles, puzzleById } from '../shared/puzzles';
import { parseMoveLog, replayMoveLog, sameMoveLog } from '../shared/replay';
import { scoreFor } from '../shared/score';
import { dateInDailyZone, serverNow } from './clock';
import { config, engineLimits } from './config';
import { query, withTransaction } from './db';
import { ApiError } from './errors';
import { newId } from './players';

export interface GameRow {
  id: string;
  player_id: string;
  mode: 'solo' | 'daily';
  level: Level;
  puzzle_id: string;
  daily_date: string | null;
  status: GameStatus;
  start_board: StartBoard;
  moves: LoggedMove[];
  elapsed_ms: number;
  closed_at: string | null;
}

const GAME_COLUMNS = `id, player_id, mode, level, puzzle_id,
  to_char(daily_date, 'YYYY-MM-DD') as daily_date, status, start_board, moves, elapsed_ms,
  closed_at`;

export interface ResultRow {
  id: string;
  game_id: string | null;
  level: Level;
  seconds: number;
  mistakes: number;
  hints: number;
  score: number | null;
  finished_at: string;
  daily_state: DailyResultState | null;
}

function fixtureOf(row: GameRow): { puzzle: string; solution: string } {
  const puzzle = puzzleById(row.puzzle_id);
  if (!puzzle) throw new ApiError('INTERNAL');
  return puzzle;
}

export function engineFor(row: GameRow): Game {
  const fixture = fixtureOf(row);
  return new Game(fixture.puzzle, fixture.solution, row.start_board, engineLimits);
}

/** Replays the stored log, which the server has already accepted. */
export function replayStored(row: GameRow): { game: Game; lastT: number } {
  const game = engineFor(row);
  const outcome = replayMoveLog(game, row.moves, row.start_board.elapsed_ms, false);
  return { game, lastT: outcome.lastT };
}

export function activeMs(row: GameRow): number {
  const lastMove = row.moves.at(-1);
  return Math.max(row.elapsed_ms, lastMove ? lastMove.t : 0, row.start_board.elapsed_ms);
}

export function resultShape(row: ResultRow): ResultShape {
  return {
    id: row.id,
    level: row.level,
    seconds: row.seconds,
    mistakes: row.mistakes,
    hints: row.hints,
    score: row.score ?? 0,
    finished_at: new Date(row.finished_at).toISOString(),
    daily_state: row.daily_state,
  };
}

export async function gameShape(row: GameRow): Promise<GameShape> {
  const fixture = fixtureOf(row);
  const found = await query<ResultRow>(
    `select id, game_id, level, seconds, mistakes, hints, score, finished_at, daily_state
       from results where game_id = $1`,
    [row.id],
  );
  const result = found.rows[0];
  return {
    id: row.id,
    mode: row.mode,
    level: row.level,
    puzzle_id: row.puzzle_id,
    date: row.daily_date,
    status: row.status,
    puzzle: fixture.puzzle,
    solution: fixture.solution,
    start: row.start_board,
    moves: row.moves,
    elapsed_ms: activeMs(row),
    result: result ? resultShape(result) : null,
  };
}

export async function loadGame(id: string, playerId: string): Promise<GameRow> {
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) throw new ApiError('UNKNOWN_GAME');
  const found = await query<GameRow>(
    `select ${GAME_COLUMNS} from games where id = $1 and player_id = $2`,
    [id, playerId],
  );
  const row = found.rows[0];
  if (!row) throw new ApiError('UNKNOWN_GAME');
  return row;
}

/** A lost game is open while its second chance is unused and it has not closed. */
export function isClosed(row: GameRow): boolean {
  return row.status === 'abandoned' || (row.status === 'lost' && row.closed_at !== null);
}

async function recordLoss(client: pg.PoolClient, row: GameRow, game: Game, lastT: number): Promise<void> {
  const seconds = Math.floor(Math.max(row.elapsed_ms, lastT) / 1000);
  await client.query(
    `insert into results
       (id, game_id, player_id, mode, level, outcome, seconds, mistakes, hints, score, finished_at)
     values ($1, $2, $3, $4, $5, 'lost', $6, $7, $8, null, $9)
     on conflict (game_id) do nothing`,
    [
      newId(),
      row.id,
      row.player_id,
      row.mode,
      row.level,
      seconds,
      game.mistakes,
      game.hints,
      serverNow().toISOString(),
    ],
  );
}

/**
 * Starting a game at a level abandons that level's playing solo game and
 * closes an open lost game there.
 */
async function clearLevel(playerId: string, level: Level, abandonPlaying: boolean): Promise<void> {
  await withTransaction(async (client) => {
    const open = await client.query<GameRow>(
      `select ${GAME_COLUMNS} from games
        where player_id = $1 and level = $2 and status = 'lost' and closed_at is null
        for update`,
      [playerId, level],
    );
    const now = serverNow().toISOString();
    for (const row of open.rows) {
      await client.query('update games set closed_at = $2 where id = $1', [row.id, now]);
      const replayed = replayStored(row);
      await recordLoss(client, row, replayed.game, replayed.lastT);
    }
    if (abandonPlaying) {
      await client.query(
        `update games set status = 'abandoned', closed_at = $3
          where player_id = $1 and level = $2 and mode = 'solo' and status = 'playing'`,
        [playerId, level, now],
      );
    }
  });
}

/** The level's fixture the player has started fewest times, ties to the lowest number. */
async function nextPuzzleFor(playerId: string, level: Level): Promise<string> {
  const counted = await query<{ puzzle_id: string; started: string }>(
    'select puzzle_id, count(*)::text as started from games where player_id = $1 group by puzzle_id',
    [playerId],
  );
  const counts = new Map(counted.rows.map((row) => [row.puzzle_id, Number(row.started)]));
  let best = '';
  let bestCount = Number.POSITIVE_INFINITY;
  for (const fixture of levelPuzzles(level)) {
    const started = counts.get(fixture.id) ?? 0;
    if (started < bestCount) {
      bestCount = started;
      best = fixture.id;
    }
  }
  return best;
}

async function insertGame(
  playerId: string,
  mode: 'solo' | 'daily',
  level: Level,
  puzzleId: string,
  date: string | null,
  start: StartBoard,
  status: GameStatus = 'playing',
): Promise<GameRow> {
  const inserted = await query<GameRow>(
    `insert into games
       (id, player_id, mode, level, puzzle_id, daily_date, status, start_board, moves, elapsed_ms)
     values ($1, $2, $3, $4, $5, $6, $7, $8, '[]'::jsonb, $9)
     returning ${GAME_COLUMNS}`,
    [newId(), playerId, mode, level, puzzleId, date, status, JSON.stringify(start), start.elapsed_ms],
  );
  return inserted.rows[0] as GameRow;
}

export async function createSoloGame(playerId: string, level: Level): Promise<GameRow> {
  const puzzleId = await nextPuzzleFor(playerId, level);
  await clearLevel(playerId, level, true);
  return insertGame(playerId, 'solo', level, puzzleId, null, emptyStartBoard());
}

export async function createDailyGame(
  playerId: string,
  date: string,
  puzzleId: string,
): Promise<{ row: GameRow; created: boolean }> {
  const existing = await query<GameRow>(
    `select ${GAME_COLUMNS} from games where player_id = $1 and daily_date = $2`,
    [playerId, date],
  );
  const found = existing.rows[0];
  if (found) return { row: found, created: false };
  await clearLevel(playerId, 'medium', false);
  const row = await insertGame(playerId, 'daily', 'medium', puzzleId, date, emptyStartBoard());
  return { row, created: true };
}

function readElapsed(body: unknown): number {
  if (typeof body !== 'object' || body === null) return 0;
  const value = (body as { elapsed_ms?: unknown }).elapsed_ms;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

export async function saveMoves(row: GameRow, body: unknown): Promise<GameRow> {
  if (isClosed(row)) throw new ApiError('CLOSED_GAME');
  if (row.status === 'won') throw new ApiError('ALREADY_FINISHED');
  const moves = parseMoveLog(body, config.moveLimit);
  if (moves === null) throw new ApiError('LOG_MALFORMED', { move: null });

  const game = engineFor(row);
  const outcome = replayMoveLog(game, moves, row.start_board.elapsed_ms, false);
  if (outcome.failure) {
    throw new ApiError(outcome.failure.code, { move: outcome.failure.move });
  }

  const elapsed = Math.max(readElapsed(body), outcome.lastT);
  const status: GameStatus = game.lost ? 'lost' : 'playing';
  const closes = game.lost && game.secondChanceUsed;

  return withTransaction(async (client) => {
    const updated = await client.query<GameRow>(
      `update games set moves = $2, elapsed_ms = $3, status = $4,
          closed_at = case when $5 then $6::timestamptz else null end
        where id = $1
        returning ${GAME_COLUMNS}`,
      [row.id, JSON.stringify(moves), elapsed, status, closes, serverNow().toISOString()],
    );
    const next = updated.rows[0] as GameRow;
    if (closes) await recordLoss(client, next, game, outcome.lastT);
    return next;
  });
}

export interface FinishOutcome {
  result: ResultShape;
  daily: { date: string; state: DailyResultState } | null;
  level: Level;
}

export async function finishGame(id: string, playerId: string, body: unknown): Promise<FinishOutcome> {
  return withTransaction(async (client) => {
    const found = await client.query<GameRow>(
      `select ${GAME_COLUMNS} from games where id = $1 and player_id = $2 for update`,
      [id, playerId],
    );
    const row = found.rows[0];
    if (!row) throw new ApiError('UNKNOWN_GAME');
    if (isClosed(row)) throw new ApiError('CLOSED_GAME');

    const moves = parseMoveLog(body, config.moveLimit);
    if (moves === null) throw new ApiError('LOG_MALFORMED', { move: null });

    if (row.status === 'won') {
      if (!sameMoveLog(row.moves, moves)) throw new ApiError('ALREADY_FINISHED');
      const stored = await client.query<ResultRow>(
        `select id, game_id, level, seconds, mistakes, hints, score, finished_at, daily_state
           from results where game_id = $1`,
        [row.id],
      );
      const result = stored.rows[0];
      if (!result) throw new ApiError('ALREADY_FINISHED');
      return { result: resultShape(result), daily: null, level: row.level };
    }

    const game = engineFor(row);
    const outcome = replayMoveLog(game, moves, row.start_board.elapsed_ms, true);
    if (outcome.failure) {
      throw new ApiError(outcome.failure.code, { move: outcome.failure.move });
    }

    const finishedAt = serverNow();
    const seconds = Math.floor(outcome.lastT / 1000);
    const score = scoreFor(row.level, seconds, game.mistakes, game.hints);
    const dailyState: DailyResultState | null =
      row.daily_date === null
        ? null
        : dateInDailyZone(finishedAt) === row.daily_date
          ? 'solved'
          : 'late';

    await client.query(
      `update games set status = 'won', moves = $2, elapsed_ms = $3, closed_at = $4 where id = $1`,
      [row.id, JSON.stringify(moves), Math.max(row.elapsed_ms, outcome.lastT), finishedAt.toISOString()],
    );
    const resultId = newId();
    await client.query(
      `insert into results
         (id, game_id, player_id, mode, level, outcome, seconds, mistakes, hints, score,
          finished_at, daily_date, daily_state)
       values ($1, $2, $3, $4, $5, 'won', $6, $7, $8, $9, $10, $11, $12)`,
      [
        resultId,
        row.id,
        playerId,
        row.mode,
        row.level,
        seconds,
        game.mistakes,
        game.hints,
        score,
        finishedAt.toISOString(),
        row.daily_date,
        dailyState,
      ],
    );

    return {
      result: {
        id: resultId,
        level: row.level,
        seconds,
        mistakes: game.mistakes,
        hints: game.hints,
        score,
        finished_at: finishedAt.toISOString(),
        daily_state: dailyState,
      },
      daily: row.daily_date && dailyState ? { date: row.daily_date, state: dailyState } : null,
      level: row.level,
    };
  });
}

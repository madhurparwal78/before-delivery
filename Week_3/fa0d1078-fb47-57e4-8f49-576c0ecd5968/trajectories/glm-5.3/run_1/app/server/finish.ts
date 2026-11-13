import type { PostgresService } from './postgres.js';
import { newId } from './auth.js';
import type { GameRow, GameLimits } from './games.js';
import { parseMoveLog } from '../shared/moves.js';
import { boardSolved, replayLog, type ReplayConfig } from '../shared/engine.js';
import { score } from '../shared/score.js';
import type { Result } from '../shared/api.js';
import type { Level } from '../shared/puzzles.js';

// Finishing a game. The server checks in the published order and answers with
// the first failure; the honest finish counts exactly once.

export type FinishOutcome =
  | { kind: 'ok'; result: Result; stored: boolean }
  | { kind: 'refused'; status: number; code: string; move: number | null };

export interface FinishDeps {
  db: PostgresService;
  limits: GameLimits;
  todayInTz: () => string;
  onDailyResult?: (playerId: string, date: string) => Promise<void>;
}

export class FinishService {
  constructor(private readonly deps: FinishDeps) {}

  async finish(game: GameRow, rawMoves: unknown, isDaily: boolean): Promise<FinishOutcome> {
    const { limits } = this.deps;

    // Step 4: the body must be an object with a moves array, and each move
    // must parse; more than MOVE_LIMIT moves is malformed.
    let moves;
    try {
      moves = parseMoveLog(rawMoves);
    } catch {
      return refuse(400, 'LOG_MALFORMED', null);
    }
    if (moves.length > limits.moveLimit) return refuse(400, 'LOG_MALFORMED', null);

    // Step 5: if the game is already won, an identical log answers the stored
    // result and nothing is counted again.
    const existing = await this.deps.db.query<{ id: string; log: unknown }>(
      `SELECT id, move_log AS log FROM games WHERE id = $1 AND status = 'won'`,
      [game.id],
    );
    if (existing.length > 0) {
      const storedLog = await this.deps.db.query<{ log: unknown }>(
        `SELECT move_log AS log FROM games WHERE id = $1`,
        [game.id],
      );
      const identical = sameLog(storedLog[0]?.log, moves);
      if (identical) {
        const rows = await this.deps.db.query<ResultRow>(resultQuery, [game.id]);
        return { kind: 'ok', result: toResult(rows[0]), stored: true };
      }
      return refuse(409, 'ALREADY_FINISHED', null);
    }

    // Step 6: replay move by move.
    const config: ReplayConfig = {
      mistakeLimit: limits.mistakeLimit,
      hintLimit: limits.hintLimit,
      moveLimit: limits.moveLimit,
      baseElapsedMs: game.start.elapsedMs,
    };
    const outcome = replayLog(game.puzzle, game.solution, game.start, moves, config);
    if (!outcome.ok) return refuse(422, outcome.failure!.code, outcome.failure!.move);

    // Step 7: the replayed board must be the solution.
    if (!boardSolved(outcome.engine)) return refuse(422, 'BOARD_UNSOLVED', null);

    const engine = outcome.engine;
    const seconds = Math.floor(moves[moves.length - 1].t / 1000);
    const resultScore = score(game.level, seconds, engine.mistakes, engine.hints);
    const finishedAt = new Date();
    const resultId = newId('rs');
    let dailyState: Result['daily_state'] = null;
    let dailyDate: string | null = null;
    if (isDaily && game.date) {
      const today = this.deps.todayInTz();
      dailyDate = game.date;
      dailyState = today === game.date ? 'solved' : 'late';
    }

    await this.deps.db.transaction(async (tx) => {
      // The counts-once rule, even when two identical finishes arrive at the
      // same moment: the row is only inserted when the game is not yet won.
      const updated = await tx.query<{ id: string }>(
        `UPDATE games SET status = 'won', move_log = $2::jsonb, elapsed_ms = $3, second_chance_used = $4
         WHERE id = $1 AND status <> 'won' RETURNING id`,
        [game.id, JSON.stringify(toWireMoves(moves)), Math.round(moves[moves.length - 1].t), engine.secondChanceUsed],
      );
      if (updated.length === 0) return;
      await tx.query(
        `INSERT INTO finished_games (id, game_id, player_id, level, mode, result, seconds, mistakes, hints, score, finished_at, daily_date, daily_state)
         VALUES ($1, $2, $3, $4, $5, 'won', $6, $7, $8, $9, $10, $11, $12)`,
        [resultId, game.id, game.player_id, game.level, game.mode, seconds, engine.mistakes, engine.hints, resultScore, finishedAt, dailyDate, dailyState],
      );
    });

    if (isDaily && game.date && dailyState === 'solved') {
      await this.deps.onDailyResult?.(game.player_id, game.date);
    }

    const result: Result = {
      id: resultId,
      level: game.level,
      seconds,
      mistakes: engine.mistakes,
      hints: engine.hints,
      score: resultScore,
      finished_at: finishedAt.toISOString(),
      daily_state: dailyState,
    };
    return { kind: 'ok', result, stored: false };
  }
}

function refuse(status: number, code: string, move: number | null): FinishOutcome {
  return { kind: 'refused', status, code, move };
}

interface ResultRow extends Record<string, unknown> {
  id: string;
  level: string;
  seconds: number;
  mistakes: number;
  hints: number;
  score: number;
  finished_at: Date;
  daily_state: string | null;
}

const resultQuery = `SELECT id, level, seconds, mistakes, hints, score, finished_at, daily_state FROM finished_games WHERE game_id = $1`;

function toResult(row: ResultRow): Result {
  return {
    id: row.id,
    level: row.level as Level,
    seconds: row.seconds,
    mistakes: row.mistakes,
    hints: row.hints,
    score: row.score,
    finished_at: new Date(row.finished_at).toISOString(),
    daily_state: (row.daily_state as Result['daily_state']) ?? null,
  };
}

// A log identical on the published fields: n, t, op, cell and digit, with
// other fields ignored. Logs are stored in the wire format, so a stored log
// is compared after normalising both sides the same way.
function toWireMoves(moves: ReturnType<typeof parseMoveLog>): Array<Record<string, unknown>> {
  return moves.map((m) => {
    const out: Record<string, unknown> = { n: m.n, t: m.t, op: m.op };
    if (m.cell !== undefined) out['cell'] = cellName(m.cell);
    if (m.digit !== undefined) out['digit'] = m.digit;
    return out;
  });
}

function cellName(index: number): string {
  return `r${Math.floor(index / 9) + 1}c${(index % 9) + 1}`;
}

function sameLog(stored: unknown, moves: ReturnType<typeof parseMoveLog>): boolean {
  let storedMoves;
  try {
    storedMoves = parseMoveLog(stored);
  } catch {
    return false;
  }
  if (storedMoves.length !== moves.length) return false;
  for (let i = 0; i < storedMoves.length; i++) {
    const a = storedMoves[i];
    const b = moves[i];
    if (a.n !== b.n || a.t !== b.t || a.op !== b.op || a.cell !== b.cell || a.digit !== b.digit) return false;
  }
  return true;
}

export async function finishCountedOnce(db: PostgresService, gameId: string): Promise<boolean> {
  const rows = await db.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM finished_games WHERE game_id = $1`,
    [gameId],
  );
  return Number(rows[0].n) === 1;
}

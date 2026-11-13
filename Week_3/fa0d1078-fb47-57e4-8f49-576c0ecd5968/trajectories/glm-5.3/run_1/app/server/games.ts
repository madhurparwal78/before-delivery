import type { PostgresService } from './postgres.js';
import { newId } from './auth.js';
import {
  type GameShape, type Result,
} from '../shared/api.js';
import { LEVELS, LEVEL_NAMES, puzzleById, type Level } from '../shared/puzzles.js';
import { newStartBoard, parseMoveLog, type StartBoard } from '../shared/moves.js';
import { decodeStart, encodeStart } from './seed.js';
import {
  boardSolved, replayLog, type ReplayConfig,
} from '../shared/engine.js';
import { formatClock } from '../shared/score.js';
import { dailyPuzzleId } from '../shared/daily.js';
import { cellIndexFromName } from '../shared/board.js';

export class ApiSeedError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export interface GradedGameInput {
  playerId: string;
  puzzleId: string;
  mode: 'solo' | 'daily';
  date: string | null;
  entries: Array<Record<string, unknown>>;
  notes: Array<Record<string, unknown>>;
  mistakes: number;
  hints: number;
  elapsedMs: number;
  secondChanceUsed: boolean;
}

export interface GradedFinishedInput {
  playerId: string;
  level: Level;
  result: 'won' | 'lost';
  seconds: number;
  mistakes: number;
  hints: number;
  score: number;
  finishedAt: Date;
}

export interface GradedDailyInput {
  playerId: string;
  date: string;
  seconds: number;
  mistakes: number;
  hints: number;
  score: number;
  finishedAt: Date;
  dailyState: 'solved' | 'late';
}

// Games: creation, saving, replay and finishing. The server owns the results;
// before a finished game counts, it replays the move log against the stored
// solution.

export interface GameRow {
  id: string;
  player_id: string;
  mode: 'solo' | 'daily';
  level: Level;
  puzzle_id: string;
  date: string | null;
  status: 'playing' | 'lost' | 'won' | 'abandoned';
  puzzle: string;
  solution: string;
  start: StartBoard;
  move_log: unknown[];
  elapsed_ms: string | number;
  result_id?: string | null;
  result_seconds?: number | null;
  result_mistakes?: number | null;
  result_hints?: number | null;
  result_score?: number | null;
  result_finished_at?: Date | null;
  result_daily_state?: string | null;
}

export interface GameLimits {
  mistakeLimit: number;
  hintLimit: number;
  moveLimit: number;
}

export interface SaveOutcome {
  status: 'playing' | 'lost' | 'won' | 'abandoned';
  elapsedMs: number;
  engineMistakes: number;
  engineHints: number;
  secondChanceUsed: boolean;
  solved: boolean;
}

export class GameService {
  constructor(
    private readonly db: PostgresService,
    private readonly limits: GameLimits,
  ) {}

  // A new solo game uses the level's fixture the player has started the
  // fewest times, ties to the lowest number.
  async pickSoloPuzzle(playerId: string, level: Level): Promise<string> {
    const fixtures = LEVELS.includes(level) ? [1, 2, 3].map((n) => `${level}-${n}`) : [];
    const counts = new Map<string, number>(
      fixtures.map((f) => [f, 0]),
    );
    const rows = await this.db.query<{ puzzle_id: string }>(
      `SELECT puzzle_id FROM games WHERE player_id = $1 AND mode = 'solo' AND level = $2`,
      [playerId, level],
    );
    for (const row of rows) {
      const n = (counts.get(row.puzzle_id) ?? 0) + 1;
      counts.set(row.puzzle_id, n);
    }
    let best = fixtures[0];
    let bestCount = counts.get(fixtures[0]) ?? 0;
    for (const f of fixtures.slice(1)) {
      const c = counts.get(f) ?? 0;
      if (c < bestCount) {
        best = f;
        bestCount = c;
      }
    }
    return best;
  }

  async createSoloGame(playerId: string, level: Level): Promise<GameRow> {
    const puzzleId = await this.pickSoloPuzzle(playerId, level);
    return this.insertGame(playerId, 'solo', level, puzzleId, null);
  }

  async createDailyGame(playerId: string, date: string): Promise<GameRow> {
    const puzzleId = dailyPuzzleId(date);
    return this.insertGame(playerId, 'daily', 'medium', puzzleId, date);
  }

  private async insertGame(playerId: string, mode: 'solo' | 'daily', level: Level, puzzleId: string, date: string | null): Promise<GameRow> {
    const fixture = puzzleById(puzzleId);
    if (!fixture) throw new Error('UNKNOWN_PUZZLE');
    const start = newStartBoard(fixture.puzzle);
    const encoded = encodeStart(start);
    const id = newId('gm');
    await this.db.query(
      `INSERT INTO games (id, player_id, mode, level, puzzle_id, date, status, puzzle, solution,
        start_entries, start_notes, start_mistakes, start_hints, start_elapsed_ms, second_chance_used, move_log, elapsed_ms)
       VALUES ($1, $2, $3, $4, $5, $6, 'playing', $7, $8, $9, $10, 0, 0, 0, FALSE, '[]'::jsonb, 0)`,
      [id, playerId, mode, level, puzzleId, date, fixture.puzzle, fixture.solution, encoded.entries, encoded.notes],
    );
    const loaded = await this.loadGame(id);
    if (!loaded) throw new Error('UNKNOWN_PUZZLE');
    return loaded;
  }

  async loadGame(id: string): Promise<GameRow | null> {
    const rows = await this.db.query<{
      id: string; player_id: string; mode: string; level: string; puzzle_id: string;
      date: string | null; status: string; puzzle: string; solution: string;
      start_entries: string; start_notes: string; start_mistakes: number; start_hints: number;
      start_elapsed_ms: string; second_chance_used: boolean; move_log: unknown[]; elapsed_ms: string;
      result_id: string | null; result_seconds: number | null; result_mistakes: number | null;
      result_hints: number | null; result_score: number | null; result_finished_at: Date | null;
      result_daily_state: string | null;
    }>(
      `SELECT g.*, f.id AS result_id, f.seconds AS result_seconds, f.mistakes AS result_mistakes,
              f.hints AS result_hints, f.score AS result_score, f.finished_at AS result_finished_at,
              f.daily_state AS result_daily_state
       FROM games g LEFT JOIN finished_games f ON f.game_id = g.id
       WHERE g.id = $1`,
      [id],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    const start = decodeStart(r.start_entries, r.start_notes);
    start.mistakes = r.start_mistakes;
    start.hints = r.start_hints;
    start.elapsedMs = Number(r.start_elapsed_ms);
    start.secondChanceUsed = r.second_chance_used;
    return {
      id: r.id,
      player_id: r.player_id,
      mode: r.mode as 'solo' | 'daily',
      level: r.level as Level,
      puzzle_id: r.puzzle_id,
      date: r.date,
      status: r.status as GameRow['status'],
      puzzle: r.puzzle,
      solution: r.solution,
      start,
      move_log: r.move_log,
      elapsed_ms: Number(r.elapsed_ms),
      result_id: r.result_id ?? undefined,
      result_seconds: r.result_seconds ?? undefined,
      result_mistakes: r.result_mistakes ?? undefined,
      result_hints: r.result_hints ?? undefined,
      result_score: r.result_score ?? undefined,
      result_finished_at: r.result_finished_at ?? undefined,
      result_daily_state: r.result_daily_state ?? undefined,
    };
  }

  async findDailyGame(playerId: string, date: string): Promise<GameRow | null> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM games WHERE player_id = $1 AND mode = 'daily' AND date = $2`,
      [playerId, date],
    );
    if (rows.length === 0) return null;
    return this.loadGame(rows[0].id);
  }

  async moveCount(id: string): Promise<number> {
    const rows = await this.db.query<{ n: string }>(
      `SELECT COALESCE(jsonb_array_length(move_log), 0) AS n FROM games WHERE id = $1`,
      [id],
    );
    return rows.length === 0 ? 0 : Number(rows[0].n);
  }

  // Starting a new solo game at a level abandons the player's playing solo
  // game at that level; a lost game at that level that is still open becomes
  // closed instead. A daily counts as Medium for this rule.
  async closeLevelGames(playerId: string, level: Level): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE games SET status = 'abandoned' WHERE player_id = $1 AND mode = 'solo' AND level = $2 AND status = 'playing'`,
        [playerId, level],
      );
      // An open lost game closes, which also records its finished row.
      const openLost = await tx.query<{ id: string; player_id: string }>(
        `SELECT id, player_id FROM games
         WHERE player_id = $1 AND mode = 'solo' AND level = $2 AND status = 'lost'
           AND NOT EXISTS (
             SELECT 1 FROM finished_games f WHERE f.game_id = games.id
           )`,
        [playerId, level],
      );
      for (const row of openLost) {
        await tx.query(
          `INSERT INTO finished_games (id, game_id, player_id, level, mode, result, seconds, mistakes, hints, score, finished_at, daily_date, daily_state)
           VALUES ($1, $2, $3, $4, 'solo', 'lost', 0, $5, 0, 0, now(), NULL, NULL)`,
          [newId('rs'), row.id, row.player_id, level, this.limits.mistakeLimit],
        );
      }
    });
  }

  // A lost game is open while its second chance is unused and no newer game
  // at its level has been started; otherwise it is closed.
  async isClosed(row: GameRow): Promise<boolean> {
    const exists = await this.db.query<{ id: string }>(
      `SELECT id FROM finished_games WHERE game_id = $1 AND result = 'lost'`,
      [row.id],
    );
    return exists.length > 0;
  }

  // ------------------------------------------------------------ grading

  // Seeded values form the game's start board. Seeded entries count as
  // correct entries and lock. SEED_INVALID when an entry is not the solution
  // digit or sits on a given, when a note sits on a non-empty cell, when a
  // daily's puzzle_id is not that date's puzzle or the player already has
  // that date's daily, or when mistakes reaches MISTAKE_LIMIT.
  async createGradedGame(input: GradedGameInput): Promise<{ id: string }> {
    const fixture = puzzleById(input.puzzleId);
    if (!fixture) throw new ApiSeedError('SEED_INVALID');
    if (input.mode === 'daily') {
      if (!input.date) throw new ApiSeedError('SEED_INVALID');
      if (dailyPuzzleId(input.date) !== input.puzzleId) throw new ApiSeedError('SEED_INVALID');
      const existing = await this.findDailyGame(input.playerId, input.date);
      if (existing) throw new ApiSeedError('SEED_INVALID');
    }
    const start = newStartBoard(fixture.puzzle);
    for (const e of input.entries) {
      const cell = cellIndexFromName(String(e['cell']));
      const digit = Number(e['digit']);
      if (cell < 0 || !Number.isInteger(digit) || digit < 1 || digit > 9) throw new ApiSeedError('SEED_INVALID');
      if (start.entries[cell] !== 0) throw new ApiSeedError('SEED_INVALID');
      if (digit !== Number(fixture.solution[cell])) throw new ApiSeedError('SEED_INVALID');
      start.entries[cell] = digit;
    }
    for (const n of input.notes) {
      const cell = cellIndexFromName(String(n['cell']));
      if (cell < 0) throw new ApiSeedError('SEED_INVALID');
      if (start.entries[cell] !== 0) throw new ApiSeedError('SEED_INVALID');
      const digits = n['digits'];
      if (!Array.isArray(digits)) throw new ApiSeedError('SEED_INVALID');
      const clean: number[] = [];
      for (const d of digits) {
        if (typeof d !== 'number' || d < 1 || d > 9) throw new ApiSeedError('SEED_INVALID');
        clean.push(d);
      }
      start.notes[cell] = clean.sort((a, b) => a - b);
    }
    if (input.mistakes >= this.limits.mistakeLimit) throw new ApiSeedError('SEED_INVALID');
    start.mistakes = input.mistakes;
    start.hints = input.hints;
    start.elapsedMs = input.elapsedMs;
    start.secondChanceUsed = input.secondChanceUsed;

    const id = newId('gm');
    const encoded = encodeStart(start);
    await this.db.query(
      `INSERT INTO games (id, player_id, mode, level, puzzle_id, date, status, puzzle, solution,
        start_entries, start_notes, start_mistakes, start_hints, start_elapsed_ms, second_chance_used, move_log, elapsed_ms)
       VALUES ($1, $2, $3, $4, $5, $6, 'playing', $7, $8, $9, $10, $11, $12, $13, $14, '[]'::jsonb, $13)`,
      [id, input.playerId, input.mode, fixture.level, input.puzzleId, input.date ?? null,
        fixture.puzzle, fixture.solution, encoded.entries, encoded.notes,
        start.mistakes, start.hints, start.elapsedMs, start.secondChanceUsed],
    );
    return { id };
  }

  async createGradedFinishedGame(input: GradedFinishedInput): Promise<{ id: string }> {
    const id = newId('rs');
    // The finished game must sit on a real game row.
    const gameId = newId('gm');
    const fixturePuzzle = '0'.repeat(81);
    await this.db.query(
      `INSERT INTO games (id, player_id, mode, level, puzzle_id, date, status, puzzle, solution,
        start_entries, start_notes, start_mistakes, start_hints, start_elapsed_ms, second_chance_used, move_log, elapsed_ms)
       VALUES ($1, $2, 'solo', $3, $4, NULL, $5, $6, $6, $6, '[]', $7, $8, $9, FALSE, '[]'::jsonb, $9)`,
      [gameId, input.playerId, input.level, `${input.level}-1`, input.result === 'won' ? 'won' : 'lost',
        fixturePuzzle, input.mistakes, input.hints, input.seconds * 1000],
    );
    await this.db.query(
      `INSERT INTO finished_games (id, game_id, player_id, level, mode, result, seconds, mistakes, hints, score, finished_at, daily_date, daily_state)
       VALUES ($1, $2, $3, $4, 'solo', $5, $6, $7, $8, $9, $10, NULL, NULL)`,
      [id, gameId, input.playerId, input.level, input.result, input.seconds, input.mistakes, input.hints, input.score, input.finishedAt],
    );
    return { id };
  }

  async createGradedDailyResult(input: GradedDailyInput): Promise<{ id: string }> {
    const id = newId('rs');
    const gameId = newId('gm');
    const fixture = puzzleById(dailyPuzzleId(input.date));
    if (!fixture) throw new ApiSeedError('SEED_INVALID');
    // The player may already have that date's daily game from an earlier seed.
    const existing = await this.findDailyGame(input.playerId, input.date);
    if (existing) {
      await this.db.query(
        `INSERT INTO finished_games (id, game_id, player_id, level, mode, result, seconds, mistakes, hints, score, finished_at, daily_date, daily_state)
         VALUES ($1, $2, $3, 'medium', 'daily', 'won', $4, $5, $6, $7, $8, $9, $10)`,
        [id, existing.id, input.playerId, input.seconds, input.mistakes, input.hints, input.score, input.finishedAt, input.date, input.dailyState],
      );
      return { id };
    }
    await this.db.query(
      `INSERT INTO games (id, player_id, mode, level, puzzle_id, date, status, puzzle, solution,
        start_entries, start_notes, start_mistakes, start_hints, start_elapsed_ms, second_chance_used, move_log, elapsed_ms)
       VALUES ($1, $2, 'daily', 'medium', $3, $4, 'won', $5, $6, $5, '[]', 0, 0, 0, FALSE, '[]'::jsonb, 0)`,
      [gameId, input.playerId, fixture.id, input.date, fixture.puzzle, fixture.solution],
    );
    await this.db.query(
      `INSERT INTO finished_games (id, game_id, player_id, level, mode, result, seconds, mistakes, hints, score, finished_at, daily_date, daily_state)
       VALUES ($1, $2, $3, 'medium', 'daily', 'won', $4, $5, $6, $7, $8, $9, $10)`,
      [id, gameId, input.playerId, input.seconds, input.mistakes, input.hints, input.score, input.finishedAt, input.date, input.dailyState],
    );
    return { id };
  }

  // Replays the whole log and stores it. The returned status becomes the
  // game's status; a replay that reaches the limit makes the game lost, and a
  // log that applies the second chance makes it playing again.
  async saveMoves(game: GameRow, rawMoves: unknown, elapsedMs: number): Promise<SaveOutcome | { error: string; move: number | null }> {
    void elapsedMs;
    let moves;
    try {
      moves = parseMoveLog(rawMoves);
    } catch {
      return { error: 'LOG_MALFORMED', move: null };
    }
    if (moves.length > this.limits.moveLimit) return { error: 'LOG_MALFORMED', move: null };
    const config: ReplayConfig = {
      mistakeLimit: this.limits.mistakeLimit,
      hintLimit: this.limits.hintLimit,
      moveLimit: this.limits.moveLimit,
      baseElapsedMs: game.start.elapsedMs,
    };
    const outcome = replayLog(game.puzzle, game.solution, game.start, moves, config);
    if (!outcome.ok) return { error: outcome.failure!.code, move: outcome.failure!.move };
    const engine = outcome.engine;
    const solved = boardSolved(engine);
    let status = game.status;
    if (game.status === 'playing' || game.status === 'lost') {
      if (solved) status = 'playing'; // finished separately by /finish
      else if (engine.mistakes >= this.limits.mistakeLimit && !engine.secondChanceUsed) status = 'lost';
      else status = 'playing';
    }
    const lastT = moves.length > 0 ? moves[moves.length - 1].t : game.start.elapsedMs;
    // Active times are whole milliseconds; a client may send fractional ones.
    const storedElapsed = Math.round(Math.max(game.start.elapsedMs, lastT, 0));
    await this.db.query(
      `UPDATE games SET move_log = $2::jsonb, elapsed_ms = $3, status = $4, second_chance_used = $5 WHERE id = $1`,
      [game.id, JSON.stringify(moves), storedElapsed, status, engine.secondChanceUsed],
    );
    return {
      status,
      elapsedMs: storedElapsed,
      engineMistakes: engine.mistakes,
      engineHints: engine.hints,
      secondChanceUsed: engine.secondChanceUsed,
      solved,
    };
  }

  toGameShape(row: GameRow, moves: number): GameShape {
    const start = row.start;
    const notes: Record<string, number[]> = {};
    start.notes.forEach((digits, i) => {
      if (digits.length > 0) notes[cellNameFor(i)] = digits;
    });
    const result = row.result_id
      ? {
        id: row.result_id as string,
        level: row.level,
        seconds: row.result_seconds as number,
        mistakes: row.result_mistakes as number,
        hints: row.result_hints as number,
        score: row.result_score as number,
        finished_at: (row.result_finished_at as Date).toISOString(),
        daily_state: (row.result_daily_state ?? null) as Result['daily_state'],
      }
      : null;
    return {
      id: row.id,
      mode: row.mode,
      level: row.level,
      puzzle_id: row.puzzle_id,
      date: row.date,
      status: row.status,
      puzzle: row.puzzle,
      solution: row.solution,
      start: {
        entries: start.entries,
        notes,
        mistakes: start.mistakes,
        hints: start.hints,
        elapsed_ms: start.elapsedMs,
        second_chance_used: start.secondChanceUsed,
      },
      moves,
      elapsed_ms: Number(row.elapsed_ms),
      result,
    };
  }
}

function cellNameFor(index: number): string {
  const row = Math.floor(index / 9) + 1;
  const col = (index % 9) + 1;
  return `r${row}c${col}`;
}

export { formatClock, LEVEL_NAMES };

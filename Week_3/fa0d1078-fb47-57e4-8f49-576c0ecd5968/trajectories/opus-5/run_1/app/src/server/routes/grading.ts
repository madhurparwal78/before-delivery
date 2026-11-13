import { isCellName, isDigit, type Cell, type Digit } from '../../shared/board';
import { isPlainDate } from '../../shared/dates';
import { dailyPuzzleId } from '../../shared/dates';
import { Game, type StartBoard, type StartEntry, type StartNote } from '../../shared/engine';
import { isLevel, puzzleById, type Level } from '../../shared/puzzles';
import { scoreFor } from '../../shared/score';
import { dateInDailyZone, serverNow, setServerNow } from '../clock';
import { config, engineLimits } from '../config';
import { query } from '../db';
import { ApiError } from '../errors';
import { sendJson, type Router } from '../http';
import { announceResult } from '../leaderboardStore';
import { createSession, hashPassword, newId, playerById } from '../players';

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError('VALIDATION');
  }
  return value as Record<string, unknown>;
}

function text(source: Record<string, unknown>, name: string): string {
  const value = source[name];
  if (typeof value !== 'string') throw new ApiError('VALIDATION');
  return value;
}

function count(source: Record<string, unknown>, name: string): number {
  const value = source[name];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ApiError('VALIDATION');
  }
  return Math.floor(value);
}

function flag(source: Record<string, unknown>, name: string): boolean {
  return source[name] === true;
}

function seedEntries(source: Record<string, unknown>): StartEntry[] {
  const raw = source.entries;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new ApiError('VALIDATION');
  return raw.map((item) => {
    const entry = record(item);
    if (!isCellName(entry.cell) || !isDigit(entry.digit)) throw new ApiError('SEED_INVALID');
    return { cell: entry.cell as Cell, digit: entry.digit as Digit };
  });
}

function seedNotes(source: Record<string, unknown>): StartNote[] {
  const raw = source.notes;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new ApiError('VALIDATION');
  return raw.map((item) => {
    const note = record(item);
    if (!isCellName(note.cell) || !Array.isArray(note.digits)) throw new ApiError('SEED_INVALID');
    const digits = note.digits.map((digit) => {
      if (!isDigit(digit)) throw new ApiError('SEED_INVALID');
      return digit as Digit;
    });
    return { cell: note.cell as Cell, digits };
  });
}

export function registerGradingRoutes(router: Router): void {
  router.post('/api/grading/players', async (context) => {
    const body = record(context.body);
    const asked = body.players;
    if (!Array.isArray(asked)) throw new ApiError('VALIDATION');
    const players: { key: string; player_id: string; session: string }[] = [];
    for (const item of asked) {
      const player = record(item);
      const email = text(player, 'email');
      const displayName = text(player, 'display_name');
      const id = newId();
      await query(
        `insert into players
           (id, email, email_lower, display_name, display_name_lower, password_hash, verified)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          email,
          email.toLowerCase(),
          displayName,
          displayName.toLowerCase(),
          await hashPassword(text(player, 'password')),
          flag(player, 'verified'),
        ],
      );
      players.push({
        key: text(player, 'key'),
        player_id: id,
        session: await createSession(id),
      });
    }
    sendJson(context.res, 201, { players });
  });

  router.post('/api/grading/games', async (context) => {
    const body = record(context.body);
    const playerId = text(body, 'player_id');
    const puzzleId = text(body, 'puzzle_id');
    const mode = text(body, 'mode');
    if (mode !== 'solo' && mode !== 'daily') throw new ApiError('VALIDATION');
    const fixture = puzzleById(puzzleId);
    if (!fixture) throw new ApiError('VALIDATION');
    const player = await playerById(playerId);
    if (!player) throw new ApiError('VALIDATION');

    let date: string | null = null;
    if (mode === 'daily') {
      date = text(body, 'date');
      if (!isPlainDate(date)) throw new ApiError('VALIDATION');
      if (dailyPuzzleId(date) !== puzzleId) throw new ApiError('SEED_INVALID');
      const existing = await query('select 1 from games where player_id = $1 and daily_date = $2', [
        playerId,
        date,
      ]);
      if ((existing.rowCount ?? 0) > 0) throw new ApiError('SEED_INVALID');
    }

    const mistakes = count(body, 'mistakes');
    if (mistakes >= config.mistakeLimit) throw new ApiError('SEED_INVALID');
    const start: StartBoard = {
      entries: seedEntries(body),
      notes: seedNotes(body),
      mistakes,
      hints: count(body, 'hints'),
      elapsed_ms: count(body, 'elapsed_ms'),
      second_chance_used: flag(body, 'second_chance_used'),
    };

    const board = new Game(fixture.puzzle, fixture.solution, start, engineLimits);
    for (const entry of start.entries) {
      if (board.isGiven(entry.cell)) throw new ApiError('SEED_INVALID');
      if (board.solutionDigit(entry.cell) !== entry.digit) throw new ApiError('SEED_INVALID');
    }
    for (const note of start.notes) {
      if (board.valueAt(note.cell) !== null) throw new ApiError('SEED_INVALID');
    }

    const id = newId();
    await query(
      `insert into games
         (id, player_id, mode, level, puzzle_id, daily_date, status, start_board, moves, elapsed_ms)
       values ($1, $2, $3, $4, $5, $6, 'playing', $7, '[]'::jsonb, $8)`,
      [id, playerId, mode, fixture.level, puzzleId, date, JSON.stringify(start), start.elapsed_ms],
    );
    sendJson(context.res, 201, { id, url: `/play/${id}` });
  });

  router.post('/api/grading/finished-games', async (context) => {
    const body = record(context.body);
    const playerId = text(body, 'player_id');
    const level = text(body, 'level');
    if (!isLevel(level)) throw new ApiError('VALIDATION');
    const outcome = text(body, 'result');
    if (outcome !== 'won' && outcome !== 'lost') throw new ApiError('VALIDATION');
    const player = await playerById(playerId);
    if (!player) throw new ApiError('VALIDATION');
    const finishedAt = text(body, 'finished_at');
    const elapsedMs = count(body, 'elapsed_ms');
    const mistakes = count(body, 'mistakes');
    const hints = count(body, 'hints');
    const seconds = Math.floor(elapsedMs / 1000);
    const score = outcome === 'won' ? scoreFor(level as Level, seconds, mistakes, hints) : null;

    const gameId = newId();
    const start: StartBoard = {
      entries: [],
      notes: [],
      mistakes,
      hints,
      elapsed_ms: elapsedMs,
      second_chance_used: false,
    };
    await query(
      `insert into games
         (id, player_id, mode, level, puzzle_id, status, start_board, moves, elapsed_ms, closed_at)
       values ($1, $2, 'solo', $3, $4, $5, $6, '[]'::jsonb, $7, $8)`,
      [
        gameId,
        playerId,
        level,
        `${level}-1`,
        outcome,
        JSON.stringify(start),
        elapsedMs,
        finishedAt,
      ],
    );
    await query(
      `insert into results
         (id, game_id, player_id, mode, level, outcome, seconds, mistakes, hints, score, finished_at)
       values ($1, $2, $3, 'solo', $4, $5, $6, $7, $8, $9, $10)`,
      [newId(), gameId, playerId, level, outcome, seconds, mistakes, hints, score, finishedAt],
    );
    sendJson(context.res, 201, { id: gameId });
  });

  router.post('/api/grading/daily-results', async (context) => {
    const body = record(context.body);
    const playerId = text(body, 'player_id');
    const date = text(body, 'date');
    if (!isPlainDate(date)) throw new ApiError('VALIDATION');
    const player = await playerById(playerId);
    if (!player) throw new ApiError('VALIDATION');
    const finishedAt = text(body, 'finished_at');
    const elapsedMs = count(body, 'elapsed_ms');
    const mistakes = count(body, 'mistakes');
    const hints = count(body, 'hints');
    const seconds = Math.floor(elapsedMs / 1000);
    const state = dateInDailyZone(new Date(finishedAt)) === date ? 'solved' : 'late';
    const id = newId();
    await query(
      `insert into results
         (id, game_id, player_id, mode, level, outcome, seconds, mistakes, hints, score,
          finished_at, daily_date, daily_state)
       values ($1, null, $2, 'daily', 'medium', 'won', $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        playerId,
        seconds,
        mistakes,
        hints,
        scoreFor('medium', seconds, mistakes, hints),
        finishedAt,
        date,
        state,
      ],
    );
    sendJson(context.res, 201, { id });
    if (state === 'solved' && player.verified) {
      await announceResult(date, player.display_name);
    }
  });

  router.post('/api/grading/clock', (context) => {
    const body = record(context.body);
    const asked = body.now;
    if (asked === null) {
      setServerNow(null);
    } else if (typeof asked === 'string') {
      const instant = new Date(asked);
      if (Number.isNaN(instant.getTime())) throw new ApiError('VALIDATION');
      setServerNow(instant);
    } else {
      throw new ApiError('VALIDATION');
    }
    sendJson(context.res, 200, { now: serverNow().toISOString() });
  });
}

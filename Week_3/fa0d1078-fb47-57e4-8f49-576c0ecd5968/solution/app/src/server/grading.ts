import { cellIndex, isDigit, toCellName } from "../shared/board";
import { isLevel } from "../shared/levels";
import type { StartBoard } from "../shared/moves";
import type { Player } from "../shared/protocol";
import { FIXTURES } from "../shared/puzzles";
import { createSession, hashPassword } from "./auth";
import { now, setClock } from "./clock";
import { config } from "./config";
import { isDate } from "../shared/dates";
import { dailyFixtureId } from "./daily";
import { only, query, queryOne, transaction } from "./db";
import { ApiError } from "./errors";
import { BLANK_START, nextFixtureId } from "./games";
import { announceResult } from "./leaderboard";

type Body = Record<string, unknown>;

/** The objects of a list in a request body; anything else reads as an empty list. */
const records = (value: unknown): Body[] => (Array.isArray(value) ? (value as Body[]) : []);

const invalid = (): ApiError => new ApiError("SEED_INVALID");

function whole(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function instant(value: unknown): Date {
  const parsed = typeof value === "string" ? new Date(value) : new Date(Number.NaN);
  if (Number.isNaN(parsed.getTime())) throw new ApiError("VALIDATION");
  return parsed;
}

export async function seedPlayers(body: Body): Promise<{ players: { key: string; player_id: string; session: string }[] }> {
  const specs = records(body.players);
  const players = [];
  for (const spec of specs) {
    const playerId = only(
      await query<{ id: string }>(
        `INSERT INTO players (email, display_name, password_hash, verified, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [spec.email, spec.display_name, await hashPassword(String(spec.password)), spec.verified === true, now()],
      ),
    ).id;
    players.push({ key: String(spec.key), player_id: playerId, session: await createSession(playerId) });
  }
  return { players };
}

function seedBoard(body: Body, puzzle: string, solution: string): StartBoard {
  const entries = records(body.entries).map((raw) => {
    const cell = toCellName(raw.cell);
    if (!cell || !isDigit(raw.digit)) throw invalid();
    const index = cellIndex(cell);
    if (puzzle[index] !== "0" || Number(solution[index]) !== raw.digit) throw invalid();
    return { cell, digit: raw.digit };
  });
  const taken = new Set(entries.map((entry) => entry.cell));
  const notes = records(body.notes).map((raw) => {
    const cell = toCellName(raw.cell);
    const digits = Array.isArray(raw.digits) ? raw.digits.filter(isDigit) : [];
    if (!cell || puzzle[cellIndex(cell)] !== "0" || taken.has(cell)) throw invalid();
    return { cell, digits };
  });
  const mistakes = whole(body.mistakes);
  if (mistakes >= config.rules.mistakeLimit) throw invalid();
  return {
    entries,
    notes,
    mistakes,
    hints: whole(body.hints),
    elapsed_ms: whole(body.elapsed_ms),
    second_chance_used: body.second_chance_used === true,
  };
}

export async function seedGame(body: Body): Promise<{ id: string; url: string }> {
  const fixture = FIXTURES.find((candidate) => candidate.id === body.puzzle_id);
  if (!fixture || (body.mode !== "solo" && body.mode !== "daily")) throw invalid();
  const start = seedBoard(body, fixture.puzzle, fixture.solution);
  const daily = body.mode === "daily";
  if (daily && (!isDate(body.date) || dailyFixtureId(body.date) !== fixture.id)) throw invalid();
  const inserted = await queryOne<{ id: string }>(
    `INSERT INTO games (player_id, mode, level, puzzle_id, daily_date, status, start_board, elapsed_ms, mistakes, hints, second_chance_used, created_at)
     VALUES ($1, $2, $3, $4, $5, 'playing', $6, $7, $8, $9, $10, $11)
     ON CONFLICT DO NOTHING RETURNING id`,
    [body.player_id, body.mode, fixture.level, fixture.id, daily ? body.date : null, start, start.elapsed_ms, start.mistakes, start.hints, start.second_chance_used, now()],
  );
  if (!inserted) throw invalid();
  return { id: inserted.id, url: `/play/${inserted.id}` };
}

export async function seedFinishedGame(body: Body): Promise<{ id: string }> {
  if (!isLevel(body.level) || (body.result !== "won" && body.result !== "lost")) throw new ApiError("VALIDATION");
  const finishedAt = instant(body.finished_at);
  const level = body.level;
  const won = body.result === "won";
  return transaction(async (tx) => {
    const puzzleId = await nextFixtureId(tx, String(body.player_id), level);
    const row = await tx<{ id: string }>(
      `INSERT INTO games (player_id, mode, level, puzzle_id, status, start_board, elapsed_ms, mistakes, hints, second_chance_used, created_at, lost_at, finished_at)
       VALUES ($1, 'solo', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [
        body.player_id, level, puzzleId, won ? "won" : "lost", BLANK_START,
        whole(body.elapsed_ms), whole(body.mistakes), whole(body.hints), !won, finishedAt, won ? null : finishedAt, won ? finishedAt : null,
      ],
    );
    return { id: only(row).id };
  });
}

export async function seedDailyResult(body: Body): Promise<{ id: string }> {
  if (!isDate(body.date)) throw new ApiError("VALIDATION");
  const finishedAt = instant(body.finished_at);
  const row = only(await query<{ id: string }>(
    `INSERT INTO games (player_id, mode, level, puzzle_id, daily_date, status, start_board, elapsed_ms, mistakes, hints, created_at, finished_at)
     VALUES ($1, 'daily', 'medium', $2, $3, 'won', $4, $5, $6, $7, $8, $8)
     ON CONFLICT (player_id, daily_date) WHERE mode = 'daily'
     DO UPDATE SET status = 'won', elapsed_ms = $5, mistakes = $6, hints = $7, finished_at = $8 RETURNING id`,
    [body.player_id, dailyFixtureId(body.date), body.date, BLANK_START, whole(body.elapsed_ms), whole(body.mistakes), whole(body.hints), finishedAt],
  ));
  const player = await queryOne<{ id: string; email: string; display_name: string; verified: boolean }>(
    "SELECT id, email, display_name, verified FROM players WHERE id = $1",
    [body.player_id],
  );
  if (player) await announceResult({ player_id: player.id, email: player.email, display_name: player.display_name, verified: player.verified } satisfies Player, body.date);
  return { id: row.id };
}

export function moveClock(body: Body): { now: string } {
  setClock(body.now === null ? null : instant(body.now));
  return { now: now().toISOString() };
}

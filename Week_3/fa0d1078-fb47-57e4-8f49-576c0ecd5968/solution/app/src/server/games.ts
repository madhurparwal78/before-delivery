import type { Game, Player, Result } from "../shared/protocol";
import { isLevel, type Level } from "../shared/levels";
import { initialBoard, isSolved, replay, type BoardState, type Move, type StartBoard } from "../shared/moves";
import { FIXTURES, fixtureById, type Fixture } from "../shared/puzzles";
import { score, wholeSeconds } from "../shared/score";
import { now } from "./clock";
import { config } from "./config";
import { isDate } from "../shared/dates";
import { dailyFixtureId, dailyStateOf, today } from "./daily";
import { only, query, queryOne, transaction, type Tx } from "./db";
import { ApiError } from "./errors";
import { parseMoveLog, sameLog } from "./move-log";

export interface GameRow {
  id: string;
  player_id: string;
  mode: "solo" | "daily";
  level: Level;
  puzzle_id: string;
  daily_date: string | null;
  status: Game["status"];
  start_board: StartBoard;
  moves: Move[];
  elapsed_ms: number;
  mistakes: number;
  hints: number;
  second_chance_used: boolean;
  lost_at: Date | null;
  finished_at: Date | null;
  superseded: boolean;
}

export const BLANK_START: StartBoard = { entries: [], notes: [], mistakes: 0, hints: 0, elapsed_ms: 0, second_chance_used: false };

/** Selects a game with `superseded`: whether a newer game at its level exists. */
export const GAME_COLUMNS = `g.id, g.player_id, g.mode, g.level, g.puzzle_id, g.daily_date, g.status, g.start_board, g.moves,
  g.elapsed_ms, g.mistakes, g.hints, g.second_chance_used, g.lost_at, g.finished_at,
  EXISTS (SELECT 1 FROM games n WHERE n.player_id = g.player_id AND n.level = g.level AND n.seq > g.seq) AS superseded`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resultOf(row: GameRow, finishedAt: Date): Result {
  const seconds = wholeSeconds(row.elapsed_ms);
  return {
    id: row.id,
    level: row.level,
    seconds,
    mistakes: row.mistakes,
    hints: row.hints,
    score: score(row.level, seconds, row.mistakes, row.hints),
    finished_at: finishedAt.toISOString(),
    daily_state: row.daily_date ? dailyStateOf(finishedAt, row.daily_date) : null,
  };
}

const isClosed = (row: GameRow): boolean =>
  row.status === "abandoned" || (row.status === "lost" && (row.second_chance_used || row.superseded));

function toGame(row: GameRow): Game {
  const fixture = fixtureById(row.puzzle_id);
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
    elapsed_ms: row.elapsed_ms,
    closed: isClosed(row),
    result: row.finished_at ? resultOf(row, row.finished_at) : null,
  };
}

async function findGame(player: Player, id: string): Promise<GameRow> {
  const row = UUID.test(id)
    ? await queryOne<GameRow>(`SELECT ${GAME_COLUMNS} FROM games g WHERE g.id = $1 AND g.player_id = $2`, [id, player.player_id])
    : undefined;
  if (!row) throw new ApiError("UNKNOWN_GAME");
  return row;
}

/** True when the player's game exists, for the document request of /play/<id>. */
export async function ownsGame(playerId: string, id: string): Promise<boolean> {
  return UUID.test(id) && (await queryOne("SELECT 1 FROM games WHERE id = $1 AND player_id = $2", [id, playerId])) !== undefined;
}

/** The level's fixture the player has started the fewest times; ties go to the lowest number. */
export async function nextFixtureId(tx: Tx, playerId: string, level: Level): Promise<string> {
  const rows = await tx<{ puzzle_id: string; started: string }>(
    "SELECT puzzle_id, count(*) AS started FROM games WHERE player_id = $1 AND mode = 'solo' AND level = $2 GROUP BY puzzle_id",
    [playerId, level],
  );
  const started = new Map(rows.map((row) => [row.puzzle_id, Number(row.started)]));
  const startedOf = (fixture: Fixture): number => started.get(fixture.id) ?? 0;
  const fewest = FIXTURES.filter((fixture) => fixture.level === level).reduce((best, fixture) => (startedOf(fixture) < startedOf(best) ? fixture : best));
  return fewest.id;
}

export async function createSoloGame(player: Player, level: unknown): Promise<Game> {
  if (!isLevel(level)) throw new ApiError("VALIDATION", { fields: { level: "Choose a level." } });
  const chosen = level;
  const id = await transaction(async (tx) => {
    await tx("SELECT pg_advisory_xact_lock(hashtext($1))", [`${player.player_id}:${chosen}`]);
    const puzzleId = await nextFixtureId(tx, player.player_id, chosen);
    await tx("UPDATE games SET status = 'abandoned' WHERE player_id = $1 AND level = $2 AND mode = 'solo' AND status = 'playing'", [
      player.player_id,
      chosen,
    ]);
    const created = await tx<{ id: string }>(
      `INSERT INTO games (player_id, mode, level, puzzle_id, status, start_board, created_at)
       VALUES ($1, 'solo', $2, $3, 'playing', $4, $5) RETURNING id`,
      [player.player_id, chosen, puzzleId, BLANK_START, now()],
    );
    return only(created).id;
  });
  return toGame(await findGame(player, id));
}

export async function getGame(player: Player, id: string): Promise<Game> {
  return toGame(await findGame(player, id));
}

function boardOf(row: GameRow): BoardState {
  const fixture = fixtureById(row.puzzle_id);
  return initialBoard(fixture.puzzle, fixture.solution, row.start_board);
}

function malformed(): ApiError {
  return new ApiError("LOG_MALFORMED", { move: null });
}

function replayLog(row: GameRow, moves: Move[]): BoardState {
  const outcome = replay(boardOf(row), moves, config.rules);
  if (outcome.failure) throw new ApiError(outcome.failure.failure.code, { move: outcome.failure.move });
  return outcome.state;
}

async function lockGame(tx: Tx, player: Player, id: string): Promise<GameRow> {
  const row = UUID.test(id)
    ? (await tx<GameRow>(`SELECT ${GAME_COLUMNS} FROM games g WHERE g.id = $1 AND g.player_id = $2 FOR UPDATE OF g`, [id, player.player_id]))[0]
    : undefined;
  if (!row) throw new ApiError("UNKNOWN_GAME");
  if (isClosed(row)) throw new ApiError("CLOSED_GAME");
  return row;
}

/** The saved active time of a `PUT moves` body, in whole ms. */
function elapsedOf(body: Record<string, unknown>): number {
  const elapsed = body.elapsed_ms;
  if (typeof elapsed !== "number" || !Number.isFinite(elapsed) || elapsed < 0) throw malformed();
  return Math.floor(elapsed);
}

/** Stores the move log after replaying it with the finish checks 1 to 6; the game's status follows the replay. */
export async function saveMoves(player: Player, id: string, body: Record<string, unknown>): Promise<Game> {
  await transaction(async (tx) => {
    const row = await lockGame(tx, player, id);
    if (row.status === "won") throw new ApiError("ALREADY_FINISHED");
    const elapsed = elapsedOf(body);
    const moves = parseMoveLog(body.moves);
    if (!moves) throw malformed();
    const state = replayLog(row, moves);
    const lost = state.standing.lost;
    await tx(
      `UPDATE games SET moves = $2, elapsed_ms = $3, mistakes = $4, hints = $5, second_chance_used = $6, status = $7,
         lost_at = CASE WHEN $7 = 'lost' THEN COALESCE($8, lost_at) ELSE NULL END WHERE id = $1`,
      [id, JSON.stringify(moves), elapsed, state.mistakes, state.hints, state.secondChanceUsed, lost ? "lost" : "playing", lost && row.status !== "lost" ? now() : null],
    );
  });
  return getGame(player, id);
}

interface Finish {
  result: Result;
  /** True for the finish that won the game; a resend of the same log is not counted again. */
  counted: boolean;
  date: string | null;
}

/** Replays the log against the stored solution; an honest finish counts once, a resend returns the stored result. */
export async function finishGame(player: Player, id: string, body: Record<string, unknown>): Promise<Finish> {
  return transaction(async (tx) => {
    const row = await lockGame(tx, player, id);
    const moves = parseMoveLog(body.moves);
    if (!moves) throw malformed();
    if (row.finished_at) {
      if (!sameLog(row.moves, moves)) throw new ApiError("ALREADY_FINISHED");
      return { result: resultOf(row, row.finished_at), counted: false, date: row.daily_date };
    }
    const state = replayLog(row, moves);
    if (!isSolved(state)) throw new ApiError("BOARD_UNSOLVED", { move: null });
    const finishedAt = now();
    const won = only(
      await tx<GameRow>(
        `UPDATE games g SET status = 'won', moves = $2, elapsed_ms = $3, mistakes = $4, hints = $5, second_chance_used = $6, finished_at = $7
         WHERE id = $1 RETURNING ${GAME_COLUMNS}`,
        [id, JSON.stringify(moves), Math.floor(state.lastT), state.mistakes, state.hints, state.secondChanceUsed, finishedAt],
      ),
    );
    return { result: resultOf(won, finishedAt), counted: true, date: won.daily_date };
  });
}

/** The player's game for a daily date, created on first open. */
export async function openDailyGame(player: Player, date: unknown): Promise<{ game: Game; created: boolean }> {
  if (!isDate(date) || date < config.dailyStart) throw new ApiError("DAILY_NOT_FOUND");
  if (date > today()) throw new ApiError("DAILY_NOT_OPEN");
  const inserted = await queryOne<{ id: string }>(
    `INSERT INTO games (player_id, mode, level, puzzle_id, daily_date, status, start_board, created_at)
     VALUES ($1, 'daily', 'medium', $2, $3, 'playing', $4, $5)
     ON CONFLICT (player_id, daily_date) WHERE mode = 'daily' DO NOTHING RETURNING id`,
    [player.player_id, dailyFixtureId(date), date, BLANK_START, now()],
  );
  const existing = inserted ?? only(await query<{ id: string }>("SELECT id FROM games WHERE player_id = $1 AND daily_date = $2 AND mode = 'daily'", [player.player_id, date]));
  return { game: await getGame(player, existing.id), created: inserted !== undefined };
}

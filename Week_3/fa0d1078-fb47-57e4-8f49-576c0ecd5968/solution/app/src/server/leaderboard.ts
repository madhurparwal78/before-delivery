import type { Leaderboard, LeaderboardRow, Player } from "../shared/protocol";
import { HIGHEST_SCORE, score, wholeSeconds } from "../shared/score";
import type { Level } from "../shared/levels";
import { config } from "./config";
import { dailyStateOf } from "./daily";
import { query } from "./db";
import { live, publish, valkey, valkeyReady } from "./valkey";

/** Seconds of play fit below this, so the standing keeps the score above the time. */
const STANDING_SPAN = 10_000_000;

interface ListedResult {
  player_id: string;
  display_name: string;
  level: Level;
  elapsed_ms: number;
  mistakes: number;
  hints: number;
  finished_at: Date;
  daily_date: string;
}

interface Ranked {
  player_id: string;
  row: LeaderboardRow;
}

const boardKey = (date: string): string => `seam:leaderboard:${date}`;

/** Verified players' on-day wins of one daily, from Postgres. */
async function listedResults(date: string, playerId?: string): Promise<ListedResult[]> {
  const rows = await query<ListedResult>(
    `SELECT g.player_id, p.display_name, g.level, g.elapsed_ms, g.mistakes, g.hints, g.finished_at, g.daily_date
     FROM games g JOIN players p ON p.id = g.player_id
     WHERE g.mode = 'daily' AND g.daily_date = $1 AND g.status = 'won' AND p.verified AND ($2::uuid IS NULL OR g.player_id = $2)`,
    [date, playerId ?? null],
  );
  return rows.filter((row) => dailyStateOf(row.finished_at, row.daily_date) === "solved");
}

const secondsOf = (row: ListedResult): number => wholeSeconds(row.elapsed_ms);

const scoreOf = (row: ListedResult): number => score(row.level, secondsOf(row), row.mistakes, row.hints);

/** A result's standing, lower is better: higher score first, then lower time. Equal standings share a rank. */
const standingOf = (row: ListedResult): number => (HIGHEST_SCORE - scoreOf(row)) * STANDING_SPAN + secondsOf(row);

/**
 * The one place the ranking is decided: by standing, then the earlier finish. Players with the same score and
 * time share a rank and the next rank skips (1, 2, 2, 4).
 */
function rank(results: readonly ListedResult[]): Ranked[] {
  const ordered = results
    .map((row) => ({ row, standing: standingOf(row), finishedAt: row.finished_at.getTime() }))
    .sort((a, b) => a.standing - b.standing || a.finishedAt - b.finishedAt);
  return ordered.slice(0, config.leaderboardSize).map((entry) => ({
    player_id: entry.row.player_id,
    row: {
      rank: 1 + ordered.filter((other) => other.standing < entry.standing).length,
      display_name: entry.row.display_name,
      seconds: secondsOf(entry.row),
      score: scoreOf(entry.row),
      mistakes: entry.row.mistakes,
      hints: entry.row.hints,
    },
  }));
}

async function ensureBoard(date: string): Promise<void> {
  if (await valkey.exists(boardKey(date))) return;
  const results = await listedResults(date);
  if (results.length > 0) await valkey.zadd(boardKey(date), ...results.flatMap((row) => [standingOf(row), row.player_id]));
}

async function boardRows(date: string, fromValkey: boolean): Promise<Ranked[]> {
  if (!fromValkey) return rank(await listedResults(date));
  await ensureBoard(date);
  const members = new Set(await valkey.zrange(boardKey(date), 0, -1));
  return rank((await listedResults(date)).filter((row) => members.has(row.player_id)));
}

export async function leaderboardFor(date: string): Promise<Leaderboard> {
  const isLive = valkeyReady();
  try {
    return { date, live: isLive, rows: (await boardRows(date, isLive)).map((entry) => entry.row) };
  } catch (error) {
    if (!isLive) throw error;
    return { date, live: false, rows: rank(await listedResults(date)).map((entry) => entry.row) };
  }
}

/** A verified player's on-day daily win: enters the ranking and every open leaderboard page for that date hears of it. */
export async function announceResult(player: Player, date: string): Promise<void> {
  if (!player.verified || !valkeyReady()) return;
  try {
    const [result] = await listedResults(date, player.player_id);
    if (!result) return;
    await ensureBoard(date);
    await live(() => valkey.zadd(boardKey(date), standingOf(result), player.player_id));
    const rows = await boardRows(date, true);
    const latest = rows.find((entry) => entry.player_id === player.player_id);
    if (!latest) return;
    await publish({ leaderboard: date }, {
      type: "leaderboard",
      date,
      rows: rows.map((entry) => entry.row),
      latest: { display_name: latest.row.display_name, rank: latest.row.rank },
    });
  } catch {
    // The result is already counted in Postgres; a Valkey failure only delays the live update.
  }
}

/** A player who just confirmed their email enters the ranking the next time each board is read. */
export async function forgetBoardsOf(playerId: string): Promise<void> {
  if (!valkeyReady()) return;
  const dates = await query<{ daily_date: string }>("SELECT DISTINCT daily_date FROM games WHERE player_id = $1 AND mode = 'daily' AND status = 'won'", [playerId]);
  if (dates.length > 0) await valkey.del(...dates.map((row) => boardKey(row.daily_date))).catch(() => undefined);
}

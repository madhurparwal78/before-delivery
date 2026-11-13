import { LEVELS, type Level } from "../shared/levels";
import type { FinishedGame, LevelStatistics, Player, Profile } from "../shared/protocol";
import { score, wholeSeconds } from "../shared/score";
import { dateInZone } from "./daily";
import { query } from "./db";
import { GAME_COLUMNS, type GameRow } from "./games";

const FINISHED_LIMIT = 20;

type SoloRow = GameRow & { closed_at: Date | null; seq: string };

const seconds = (row: GameRow): number => wholeSeconds(row.elapsed_ms);

function statistics(rows: readonly SoloRow[]): LevelStatistics {
  const won = rows.filter((row) => row.status === "won");
  const times = won.map(seconds);
  const total = times.reduce((sum, time) => sum + time, 0);
  return {
    started: rows.length,
    won: won.length,
    win_rate: rows.length > 0 ? Math.floor((won.length * 100) / rows.length + 0.5) : null,
    best_seconds: won.length > 0 ? Math.min(...times) : null,
    average_seconds: won.length > 0 ? Math.floor(total / won.length) : null,
    best_score: won.length > 0 ? Math.max(...won.map((row) => score(row.level, seconds(row), row.mistakes, row.hints))) : null,
  };
}

/** A won game finished when it was won; a lost game finished when it closed (its second chance used up, or a newer game started). */
function finishedAt(row: SoloRow): Date | null {
  if (row.status === "won") return row.finished_at;
  if (row.status !== "lost") return null;
  return row.second_chance_used ? row.lost_at : row.closed_at;
}

function finishedGames(rows: readonly SoloRow[]): FinishedGame[] {
  return rows
    .flatMap((row) => {
      const at = finishedAt(row);
      return at ? [{ row, at }] : [];
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime() || Number(b.row.seq) - Number(a.row.seq))
    .slice(0, FINISHED_LIMIT)
    .map(({ row, at }) => ({
      id: row.id,
      date: dateInZone(at),
      level: row.level,
      result: row.status === "won" ? "won" : "lost",
      seconds: seconds(row),
      score: row.status === "won" ? score(row.level, seconds(row), row.mistakes, row.hints) : null,
    }));
}

/** Every number is derived from the stored solo games when it is read, so it always equals a recount. */
export async function profileOf(player: Player): Promise<Profile> {
  const rows = await query<SoloRow>(
    `SELECT ${GAME_COLUMNS}, g.seq,
       (SELECT min(n.created_at) FROM games n WHERE n.player_id = g.player_id AND n.level = g.level AND n.seq > g.seq) AS closed_at
     FROM games g WHERE g.player_id = $1 AND g.mode = 'solo'`,
    [player.player_id],
  );
  const levels = Object.fromEntries(LEVELS.map((level) => [level, statistics(rows.filter((row) => row.level === level))])) as Record<Level, LevelStatistics>;
  return { levels, finished_games: finishedGames(rows) };
}

import { query } from '../db/pool.js';
import type { GameKind } from '../../shared/domain.js';
import type { LeaderboardEntry } from '../../shared/types.js';
import { instant } from '../util.js';

interface Row {
  character_id: string;
  name: string;
  result: { winners: number[] } | null;
  seats: { seat: number; character_id: string }[];
  finished_at: Date;
}

/**
 * Wins in games settled during the current season, ranked by standard
 * competition ranking, with ties ordered by when the win count was reached.
 */
export async function leaderboard(
  serverId: string,
  game: GameKind,
  season: number,
): Promise<LeaderboardEntry[]> {
  const rows = await query<{
    seats: { seat: number; character_id: string; name: string }[];
    result: { winners: number[] } | null;
    finished_at: Date;
  }>(
    `SELECT seats, result, finished_at
       FROM games
      WHERE server_id = $1 AND game = $2 AND season = $3 AND settled = true
      ORDER BY finished_at, id`,
    [serverId, game, season],
  );

  const wins = new Map<string, { name: string; wins: number; reachedAt: Date }>();
  for (const row of rows) {
    if (row.result === null) continue;
    for (const seat of row.seats) {
      if (!row.result.winners.includes(seat.seat)) continue;
      const found = wins.get(seat.character_id);
      if (found === undefined) {
        wins.set(seat.character_id, { name: seat.name, wins: 1, reachedAt: row.finished_at });
      } else {
        found.wins += 1;
        found.reachedAt = row.finished_at;
      }
    }
  }

  const listed = [...wins.entries()]
    .map(([characterId, value]) => ({
      character_id: characterId,
      name: value.name,
      wins: value.wins,
      reached_at: instant(value.reachedAt),
    }))
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return a.reached_at.localeCompare(b.reached_at);
    });

  const entries: LeaderboardEntry[] = [];
  let rank = 0;
  let placed = 0;
  let previousWins = -1;
  for (const entry of listed) {
    placed += 1;
    if (entry.wins !== previousWins) {
      rank = placed;
      previousWins = entry.wins;
    }
    entries.push({ rank, ...entry });
  }
  return entries;
}

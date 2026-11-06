/** Leaderboards: competition ranks over the season's wins. */

import type { Pool } from "../db/pool.js";

export interface LeaderboardEntry {
  rank: number;
  character_id: string;
  name: string;
  wins: number;
  reached_at: string;
}

export async function leaderboardEntries(
  pool: Pool,
  serverId: string,
  game: "chess" | "four" | "tricks"
): Promise<{ season: number; entries: LeaderboardEntry[] }> {
  const season = (await pool.query<{ season: number }>("SELECT season FROM servers WHERE id = $1", [serverId])).rows[0];
  const rows = await pool.query<{ character_id: string; name: string; wins: string; reached_at: Date }>(
    `SELECT w.character_id, c.name, count(*)::text AS wins, max(w.won_at) AS reached_at
     FROM wins w JOIN characters c ON c.id = w.character_id
     WHERE w.server_id = $1 AND w.season = $2 AND w.game = $3
     GROUP BY w.character_id, c.name`,
    [serverId, season?.season ?? 1, game]
  );
  const counted = rows.rows.map((r) => ({ ...r, winsN: Number(r.wins) }));
  counted.sort((a, b) => b.winsN - a.winsN || a.reached_at.getTime() - b.reached_at.getTime());
  const entries: LeaderboardEntry[] = [];
  let lastWins = -1;
  let lastRank = 0;
  for (const [i, row] of counted.entries()) {
    const rank = row.winsN === lastWins ? lastRank : i + 1;
    lastWins = row.winsN;
    lastRank = rank;
    entries.push({
      rank,
      character_id: row.character_id,
      name: row.name,
      wins: row.winsN,
      reached_at: iso(row.reached_at),
    });
  }
  return { season: season?.season ?? 1, entries };
}

function iso(date: Date): string {
  return `${date.toISOString().slice(0, 23)}Z`;
}

/** Starts a new season: the leaderboards empty. */
export async function startNewSeason(pool: Pool, serverId: string): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const server = (await client.query<{ season: number }>("SELECT season FROM servers WHERE id = $1 FOR UPDATE", [serverId])).rows[0];
    const next = (server?.season ?? 1) + 1;
    await client.query("UPDATE servers SET season = $2 WHERE id = $1", [serverId, next]);
    await client.query("INSERT INTO seasons (server_id, n) VALUES ($1, $2)", [serverId, next]);
    await client.query("COMMIT");
    const { publish } = await import("../api/events.js");
    for (const game of ["chess", "four", "tricks"] as const) {
      await publish(pool, serverId, [{ kind: "leaderboard", payload: { game, season: next, entries: [] } }]);
    }
    return next;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // already closed
    }
    throw err;
  } finally {
    client.release();
  }
}

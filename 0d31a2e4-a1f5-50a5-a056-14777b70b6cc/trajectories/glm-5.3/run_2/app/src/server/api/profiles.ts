import type { Pool } from "pg";
import { ApiError } from "../http.js";
import { hueFor, roundName } from "../../shared/domain.js";
import { friendState } from "./friends.js";
import { findUserByHandle } from "../db/users.js";
import type { Hub } from "./hub.js";

export async function profileView(pool: Pool, handle: string, viewerId: number | null, hub: Hub) {
  const user = await findUserByHandle(pool, handle);
  if (!user) throw new ApiError(404, "user_not_found", "No player called that.");

  const played = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM matches m
      WHERE m.state = 'finished'
        AND EXISTS (
          SELECT 1 FROM rounds r
           WHERE r.match_id = m.id AND r.n = 1 AND $1 = ANY (r.starters)
        )`,
    [user.id]
  );
  const wins = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM matches WHERE state = 'finished' AND winner_id = $1",
    [user.id]
  );

  const friendship = viewerId && viewerId !== user.id ? await friendState(pool, viewerId, user.id) : "none";

  let presence: "offline" | "online" | "in_party" | "in_match" | null = null;
  if (viewerId && viewerId !== user.id && friendship === "friends") {
    presence = await hub.presenceOf(user.id);
  }

  const matchRows = await pool.query<{ id: number; finished_at: Date; winner_id: number | null; eliminated_round: number | null }>(
    `SELECT m.id, m.finished_at, m.winner_id, (
       SELECT min(r.round_n) FROM round_results r
        WHERE r.match_id = m.id AND r.user_id = $1 AND r.outcome = 'eliminated'
     ) AS eliminated_round
       FROM matches m
      WHERE m.state = 'finished'
        AND EXISTS (
          SELECT 1 FROM rounds r
           WHERE r.match_id = m.id AND r.n = 1 AND $1 = ANY (r.starters)
        )
      ORDER BY m.finished_at DESC, m.id DESC
      LIMIT 20`,
    [user.id]
  );

  return {
    user: { id: user.id, handle: user.handle, hue: hueFor(user.id) },
    friendship,
    presence,
    played: (played.rows[0] as { count: number }).count,
    wins: (wins.rows[0] as { count: number }).count,
    matches: matchRows.rows.map((row) => ({
      id: row.id,
      name: `Cup #${row.id}`,
      finishedAt: row.finished_at.toISOString(),
      outcome: row.winner_id === user.id ? ("winner" as const) : ("eliminated" as const),
      round: row.winner_id === user.id ? null : row.eliminated_round
    }))
  };
}

export function placementText(outcome: "winner" | "eliminated", round: number | null): string {
  if (outcome === "winner") return "Winner";
  return `Out in ${roundName(round ?? 1)}`;
}

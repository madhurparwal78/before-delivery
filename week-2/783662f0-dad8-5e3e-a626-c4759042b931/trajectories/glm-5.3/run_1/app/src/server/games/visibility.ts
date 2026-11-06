/** The card visibility filter: the one place that decides who may see which cards. */

import type { Pool } from "../db/pool.js";

export interface GameRow {
  id: string;
  table_id: string;
  game: "chess" | "four" | "tricks";
  seed: string | null;
  state: "in_play" | "finished";
  hands: Record<string, string[]> | null;
}

/** A card in a hand that has not been played reaches only its holder until the hand ends.
 * Once the hand ends, every read shows the seed and all dealt hands. */
export function filterHands(
  game: GameRow,
  viewer: { userId: string; seatOfUser: number | null } | null,
  handOver: boolean
): { seed: string | null; hands: Record<string, string[]> | null } {
  if (game.game !== "tricks") return { seed: null, hands: null };
  if (handOver) {
    return { seed: game.seed, hands: game.hands };
  }
  if (viewer === null || viewer.seatOfUser === null || game.hands === null) {
    return { seed: null, hands: null };
  }
  const own = game.hands[String(viewer.seatOfUser)];
  if (own === undefined) return { seed: null, hands: null };
  return { seed: null, hands: { [String(viewer.seatOfUser)]: own } };
}

export async function gameHandOver(pool: Pool, gameId: string): Promise<boolean> {
  const res = await pool.query<{ result: unknown }>("SELECT result FROM game_results WHERE game_id = $1", [gameId]);
  if (res.rows.length === 0) return false;
  const result = res.rows[0]!.result as { reason?: string };
  return result?.reason === "hand_over";
}

/** The replay of an unfinished hand stops at the last played card: nothing more to filter. */
export function replayVisibleHands(game: GameRow, upToMoves: string[], totalMoves: number): { seed: string | null; hands: Record<string, string[]> | null } {
  void upToMoves;
  if (game.game !== "tricks") return { seed: null, hands: null };
  const handOver = totalMoves >= 52;
  return filterHands(game, null, handOver);
}

/** Game records and replays: what a member may read, with the hidden-cards rule. */

import type { Pool } from "../db/pool.js";
import * as chess from "./chess.js";
import * as four from "./four.js";
import * as cards from "./cards.js";
import { SeatLabels } from "../../shared/data.js";
import { isoInstant } from "../time.js";

export interface GameRecord {
  id: string;
  table_id: string;
  table_name: string;
  game: "chess" | "four" | "tricks";
  seats: { seat: number; label: string; character: { id: string; name: string } | null }[];
  moves: { seat: number; move: string; announcement: string }[];
  position: unknown;
  result: unknown;
  settled: boolean;
  started_at: string;
  finished_at: string | null;
  seed: string | null;
  hands: Record<string, string[]> | null;
}

/** One visibility filter decides who sees which cards (DP-76, DP-82). */
function visibleHands(
  game: { game: "chess" | "four" | "tricks"; hands: Record<string, string[]> | null; seed: string | null; finished: boolean; handOver: boolean },
  viewerSeat: number | null
): { seed: string | null; hands: Record<string, string[]> | null } {
  if (game.game !== "tricks") return { seed: null, hands: null };
  if (game.handOver) {
    return { seed: game.seed, hands: game.hands };
  }
  if (viewerSeat === null || game.hands === null) {
    return { seed: null, hands: null };
  }
  const own = game.hands[String(viewerSeat)];
  return own === undefined ? { seed: null, hands: null } : { seed: null, hands: { [String(viewerSeat)]: own } };
}

export async function gameRecord(pool: Pool, gameId: string, userId: string): Promise<GameRecord | null> {
  const row = (
    await pool.query<{
      id: string;
      table_id: string;
      table_name: string;
      server_id: string;
      game: "chess" | "four" | "tricks";
      seed: string | null;
      state: string;
      position: unknown;
      hands: Record<string, string[]> | null;
      started_at: Date;
      finished_at: Date | null;
    }>(
      `SELECT g.id, g.table_id, t.name AS table_name, t.server_id, t.game, g.seed, g.state, g.position, g.hands, g.started_at, g.finished_at
       FROM games g JOIN tables_ t ON t.id = g.table_id WHERE g.id = $1`,
      [gameId]
    )
  ).rows[0];
  if (row === undefined) return null;
  const member = (await pool.query("SELECT 1 FROM members WHERE server_id = $1 AND user_id = $2", [row.server_id, userId])).rows;
  if (member.length === 0) return null;
  const seatRows = (
    await pool.query<{ seat: number; character_id: string; name: string }>(
      "SELECT s.seat, s.character_id, c.name FROM seats s JOIN characters c ON c.id = s.character_id WHERE s.table_id = $1 ORDER BY s.seat",
      [row.table_id]
    )
  ).rows;
  const viewerSeatRow = (
    await pool.query<{ seat: number }>(
      "SELECT s.seat FROM seats s JOIN characters c ON c.id = s.character_id WHERE s.table_id = $1 AND c.user_id = $2",
      [row.table_id, userId]
    )
  ).rows[0];
  const moves = (
    await pool.query<{ seat: number; move: string; announcement: string }>(
      "SELECT seat, move, announcement FROM game_moves WHERE game_id = $1 ORDER BY seq",
      [gameId]
    )
  ).rows;
  const result = (
    await pool.query<{ result: unknown; stored: boolean }>("SELECT result, stored FROM game_results WHERE game_id = $1", [gameId])
  ).rows[0];
  const handOver = (result?.result as { reason?: string } | undefined)?.reason === "hand_over";
  const visible = visibleHands(
    { game: row.game, hands: row.hands, seed: row.seed, finished: row.state === "finished", handOver },
    viewerSeatRow?.seat ?? null
  );
  return {
    id: row.id,
    table_id: row.table_id,
    table_name: row.table_name,
    game: row.game,
    seats: seatRows.map((s) => ({ seat: s.seat, label: (SeatLabels[row.game] ?? ["Seat"])[s.seat - 1] ?? "Seat", character: { id: s.character_id, name: s.name } })),
    moves,
    position: row.position,
    result: result?.result ?? null,
    settled: result?.stored ?? false,
    started_at: isoInstant(row.started_at),
    finished_at: row.finished_at === null ? null : isoInstant(row.finished_at),
    seed: visible.seed,
    hands: visible.hands,
  };
}

export interface ReplayView {
  game_id: string;
  stored: { position: unknown; result: unknown };
  replayed: { position: unknown; result: unknown };
  match: boolean;
}

/** Replays a finished game from its stored log; an unfinished hand stops at the last played card. */
export async function gameReplay(pool: Pool, gameId: string, userId: string): Promise<ReplayView | null> {
  const record = await gameRecord(pool, gameId, userId);
  if (record === null) return null;
  const moves = record.moves.map((m) => m.move);
  const storedResult = record.result as { winners?: number[]; reason?: string; text?: string } | null;
  let position: unknown = null;
  let result: unknown = null;
  if (record.game === "chess") {
    const fens = chessFenHistory(moves);
    position = { fen: fens[fens.length - 1] ?? chess.StartFen };
    const winnerSeat = storedResult?.winners?.[0] ?? (moves.length % 2 === 0 ? 1 : 2);
    result = { ...storedResult, winners: [winnerSeat] };
  } else if (record.game === "four") {
    const replay = four.replayDrops(moves);
    position = { rows: replay.rows };
    result = storedResult;
  } else {
    const seed = record.seed ?? "";
    const firstSeat = ((record.position as { first_seat?: number })?.first_seat ?? 1) as number;
    const replayed = cards.replayHand(seed, firstSeat, moves);
    const stored = record.position as { trick: unknown; led_suit: string | null; tricks_won: number[] };
    position = { ...stored, tricks_won: replayed.tricks_won };
    result = storedResult;
  }
  return {
    game_id: gameId,
    stored: { position: record.position, result: record.result },
    replayed: { position, result },
    match: JSON.stringify(position) === JSON.stringify(record.position),
  };
}

/** The fen after every accepted move, from the start position. */
export function chessFenHistory(moves: string[]): string[] {
  const fens = [chess.StartFen];
  let fen = chess.StartFen;
  for (const [i, move] of moves.entries()) {
    const seat = (i % 2 === 0 ? 1 : 2) as 1 | 2;
    const outcome = chess.playMove(fen, move, seat, fens);
    fen = outcome.fen;
    fens.push(fen);
  }
  return fens;
}

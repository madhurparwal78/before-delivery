/** Table serialization: the Table object as filtered for each subscriber. */

import type { Pool } from "../db/pool.js";
import { SeatLabels } from "../../shared/data.js";

export interface TableRow {
  id: string;
  server_id: string;
  world_id: string;
  name: string;
  game: "chess" | "four" | "tricks";
  x: number;
  y: number;
  state: "open" | "seated" | "in_play" | "finished" | "settled";
  stake: number;
  turn_seconds: number;
  etag: string;
}

export interface SeatRow {
  table_id: string;
  seat: number;
  character_id: string;
}

export interface GameRow {
  id: string;
  table_id: string;
  server_id: string;
  game: "chess" | "four" | "tricks";
  seed: string | null;
  state: "in_play" | "finished";
  turn: number;
  to_move_seat: number | null;
  position: unknown;
  hands: Record<string, string[]> | null;
  turn_deadline: Date | null;
  rematch_offers: string[];
  started_at: Date;
  finished_at: Date | null;
}

export interface ResultRow {
  game_id: string;
  result: ResultPayload;
  stored: boolean;
  storing: boolean;
}

export interface ResultPayload {
  outcome: "win" | "draw" | "forfeit" | "abandoned";
  reason: string;
  winners: number[];
  text: string;
  settlement: { character_id: string; amount: number }[];
}

export interface TableView {
  id: string;
  name: string;
  game: "chess" | "four" | "tricks";
  world: string;
  x: number;
  y: number;
  state: "open" | "seated" | "in_play" | "finished" | "settled";
  stake: number;
  turn_seconds: number;
  seats: { seat: number; label: string; character: { id: string; name: string } | null }[];
  spectators: { id: string; name: string }[];
  game_id: string | null;
  turn: number | null;
  to_move_seat: number | null;
  turn_remaining_ms: number | null;
  position: unknown;
  hand: string[] | null;
  hand_counts: number[] | null;
  result: ResultPayload | null;
  settled: boolean;
  pending_store: boolean;
  rematch_offers: number[];
}

export async function loadTable(pool: Pool, tableId: string): Promise<TableRow | null> {
  const res = await pool.query<TableRow>("SELECT * FROM tables_ WHERE id = $1", [tableId]);
  return res.rows[0] ?? null;
}

export async function characterNames(pool: Pool, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const res = await pool.query<{ id: string; name: string }>("SELECT id, name FROM characters WHERE id = ANY($1)", [ids]);
  return new Map(res.rows.map((r) => [r.id, r.name]));
}

export async function seatCountOf(game: "chess" | "four" | "tricks"): Promise<number> {
  return game === "tricks" ? 4 : 2;
}

/** Builds the Table object filtered for one subscriber: hidden hands stay hidden. */
export async function tableView(pool: Pool, table: TableRow, viewer: { userId: string } | null): Promise<TableView> {
  const seats = await pool.query<SeatRow>("SELECT seat, character_id FROM seats WHERE table_id = $1 ORDER BY seat", [table.id]);
  const seatCharacters = await characterNames(pool, seats.rows.map((s) => s.character_id));
  const seatCount = await seatCountOf(table.game);
  const seatList: TableView["seats"] = [];
  for (let n = 1; n <= seatCount; n++) {
    const seated = seats.rows.find((s) => s.seat === n);
    seatList.push({
      seat: n,
      label: (SeatLabels[table.game] ?? ["Seat"])[n - 1] ?? "Seat",
      character: seated === undefined ? null : { id: seated.character_id, name: seatCharacters.get(seated.character_id) ?? "?" },
    });
  }

  const spectatorRows = await pool.query<{ character_id: string }>("SELECT character_id FROM spectators WHERE table_id = $1 ORDER BY character_id", [table.id]);
  const specNames = await characterNames(pool, spectatorRows.rows.map((s) => s.character_id));
  const spectators = spectatorRows.rows.map((s) => ({ id: s.character_id, name: specNames.get(s.character_id) ?? "?" }));

  const latestGame = await pool.query<GameRow>("SELECT * FROM games WHERE table_id = $1 ORDER BY started_at DESC LIMIT 1", [table.id]);
  const game = latestGame.rows[0] ?? null;

  let position: unknown = null;
  let hand: string[] | null = null;
  let handCounts: number[] | null = null;
  let turn: number | null = null;
  let toMoveSeat: number | null = null;
  let remainingMs: number | null = null;
  let result: ResultPayload | null = null;
  let pendingStore = false;
  let rematchOffers: number[] = [];
  let gameId: string | null = null;

  if (game !== null) {
    gameId = game.id;
    position = game.position;
    turn = game.turn;
    toMoveSeat = game.to_move_seat;
    remainingMs = game.state === "in_play" && game.turn_deadline !== null ? Math.max(0, game.turn_deadline.getTime() - Date.now()) : null;
    rematchOffers = game.rematch_offers.map((s) => Number(s)).sort((a, b) => a - b);
    const resultRow = await pool.query<ResultRow>("SELECT * FROM game_results WHERE game_id = $1", [game.id]);
    if (resultRow.rows.length > 0) {
      result = resultRow.rows[0]!.result;
      pendingStore = !resultRow.rows[0]!.stored;
    }
    if (table.game === "tricks" && game.hands !== null) {
      const hands = game.hands;
      if (hands !== null) {
        handCounts = [1, 2, 3, 4].map((n) => (hands[String(n)] ?? []).length);
      }
      const handOver = result?.reason === "hand_over";
      if (viewer !== null && !handOver && game.hands !== null) {
        const mine = await pool.query<{ seat: number }>(
          "SELECT s.seat FROM seats s JOIN characters c ON c.id = s.character_id WHERE s.table_id = $1 AND c.user_id = $2",
          [table.id, viewer.userId]
        );
        if (mine.rows.length > 0) {
          hand = (game.hands !== null ? game.hands[String(mine.rows[0]!.seat)] : undefined) ?? null;
        }
      }
    }
  }

  const world = await pool.query<{ slug: string }>("SELECT slug FROM worlds WHERE id = $1", [table.world_id]);

  return {
    id: table.id,
    name: table.name,
    game: table.game,
    world: world.rows[0]?.slug ?? "",
    x: table.x,
    y: table.y,
    state: table.state,
    stake: table.stake,
    turn_seconds: table.turn_seconds,
    seats: seatList,
    spectators,
    game_id: gameId,
    turn,
    to_move_seat: toMoveSeat,
    turn_remaining_ms: remainingMs,
    position,
    hand,
    hand_counts: handCounts,
    result,
    settled: table.state === "settled",
    pending_store: pendingStore,
    rematch_offers: rematchOffers,
  };
}

/** The table engine: seats, the table lifecycle, moves, the turn clock, forfeits, timeouts
 * and rematches. Every rule is decided only here. */

import type { Pool, Client } from "../db/pool.js";
import { newId } from "../db/seed.js";
import { Copy } from "../../shared/copy.js";
import { SeatLabels } from "../../shared/data.js";
import * as chess from "../games/chess.js";
import * as four from "../games/four.js";
import * as cards from "../games/cards.js";
import { writeLedgerEntry, availableCoins } from "../coins/ledger.js";
import { publish } from "../api/events.js";
import { isoInstant } from "../time.js";

export type SeatError = "table_full" | "already_seated" | "too_far" | "insufficient_coins";

export interface SeatOutcome {
  ok: boolean;
  seat?: number;
  error?: SeatError;
}

export interface SeatInput {
  tableId: string;
  characterId: string;
}

/** Takes the lowest free seat under the table's row lock, so exactly one player wins a contested seat. */
export async function takeSeat(pool: Pool, input: SeatInput): Promise<SeatOutcome> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const table = (await client.query<TableLockRow>("SELECT * FROM tables_ WHERE id = $1 FOR UPDATE", [input.tableId])).rows[0];
    if (table === undefined) {
      await client.query("ROLLBACK");
      return { ok: false, error: "table_full" };
    }
    const seatCount = table.game === "tricks" ? 4 : 2;
    const seats = await client.query<{ seat: number }>("SELECT seat FROM seats WHERE table_id = $1 ORDER BY seat", [input.tableId]);
    const taken = new Set(seats.rows.map((s) => s.seat));
    const seat = (await client.query<{ seat: number }>(
      "SELECT seat FROM seats WHERE character_id = $1",
      [input.characterId]
    )).rows[0];
    if (seat !== undefined) {
      await client.query("ROLLBACK");
      return { ok: false, error: "already_seated" };
    }
    const userSeat = await client.query<{ seat: number }>(
      "SELECT s.seat FROM seats s JOIN characters c ON c.id = s.character_id WHERE s.table_id = $1 AND c.user_id = (SELECT user_id FROM characters WHERE id = $2)",
      [input.tableId, input.characterId]
    );
    if (userSeat.rows.length > 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "already_seated" };
    }
    const free: number[] = [];
    for (let n = 1; n <= seatCount; n++) {
      if (!taken.has(n)) free.push(n);
    }
    if (free.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "table_full" };
    }
    const mine = free[0]!;
    const available = await availableCoins(client, input.characterId);
    if (available < table.stake) {
      await client.query("ROLLBACK");
      return { ok: false, error: "insufficient_coins" };
    }
    await client.query("INSERT INTO seats (table_id, seat, character_id) VALUES ($1,$2,$3)", [input.tableId, mine, input.characterId]);
    const nowTaken = taken.size + 1;
    if (nowTaken === seatCount) {
      await client.query("UPDATE tables_ SET state = 'seated', etag = $2 WHERE id = $1", [input.tableId, newId()]);
    }
    await client.query("COMMIT");
    await publishTable(input.tableId);
    return { ok: true, seat: mine };
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

interface TableLockRow {
  id: string;
  game: "chess" | "four" | "tricks";
  state: string;
  stake: number;
  turn_seconds: number;
  server_id: string;
}

export async function watchTable(pool: Pool, tableId: string, characterId: string): Promise<boolean> {
  const res = await pool.query(
    "INSERT INTO spectators (table_id, character_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
    [tableId, characterId]
  );
  await publishTable(tableId);
  return res.rowCount === 1;
}

export async function unwatchTable(pool: Pool, tableId: string, characterId: string): Promise<void> {
  await pool.query("DELETE FROM spectators WHERE table_id = $1 AND character_id = $2", [tableId, characterId]);
  await publishTable(tableId);
}

export type StandError = "not_seated" | "game_in_play" | "not_settled";

export async function standUp(pool: Pool, tableId: string, characterId: string): Promise<{ ok: boolean; error?: StandError }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const table = (await client.query<TableLockRow>("SELECT * FROM tables_ WHERE id = $1 FOR UPDATE", [tableId])).rows[0];
    if (table === undefined) {
      await client.query("ROLLBACK");
      return { ok: false, error: "not_seated" };
    }
    if (table.state === "in_play") {
      await client.query("ROLLBACK");
      return { ok: false, error: "game_in_play" };
    }
    if (table.state === "finished") {
      await client.query("ROLLBACK");
      return { ok: false, error: "not_settled" };
    }
    const deleted = await client.query("DELETE FROM seats WHERE table_id = $1 AND character_id = $2", [tableId, characterId]);
    if (deleted.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "not_seated" };
    }
    await client.query("DELETE FROM spectators WHERE table_id = $1 AND character_id = $2", [tableId, characterId]);
    const remaining = await client.query<{ n: string }>("SELECT count(*)::text AS n FROM seats WHERE table_id = $1", [tableId]);
    if (Number(remaining.rows[0]?.n ?? 0) === 0) {
      const latest = await client.query<{ id: string }>("SELECT id FROM games WHERE table_id = $1 ORDER BY started_at DESC LIMIT 1", [tableId]);
      if (latest.rows.length > 0) {
        await client.query("UPDATE games SET rematch_offers = '{}' WHERE id = $1", [latest.rows[0]!.id]);
      }
      await client.query("UPDATE tables_ SET state = 'open', etag = $2 WHERE id = $1", [tableId, newId()]);
    }
    await client.query("COMMIT");
    await publishTable(tableId);
    return { ok: true };
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

export type StartError = "not_seated" | "table_not_full" | "game_in_play" | "not_settled" | "rematch_required" | "insufficient_coins";

export async function startGame(pool: Pool, tableId: string, characterId: string): Promise<{ ok: boolean; announcement: string; error?: StartError }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const table = (await client.query<TableLockRow>("SELECT * FROM tables_ WHERE id = $1 FOR UPDATE", [tableId])).rows[0];
    if (table === undefined) {
      await client.query("ROLLBACK");
      return { ok: false, announcement: "", error: "not_seated" };
    }
    if (table.state === "open") {
      await client.query("ROLLBACK");
      return { ok: false, announcement: "", error: "table_not_full" };
    }
    if (table.state === "in_play") {
      await client.query("ROLLBACK");
      return { ok: false, announcement: "", error: "game_in_play" };
    }
    if (table.state === "finished") {
      await client.query("ROLLBACK");
      return { ok: false, announcement: "", error: "not_settled" };
    }
    if (table.state === "settled") {
      await client.query("ROLLBACK");
      return { ok: false, announcement: "", error: "rematch_required" };
    }
    const seatCount = table.game === "tricks" ? 4 : 2;
    const seats = (await client.query<{ seat: number; character_id: string }>("SELECT seat, character_id FROM seats WHERE table_id = $1 ORDER BY seat", [tableId])).rows;
    if (seats.length < seatCount) {
      await client.query("ROLLBACK");
      return { ok: false, announcement: "", error: "table_not_full" };
    }
    const mine = seats.find((s) => s.character_id === characterId);
    if (mine === undefined) {
      await client.query("ROLLBACK");
      return { ok: false, announcement: "", error: "not_seated" };
    }
    for (const s of seats) {
      const available = await availableCoins(client, s.character_id);
      if (available < table.stake) {
        await client.query("ROLLBACK");
        return { ok: false, announcement: "", error: "insufficient_coins" };
      }
    }
    const gameId = newId();
    let position: unknown;
    let hands: Record<string, string[]> | null = null;
    let toMove: number | null = null;
    let seed: string | null = null;
    if (table.game === "chess") {
      position = { fen: chess.StartFen };
      toMove = 1;
    } else if (table.game === "four") {
      position = { rows: four.EmptyBoard.slice() };
      toMove = 1;
    } else {
      seed = newId();
      hands = Object.fromEntries(cards.dealHands(seed).map((h, i) => [String(i + 1), h]));
      position = cards.startPosition(1);
      toMove = 1;
    }
    await client.query(
      `INSERT INTO games (id, server_id, table_id, game, seed, state, turn, to_move_seat, position, hands, turn_deadline, started_at)
       VALUES ($1,$2,$3,$4,$5,'in_play',0,$6,$7,$8,$9,now())`,
      [gameId, table.server_id, tableId, table.game, seed, toMove, JSON.stringify(position), hands === null ? null : JSON.stringify(hands), new Date(Date.now() + table.turn_seconds * 1000)]
    );
    for (const s of seats) {
      await writeLedgerEntry(client, {
        serverId: table.server_id,
        kind: "stake",
        gameId,
        lines: [
          { account: s.character_id, amount: -table.stake },
          { account: `escrow:${gameId}`, amount: table.stake },
        ],
      });
    }
    await client.query("UPDATE tables_ SET state = 'in_play', etag = $2 WHERE id = $1", [tableId, newId()]);
    await client.query("COMMIT");
    await publishTable(tableId);
    await publishAnnouncement(tableId, `${(SeatLabels[table.game] ?? ["Seat"])[mine.seat - 1] ?? "Seat"} starts the game`);
    return { ok: true, announcement: "" };
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

export type MoveError = "not_seated" | "game_not_in_play" | "stale_turn" | "turn_expired" | "illegal_move";

export interface MoveInput {
  tableId: string;
  characterId: string;
  turn: number;
  move: string;
}

export interface MoveOutcome {
  ok: boolean;
  announcement: string;
  error?: MoveError;
  detail?: string;
}

/** Applies one move under the table's row lock, so a racing move is either in or stale. */
export async function playMove(pool: Pool, input: MoveInput): Promise<MoveOutcome> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const table = (await client.query<TableLockRow>("SELECT * FROM tables_ WHERE id = $1 FOR UPDATE", [input.tableId])).rows[0];
    if (table === undefined) {
      await client.query("ROLLBACK");
      return { ok: false, announcement: "", error: "game_not_in_play" };
    }
    const game = (await client.query<GameRowLock>("SELECT * FROM games WHERE table_id = $1 AND state = 'in_play' ORDER BY started_at DESC LIMIT 1 FOR UPDATE", [input.tableId])).rows[0];
    if (table.state !== "in_play" || game === undefined) {
      await client.query("ROLLBACK");
      return { ok: false, announcement: "", error: "game_not_in_play" };
    }
    const seats = (await client.query<{ seat: number; character_id: string }>("SELECT seat, character_id FROM seats WHERE table_id = $1", [input.tableId])).rows;
    const mine = seats.find((s) => s.character_id === input.characterId);
    if (mine === undefined) {
      await client.query("ROLLBACK");
      return { ok: false, announcement: "", error: "not_seated" };
    }
    if (game.turn_deadline !== null && Date.now() >= game.turn_deadline.getTime()) {
      await client.query("COMMIT");
      await expireTurn(pool, input.tableId, game.id);
      return { ok: false, announcement: "", error: "turn_expired" };
    }
    if (game.to_move_seat !== mine.seat) {
      await client.query("ROLLBACK");
      return { ok: false, announcement: "", error: "illegal_move", detail: "not_your_turn" };
    }
    if (game.turn !== input.turn) {
      await client.query("ROLLBACK");
      return { ok: false, announcement: "", error: "stale_turn" };
    }
    const result = await applyGameMove(client, table, game, mine.seat, input.move);
    if (!result.ok) {
      await client.query("ROLLBACK");
      return { ok: false, announcement: "", error: "illegal_move", detail: result.detail };
    }
    await client.query("COMMIT");
    if (result.announcement !== undefined) {
      await publishAnnouncement(input.tableId, result.announcement);
    }
    await publishTable(input.tableId);
    if (result.end !== undefined && result.end !== null) {
      await finishGame(pool, input.tableId, game.id, result.end.reason, result.end.winners);
    }
    return { ok: true, announcement: result.announcement ?? "" };
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

interface GameRowLock {
  id: string;
  server_id: string;
  state: "in_play" | "finished";
  game: "chess" | "four" | "tricks";
  seed: string | null;
  turn: number;
  to_move_seat: number | null;
  position: unknown;
  hands: Record<string, string[]> | null;
  turn_deadline: Date | null;
}

interface MoveApplyResult {
  ok: boolean;
  detail?: string;
  announcement?: string;
  end?: { reason: string; winners: number[] } | null;
}

/** The per-game move application: legality by the game engines, one place each. */
async function applyGameMove(client: Client, table: TableLockRow, game: GameRowLock, seat: number, move: string): Promise<MoveApplyResult> {
  if (table.game === "chess") {
    const position = game.position as { fen: string };
    const legality = chess.checkMove(position.fen, seat as 1 | 2, move);
    if (!legality.ok) return { ok: false, detail: legality.error };
    const moveRows = await client.query<{ move: string; seat: number }>(
      "SELECT move, seat FROM game_moves WHERE game_id = $1 ORDER BY seq",
      [game.id]
    );
    const fens = chessFenHistory(moveRows.rows.map((m) => m.move));
    const outcome = chess.playMove(position.fen, move, seat as 1 | 2, fens);
    const nextFen = outcome.fen;
    await client.query(
      `INSERT INTO game_moves (game_id, seq, seat, move, announcement) VALUES ($1,$2,$3,$4,$5)`,
      [game.id, game.turn + 1, seat, move, outcome.announcement]
    );
    await client.query(
      "UPDATE games SET position = $2, turn = $3, to_move_seat = $4, turn_deadline = $5 WHERE id = $1",
      [game.id, JSON.stringify({ fen: nextFen }), game.turn + 1, seat === 1 ? 2 : 1, new Date(Date.now() + table.turn_seconds * 1000)]
    );
    const end = outcome.end === null ? null : { reason: outcome.end.reason, winners: outcome.end.winners };
    return { ok: true, announcement: outcome.announcement, end };
  }
  if (table.game === "four") {
    const position = game.position as { rows: string[] };
    const seatOfMover = seat;
    const onTurn = game.to_move_seat === seatOfMover;
    if (!onTurn) return { ok: false, detail: "not_your_turn" };
    const col = Number(move);
    if (!Number.isInteger(col) || col < 1 || col > 7) return { ok: false, detail: "cannot_move" };
    const row = four.dropRow(position.rows, col - 1);
    if (row === null) return { ok: false, detail: "column_full" };
    const outcome = four.applyDrop(position.rows, col, seat as 1 | 2);
    if (outcome === null) return { ok: false, detail: "column_full" };
    const announcement = Copy.four.drop((SeatLabels.four ?? ["Ink", "Gold"])[seat - 1] ?? "Ink", col);
    await client.query(
      `INSERT INTO game_moves (game_id, seq, seat, move, announcement) VALUES ($1,$2,$3,$4,$5)`,
      [game.id, game.turn + 1, seat, move, announcement]
    );
    await client.query(
      "UPDATE games SET position = $2, turn = $3, to_move_seat = $4, turn_deadline = $5 WHERE id = $1",
      [game.id, JSON.stringify({ rows: outcome.rows }), game.turn + 1, seat === 1 ? 2 : 1, new Date(Date.now() + table.turn_seconds * 1000)]
    );
    const end = outcome.win
      ? { reason: "four_in_a_row", winners: [seat] }
      : outcome.draw
        ? { reason: "board_full", winners: [] }
        : null;
    return { ok: true, announcement, end };
  }
  // The card game.
  const position = game.position as { trick: { seat: number; card: string }[]; led_suit: string | null; tricks_won: number[]; first_seat?: number };
  const hand = game.hands?.[String(seat)] ?? [];
  const onTurn = game.to_move_seat === seat;
  if (!onTurn) return { ok: false, detail: "not_your_turn" };
  const check = cards.checkPlay(hand, position, seat, seat, move);
  if (!check.ok) return { ok: false, detail: check.error ?? "cannot_move" };
  const nextHand = hand.filter((c) => c !== move);
  const applied = cards.applyPlay(position, seat, move);
  const seatName = await seatCharacterName(client, table.id, seat);
  let announcement = Copy.cards.played(seatName, cards.cardName(move));
  let leader = position.first_seat ?? 1;
  if (applied.trickWinner !== null) {
    leader = applied.trickWinner;
    const winnerName = await seatCharacterName(client, table.id, applied.trickWinner);
    announcement = Copy.cards.trickWon(winnerName);
  }
  const hands = { ...(game.hands ?? {}) };
  hands[String(seat)] = nextHand;
  const nextSeat = applied.trickWinner === null ? (seat % 4) + 1 : applied.trickWinner;
  await client.query(
    `INSERT INTO game_moves (game_id, seq, seat, move, announcement) VALUES ($1,$2,$3,$4,$5)`,
    [game.id, game.turn + 1, seat, move, announcement]
  );
  await client.query(
    "UPDATE games SET position = $2, hands = $3, turn = $4, to_move_seat = $5, turn_deadline = $6 WHERE id = $1",
    [
      game.id,
      JSON.stringify({ ...applied.position, first_seat: leader }),
      JSON.stringify(hands),
      game.turn + 1,
      nextSeat,
      new Date(Date.now() + table.turn_seconds * 1000),
    ]
  );
  const end = applied.handOver
    ? { reason: "hand_over", winners: topSeats(applied.position.tricks_won) }
    : null;
  return { ok: true, announcement, end };
}

async function seatCharacterName(client: Client, tableId: string, seat: number): Promise<string> {
  const res = await client.query<{ name: string }>(
    "SELECT c.name FROM seats s JOIN characters c ON c.id = s.character_id WHERE s.table_id = $1 AND s.seat = $2",
    [tableId, seat]
  );
  return res.rows[0]?.name ?? "?";
}

/** The seats with the top trick count. */
export function topSeats(tricksWon: number[]): number[] {
  const max = Math.max(...tricksWon);
  return tricksWon.map((n, i) => (n === max ? i + 1 : 0)).filter((n) => n > 0);
}

/** Ends a game: forfeits by the player on turn when their deadline passes. */
export async function expireTurn(pool: Pool, tableId: string, gameId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const game = (await client.query<GameRowLock>("SELECT * FROM games WHERE id = $1 FOR UPDATE", [gameId])).rows[0];
    if (game === undefined || game.state !== "in_play") {
      await client.query("ROLLBACK");
      return;
    }
    const tableKind = (await client.query<{ game: "chess" | "four" | "tricks" }>("SELECT game FROM tables_ WHERE id = $1", [tableId])).rows[0];
    if (tableKind === undefined) {
      await client.query("ROLLBACK");
      return;
    }
    const onTurn = game.to_move_seat ?? 1;
    const losers = [onTurn];
    const winners = allSeats(tableKind.game).filter((s) => !losers.includes(s));
    await client.query(
      "UPDATE games SET state = 'finished', finished_at = COALESCE(turn_deadline, now()) WHERE id = $1",
      [gameId]
    );
    await client.query("UPDATE tables_ SET state = 'finished' WHERE id = $1", [tableId]);
    await client.query("COMMIT");
    await publishTable(tableId);
    await finishGame(pool, tableId, gameId, "timeout", winners, onTurn);
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

export function allSeats(game: "chess" | "four" | "tricks"): number[] {
  return game === "tricks" ? [1, 2, 3, 4] : [1, 2];
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

export async function forfeitGame(pool: Pool, tableId: string, characterId: string): Promise<{ ok: boolean; announcement: string; error?: "not_seated" | "game_not_in_play" }> {
  const client = await pool.connect();
  let gameId = "";
  let gameKind: "chess" | "four" | "tricks" = "chess";
  let forfeiter = 0;
  try {
    await client.query("BEGIN");
    const table = (await client.query<TableLockRow>("SELECT * FROM tables_ WHERE id = $1 FOR UPDATE", [tableId])).rows[0];
    const game = (await client.query<GameRowLock>("SELECT * FROM games WHERE table_id = $1 AND state = 'in_play' ORDER BY started_at DESC LIMIT 1 FOR UPDATE", [tableId])).rows[0];
    if (table === undefined || game === undefined || table.state !== "in_play") {
      await client.query("ROLLBACK");
      return { ok: false, announcement: "", error: "game_not_in_play" };
    }
    const seats = (await client.query<{ seat: number; character_id: string }>("SELECT seat, character_id FROM seats WHERE table_id = $1", [tableId])).rows;
    const mine = seats.find((s) => s.character_id === characterId);
    if (mine === undefined) {
      await client.query("ROLLBACK");
      return { ok: false, announcement: "", error: "not_seated" };
    }
    gameId = game.id;
    gameKind = table.game;
    forfeiter = mine.seat;
    await client.query("UPDATE games SET state = 'finished', finished_at = now() WHERE id = $1", [gameId]);
    await client.query("UPDATE tables_ SET state = 'finished' WHERE id = $1", [tableId]);
    await client.query("COMMIT");
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
  const winners = allSeats(gameKind).filter((s) => s !== forfeiter);
  await publishTable(tableId);
  await finishGame(pool, tableId, gameId, "forfeit", winners, forfeiter);
  return { ok: true, announcement: "" };
}

export async function offerRematch(pool: Pool, tableId: string, characterId: string): Promise<{ ok: boolean; announcement: string; error?: "not_seated" | "not_settled" | "insufficient_coins" }> {
  const client = await pool.connect();
  let allOffered = false;
  let seats: { seat: number; character_id: string }[] = [];
  let table: TableLockRow | undefined;
  try {
    await client.query("BEGIN");
    table = (await client.query<TableLockRow>("SELECT * FROM tables_ WHERE id = $1 FOR UPDATE", [tableId])).rows[0];
    if (table === undefined || table.state !== "settled") {
      await client.query("ROLLBACK");
      return { ok: false, announcement: "", error: "not_settled" };
    }
    seats = (await client.query<{ seat: number; character_id: string }>("SELECT seat, character_id FROM seats WHERE table_id = $1", [tableId])).rows;
    const mine = seats.find((s) => s.character_id === characterId);
    if (mine === undefined) {
      await client.query("ROLLBACK");
      return { ok: false, announcement: "", error: "not_seated" };
    }
    for (const s of seats) {
      const available = await availableCoins(client, s.character_id);
      if (available < table.stake) {
        await client.query("ROLLBACK");
        return { ok: false, announcement: "", error: "insufficient_coins" };
      }
    }
    const latest = (await client.query<{ id: string; rematch_offers: string[] }>("SELECT id, rematch_offers FROM games WHERE table_id = $1 ORDER BY started_at DESC LIMIT 1", [tableId])).rows[0];
    if (latest === undefined) {
      await client.query("ROLLBACK");
      return { ok: false, announcement: "", error: "not_settled" };
    }
    const offers = new Set(latest.rematch_offers);
    offers.add(String(mine.seat));
    await client.query("UPDATE games SET rematch_offers = $2 WHERE id = $1", [latest.id, [...offers]]);
    const seatCount = table.game === "tricks" ? 4 : 2;
    allOffered = seats.length === seatCount && offers.size >= seatCount;
    if (allOffered) {
      // The rematch: chess and four swap seats; the card game passes the first lead.
      const lastGame = (await client.query<{ position: unknown }>("SELECT position FROM games WHERE id = $1", [latest.id])).rows[0];
      const lastPos = (lastGame?.position ?? {}) as { first_seat?: number };
      const nextFirst = table.game === "tricks" ? ((lastPos.first_seat ?? 1) % 4) + 1 : 1;
      if (table.game !== "tricks") {
        await client.query("UPDATE seats SET seat = 3 - seat WHERE table_id = $1", [tableId]);
        seats = seats.map((s) => ({ ...s, seat: 3 - s.seat }));
      }
      await startRematchGame(client, table, seats, nextFirst);
    }
    await client.query("COMMIT");
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
  await publishTable(tableId);
  if (allOffered) {
    await publishAnnouncement(tableId, Copy.rematch.started);
  }
  return { ok: true, announcement: "" };
}

async function startRematchGame(client: Client, table: TableLockRow, seats: { seat: number; character_id: string }[], firstSeat: number): Promise<void> {
  const gameId = newId();
  let position: unknown;
  let hands: Record<string, string[]> | null = null;
  let seed: string | null = null;
  let toMove: number | null = null;
  if (table.game === "chess") {
    position = { fen: chess.StartFen };
    toMove = 1;
  } else if (table.game === "four") {
    position = { rows: four.EmptyBoard.slice() };
    toMove = 1;
  } else {
    seed = newId();
    hands = Object.fromEntries(cards.dealHands(seed).map((h, i) => [String(i + 1), h]));
    position = cards.startPosition(firstSeat);
    toMove = firstSeat;
  }
  await client.query(
    `INSERT INTO games (id, server_id, table_id, game, seed, state, turn, to_move_seat, position, hands, turn_deadline, started_at)
     VALUES ($1,$2,$3,$4,$5,'in_play',0,$6,$7,$8,$9,now())`,
    [gameId, table.server_id, table.id, table.game, seed, toMove, JSON.stringify(position), hands === null ? null : JSON.stringify(hands), new Date(Date.now() + table.turn_seconds * 1000)]
  );
  for (const s of seats) {
    await writeLedgerEntry(client, {
      serverId: table.server_id,
      kind: "stake",
      gameId,
      lines: [
        { account: s.character_id, amount: -table.stake },
        { account: `escrow:${gameId}`, amount: table.stake },
      ],
    });
  }
  await client.query("UPDATE tables_ SET state = 'in_play' WHERE id = $1", [table.id]);
}

/** Finishes a game: writes the result bundle to storage, settles coins, queues mail. */
export async function finishGame(pool: Pool, tableId: string, gameId: string, reason: string, winners: number[], forfeiterSeat?: number): Promise<void> {
  const { storeAndSettle } = await import("./settle.js");
  await storeAndSettle(pool, tableId, gameId, reason, winners, forfeiterSeat);
}

/** Publishes the table event to every subscriber of the table's server. */
export async function publishTable(tableId: string): Promise<void> {
  const { buildTablePayload } = await import("./settle.js");
  const payload = await buildTablePayload(tableId);
  if (payload === null) return;
  await publish(getPool(), payload.serverId, [{ kind: "table", payload: payload.payload, audience: { table: tableId } }]);
}

/** Publishes an announcement to every viewer of the table. */
export async function publishAnnouncement(tableId: string, text: string): Promise<void> {
  const { buildTablePayload } = await import("./settle.js");
  const payload = await buildTablePayload(tableId);
  if (payload === null) return;
  await publish(getPool(), payload.serverId, [{ kind: "announcement", payload: { text }, audience: { table: tableId } }]);
}

import { runtimePool } from "../runtime.js";

function getPool(): Pool {
  return runtimePool();
}

/** The background turn clock: checks every deadline at least once a second. */
export async function scanDeadlines(pool: Pool): Promise<void> {
  const res = await pool.query<{ id: string; table_id: string }>(
    "SELECT id, table_id FROM games WHERE state = 'in_play' AND turn_deadline <= now()"
  );
  for (const row of res.rows) {
    await expireTurn(pool, row.table_id, row.id);
  }
}

export { isoInstant };

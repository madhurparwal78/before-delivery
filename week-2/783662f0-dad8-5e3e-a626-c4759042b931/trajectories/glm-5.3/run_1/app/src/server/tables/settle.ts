/** Storing results and settling stakes: one result bundle per game, one settlement entry,
 * payouts decided in exactly one place, leaderboards and achievements after each settlement. */

import type { Pool } from "../db/pool.js";
import { newId } from "../db/seed.js";
import { GameEndCopy } from "../../shared/copy.js";
import { writeLedgerEntry } from "../coins/ledger.js";
import { config } from "../config.js";
import { publish, publishTx } from "../api/events.js";
import type { Queryer } from "../db/pool.js";
import { writePair, StorageUnavailableError } from "../storage/objects.js";
import { isoInstant } from "../time.js";

export type TableInfo = {
  id: string;
  server_id: string;
  game: "chess" | "four" | "tricks";
  stake: number;
}

export type SeatInfo = {
  seat: number;
  character_id: string;
}

export type ResultPayload = {
  outcome: "win" | "draw" | "forfeit" | "abandoned";
  reason: string;
  winners: number[];
  text: string;
  settlement: { character_id: string; amount: number }[];
}

/** The payout split, decided only here. Each seat's payout for the game. */
export function payoutSplit(game: "chess" | "four" | "tricks", stake: number, winners: number[], reason: string): Map<number, number> {
  const seats: number[] = game === "tricks" ? [1, 2, 3, 4] : [1, 2];
  const payouts = new Map<number, number>();
  for (const s of seats) payouts.set(s, stake);
  if (reason === "abandoned" || winners.length === 0) {
    return payouts;
  }
  const total = seats.length * stake;
  if (game === "tricks") {
    const winnerSeats = [...winners].sort((a, b) => a - b);
    const share = Math.floor(total / winnerSeats.length);
    let remainder = total - share * winnerSeats.length;
    for (const s of seats) {
      if (!winnerSeats.includes(s)) payouts.set(s, 0);
    }
    for (const s of winnerSeats) {
      let amount = share;
      if (remainder > 0) {
        amount += 1;
        remainder -= 1;
      }
      payouts.set(s, amount);
    }
    return payouts;
  }
  const loser = seats.find((s) => s !== winners[0]);
  if (loser !== undefined) payouts.set(loser, 0);
  payouts.set(winners[0]!, total);
  return payouts;
}

function endReasonText(reason: string): string {
  const map: Record<string, string> = {
    checkmate: "Checkmate.",
    stalemate: "Stalemate.",
    threefold_repetition: "Threefold repetition.",
    fifty_move_rule: "Fifty-move rule.",
    four_in_a_row: "Four in a row.",
    board_full: "Board full.",
    hand_over: "Hand over.",
    server_suspended: "Abandoned: the server was suspended.",
  };
  return map[reason] ?? "Game over.";
}

export function endText(reason: string, seatNames: Map<number, string>, winners: number[]): string {
  let reasonText: string;
  if (reason === "timeout" || reason === "forfeit") {
    const loserSeat = [...seatNames.keys()].find((seat) => !winners.includes(seat));
    const name = loserSeat === undefined ? "a player" : seatNames.get(loserSeat)!;
    reasonText = reason === "timeout" ? `${name} ran out of time.` : `${name} forfeited.`;
  } else {
    reasonText = endReasonText(reason);
  }
  let resultText: string;
  if (reason === "abandoned") {
    resultText = GameEndCopy.results.stakesReturned;
  } else if (winners.length === 0) {
    resultText = GameEndCopy.results.draw;
  } else {
    const names = [...winners].sort((a, b) => a - b).map((s) => seatNames.get(s) ?? "?");
    resultText =
      names.length === 1
        ? GameEndCopy.results.win(names[0]!)
        : names.length === 2
          ? GameEndCopy.results.win2(names[0]!, names[1]!)
          : GameEndCopy.results.win3(names[0]!, names[1]!, names[2]!);
  }
  return `${reasonText} ${resultText}`;
}

/** The Result payload of a finished game. */
export async function buildResult(client: Queryer, table: TableInfo, reason: string, winners: number[], seats: SeatInfo[]): Promise<ResultPayload> {
  const names = await client.query<{ id: string; name: string }>("SELECT id, name FROM characters WHERE id = ANY($1)", [
    seats.map((s) => s.character_id),
  ]);
  const nameOf = new Map(names.rows.map((n) => [n.id, n.name]));
  const seatNames = new Map<number, string>(seats.map((s) => [s.seat, nameOf.get(s.character_id) ?? "?"] as [number, string]));
  const payouts = payoutSplit(table.game, table.stake, winners, reason);
  const settlement = seats.map((s) => ({ character_id: s.character_id, amount: (payouts.get(s.seat) ?? table.stake) - table.stake }));
  const outcome: ResultPayload["outcome"] =
    reason === "abandoned" ? "abandoned" : reason === "forfeit" || reason === "timeout" ? "forfeit" : winners.length === 0 ? "draw" : "win";
  return { outcome, reason, winners, text: endText(reason, seatNames, winners), settlement };
}

/** Stores the result bundle, then settles. On a storage failure the table stays finished
 * with pending_store, and any instance retries at least every 10 seconds. */
export async function storeAndSettle(pool: Pool, tableId: string, gameId: string, reason: string, winners: number[], forfeiterSeat?: number): Promise<void> {
  void forfeiterSeat;
  const client = await pool.connect();
  let table: TableInfo | undefined;
  let seats: SeatInfo[] = [];
  let finishedAt = new Date();
  let fresh = false;
  try {
    await client.query("BEGIN");
    table = (await client.query<TableInfo & { name: string }>("SELECT id, server_id, name, game, stake FROM tables_ WHERE id = $1 FOR UPDATE", [tableId])).rows[0];
    const game = (await client.query<{ state: string; finished_at: Date | null }>("SELECT state, finished_at FROM games WHERE id = $1 FOR UPDATE", [gameId])).rows[0];
    if (table === undefined || game === undefined) {
      await client.query("ROLLBACK");
      return;
    }
    finishedAt = game.finished_at ?? new Date();
    if (game.state !== "finished") {
      await client.query("UPDATE games SET state = 'finished', finished_at = $2 WHERE id = $1", [gameId, finishedAt]);
      await client.query("UPDATE tables_ SET state = 'finished' WHERE id = $1", [tableId]);
      fresh = true;
    }
    seats = (await client.query<SeatInfo>("SELECT seat, character_id FROM seats WHERE table_id = $1 ORDER BY seat", [tableId])).rows;
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
  if (table === undefined) return;
  const result = await buildResult(pool, table, reason, winners, seats);
  if (fresh) {
    const { publishAnnouncement } = await import("./engine.js");
    await publishAnnouncement(tableId, result.text);
  }
  await attemptSettle(pool, table, gameId, result, finishedAt);
}

async function resultBundleData(table: TableInfo, gameId: string, result: ResultPayload, finishedAt: Date): Promise<string> {
  return JSON.stringify({ game_id: gameId, table_id: table.id, game: table.game, result, finished_at: isoInstant(finishedAt) });
}

/** Writes the bundle then settles; safe to run from many instances. */
export async function attemptSettle(pool: Pool, table: TableInfo, gameId: string, result: ResultPayload, finishedAt: Date): Promise<void> {
  await pool.query(
    `INSERT INTO game_results (game_id, result, stored) VALUES ($1,$2,false)
     ON CONFLICT (game_id) DO UPDATE SET result = EXCLUDED.result`,
    [gameId, JSON.stringify(result)]
  );
  const dataKey = `servers/${table.server_id}/games/${gameId}/result.json`;
  const manifestKey = `servers/${table.server_id}/games/${gameId}/manifest.json`;
  try {
    await writePair({ kind: "game_result", serverId: table.server_id, dataKey, manifestKey, data: await resultBundleData(table, gameId, result, finishedAt) });
  } catch (err) {
    if (!(err instanceof StorageUnavailableError)) throw err;
    return;
  }
  await settleNow(pool, table, gameId, result);
}

/** Settles exactly once, guarded by the settlement lock. */
export async function settleNow(pool: Pool, table: TableInfo, gameId: string, result: ResultPayload): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`settle:${gameId}`]);
    const row = (await client.query<{ stored: boolean }>("SELECT stored FROM game_results WHERE game_id = $1 FOR UPDATE", [gameId])).rows[0];
    if (row === undefined || row.stored) {
      await client.query("ROLLBACK");
      return;
    }
    const seats = (await client.query<SeatInfo>("SELECT seat, character_id FROM seats WHERE table_id = $1 ORDER BY seat", [table.id])).rows;
    const total = table.stake * seats.length;
    const lines: { account: string; amount: number }[] = [{ account: `escrow:${gameId}`, amount: -total }];
    for (const s of seats) {
      const net = result.settlement.find((l) => l.character_id === s.character_id)?.amount ?? 0;
      lines.push({ account: s.character_id, amount: net + table.stake });
    }
    await writeLedgerEntry(client, { serverId: table.server_id, kind: "settlement", gameId, lines });
    await client.query("UPDATE game_results SET stored = true, stored_at = now() WHERE game_id = $1", [gameId]);
    await client.query("UPDATE tables_ SET state = 'settled' WHERE id = $1", [table.id]);
    const season = (await client.query<{ season: number }>("SELECT season FROM servers WHERE id = $1", [table.server_id])).rows[0];
    if (season !== undefined) {
      for (const winnerSeat of result.winners) {
        const seat = seats.find((s) => s.seat === winnerSeat);
        if (seat === undefined) continue;
        await client.query("INSERT INTO wins (server_id, season, game, character_id, won_at) VALUES ($1,$2,$3,$4,now())", [
          table.server_id,
          season.season,
          table.game,
          seat.character_id,
        ]);
      }
    }
    await awardGameAchievements(client, table, gameId, result, seats);
    await queueResultMails(client, table, gameId, result, seats);
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
  await publishLeaderboard(table.server_id, table.game);
  const { publishTable } = await import("./engine.js");
  await publishTable(table.id);
}

async function queueResultMails(client: Queryer, table: TableInfo, gameId: string, result: ResultPayload, seats: SeatInfo[]): Promise<void> {
  const server = (await client.query<{ slug: string; name: string }>("SELECT slug, name FROM servers WHERE id = $1", [table.server_id])).rows[0];
  const tableName = (await client.query<{ name: string }>("SELECT name FROM tables_ WHERE id = $1", [table.id])).rows[0];
  if (server === undefined || tableName === undefined) return;
  for (const s of seats) {
    const character = (await client.query<{ name: string; user_id: string }>("SELECT name, user_id FROM characters WHERE id = $1", [s.character_id])).rows[0];
    if (character === undefined) continue;
    const user = (await client.query<{ email: string; handle: string }>("SELECT email, handle FROM users WHERE id = $1", [character.user_id])).rows[0];
    if (user === undefined) continue;
    const amount = result.settlement.find((l) => l.character_id === s.character_id)?.amount ?? 0;
    const signed = amount > 0 ? `+${amount}` : amount < 0 ? `${amount}` : "0";
    await client.query(
      `INSERT INTO mail_outbox (id, server_id, kind, to_handle, to_email, subject, body, state, dedupe_key)
       VALUES ($1,$2,'game_result',$3,$4,$5,$6,'held',$7)`,
      [
        newId(),
        table.server_id,
        user.handle,
        user.email,
        `Result: ${tableName.name}`,
        [result.text, `Your coins: ${signed}`, `Replay: ${config().publicBase}/s/${server.slug}/games/${gameId}`].join("\n"),
        `game_result:${gameId}:${s.character_id}`,
      ]
    );
  }
}

/** Retries unfinished result stores at least every 10 seconds. */
export async function retryPendingResults(pool: Pool): Promise<void> {
  const rows = await pool.query<{ game_id: string; result: ResultPayload }>(
    "SELECT game_id, result FROM game_results WHERE stored = false LIMIT 5"
  );
  for (const row of rows.rows) {
    const table = (
      await pool.query<TableInfo>("SELECT t.id, t.server_id, t.game, t.stake FROM tables_ t JOIN games g ON g.table_id = t.id WHERE g.id = $1", [row.game_id])
    ).rows[0];
    if (table === undefined) continue;
    const finished = (await pool.query<{ finished_at: Date }>("SELECT finished_at FROM games WHERE id = $1", [row.game_id])).rows[0];
    try {
      await writePair({
        kind: "game_result",
        serverId: table.server_id,
        dataKey: `servers/${table.server_id}/games/${row.game_id}/result.json`,
        manifestKey: `servers/${table.server_id}/games/${row.game_id}/manifest.json`,
        data: await resultBundleData(table, row.game_id, row.result, finished?.finished_at ?? new Date()),
      });
    } catch (err) {
      if (!(err instanceof StorageUnavailableError)) throw err;
      continue;
    }
    await settleNow(pool, table, row.game_id, row.result);
  }
}

export async function publishLeaderboard(serverId: string, game: "chess" | "four" | "tricks"): Promise<void> {
  const { runtimePool } = await import("../runtime.js");
  const { leaderboardEntries } = await import("./leaderboards.js");
  const { season, entries } = await leaderboardEntries(runtimePool(), serverId, game);
  await publish(runtimePool(), serverId, [{ kind: "leaderboard", payload: { game, season, entries } }]);
}

/** The achievements that follow a settled game. */
async function awardGameAchievements(client: Queryer, table: TableInfo, gameId: string, result: ResultPayload, seats: SeatInfo[]): Promise<void> {
  const unlock = async (seat: number, name: string): Promise<void> => {
    const s = seats.find((x) => x.seat === seat);
    if (s !== undefined) await unlockAchievement(client, table.server_id, s.character_id, name);
  };
  if (result.reason === "checkmate") {
    for (const seat of result.winners) await unlock(seat, "Checkmate Artist");
  }
  if (result.reason === "four_in_a_row") {
    for (const seat of result.winners) await unlock(seat, "Four Down");
  }
  if (result.reason === "hand_over") {
    const position = (await client.query<{ position: unknown }>("SELECT position FROM games WHERE id = $1", [gameId])).rows[0];
    const tricksWon = ((position?.position ?? {}) as { tricks_won?: number[] }).tricks_won ?? [];
    for (const seat of result.winners) {
      if ((tricksWon[seat - 1] ?? 0) >= 7) await unlock(seat, "Trick Taker");
    }
  }
}

/** Unlocks an achievement once per character and pushes the event to its user. */
export async function unlockAchievement(client: Queryer, serverId: string, characterId: string, name: string): Promise<void> {
  const insert = await client.query<{ character_id: string }>(
    `INSERT INTO achievements (character_id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING character_id`,
    [characterId, name]
  );
  if (insert.rows.length === 0) return;
  const user = (await client.query<{ handle: string }>("SELECT u.handle FROM users u JOIN characters c ON c.user_id = u.id WHERE c.id = $1", [characterId])).rows[0];
  if (user === undefined) return;
  await publishTx(client, serverId, [
    {
      kind: "achievement",
      payload: { character_id: characterId, name, unlocked_at: isoInstant(new Date()) },
      audience: { users: [user.handle] },
    },
  ]);
}

/** Builds the table payload for table events. */
export async function buildTablePayload(tableId: string): Promise<{ serverId: string; payload: unknown } | null> {
  const { runtimePool } = await import("../runtime.js");
  const pool = runtimePool();
  const table = (await pool.query<{ id: string; server_id: string }>("SELECT id, server_id FROM tables_ WHERE id = $1", [tableId])).rows[0];
  if (table === undefined) return null;
  const { tableView, loadTable } = await import("./serialize.js");
  const row = await loadTable(pool, tableId);
  if (row === null) return null;
  const view = await tableView(pool, row, null);
  return { serverId: table.server_id, payload: view };
}

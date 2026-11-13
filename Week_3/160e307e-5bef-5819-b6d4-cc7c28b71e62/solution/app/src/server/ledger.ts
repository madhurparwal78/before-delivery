import { randomUUID } from "node:crypto";
import { query } from "./db";
import type { Db } from "./db";
import { ApiError } from "./errors";
import { SHOP_ITEMS, ownsByDefault } from "./catalog";
import type { ItemKind } from "./catalog";
import { chalkBalance } from "./players";
import type { Runner } from "./players";
import { fingerprint } from "./util";

/** Chalk is a paired ledger: every movement is a player entry and the opposite house entry. */

type LedgerReason = "match" | "win" | "daily" | "local" | "purchase" | "grant";

export const MATCH_CHALK = 20;
export const WIN_CHALK = 30;
export const DAILY_WIN_CHALK = 50;
export const LOCAL_CHALK = 10;
export const LOCAL_DAILY_LIMIT = 5;

export async function recordMovement(
  db: Db,
  playerId: string,
  delta: number,
  reason: LedgerReason,
  extra: { itemId?: string; matchId?: string } = {},
): Promise<void> {
  const movement = randomUUID();
  const insert = "INSERT INTO ledger (movement_id, account, player_id, delta, reason, item_id, match_id) VALUES ($1, $2, $3, $4, $5, $6, $7)";
  await db.query(insert, [movement, "player", playerId, delta, reason, extra.itemId ?? null, extra.matchId ?? null]);
  await db.query(insert, [movement, "house", playerId, -delta, reason, extra.itemId ?? null, extra.matchId ?? null]);
}

export async function movementsToday(db: Db, playerId: string, reason: LedgerReason): Promise<number> {
  const found = await db.query(
    "SELECT COUNT(*)::int AS n FROM ledger WHERE player_id = $1 AND account = 'player' AND reason = $2 AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",
    [playerId, reason],
  );
  return (found.rows[0]?.n as number | undefined) ?? 0;
}

export async function ledgerJson(playerId: string): Promise<Record<string, unknown>> {
  const found = await query(
    "SELECT movement_id, account, delta, reason, item_id, created_at FROM ledger WHERE player_id = $1 ORDER BY id",
    [playerId],
  );
  const entries = found.map((row) => ({
    movementId: row.movement_id,
    account: row.account,
    delta: row.delta,
    reason: row.reason,
    itemId: row.item_id,
    createdAt: (row.created_at as Date).toISOString(),
  }));
  const sum = entries.filter((e) => e.account === "player").reduce((total, e) => total + (e.delta as number), 0);
  return { entries, sum };
}

async function ownedIds(playerId: string, run: Runner = query): Promise<string[]> {
  const found = await run("SELECT item_id FROM owned_items WHERE player_id = $1", [playerId]);
  return [...SHOP_ITEMS.filter((i) => ownsByDefault(i.id)).map((i) => i.id), ...found.map((r) => r.item_id as string)];
}

export async function shopJson(playerId: string, equipped: Record<ItemKind, string>): Promise<Record<string, unknown>> {
  const owned = new Set(await ownedIds(playerId));
  return {
    chalk: await chalkBalance(playerId),
    items: SHOP_ITEMS.map((item) => ({
      id: item.id,
      kind: item.kind,
      name: item.name,
      price: item.price,
      owned: owned.has(item.id),
      equipped: equipped[item.kind] === item.id,
    })),
  };
}

/** One purchase: charged once, owned only when its debit exists, serialised per player. */
export async function purchase(
  db: Db,
  playerId: string,
  itemId: string,
  key: string,
): Promise<{ chalk: number; owned: string[] }> {
  const item = SHOP_ITEMS.find((i) => i.id === itemId);
  if (!item) throw new ApiError(404, "ITEM_NOT_FOUND");
  const run: Runner = async (sql, params) => (await db.query(sql, params)).rows;
  await db.query("SELECT id FROM players WHERE id = $1 FOR UPDATE", [playerId]);
  const seen = await run("SELECT fingerprint, response FROM idempotent_requests WHERE player_id = $1 AND scope = 'purchase' AND key = $2", [
    playerId,
    key,
  ]);
  const print = fingerprint(itemId);
  if (seen[0]) {
    if (seen[0].fingerprint !== print) throw new ApiError(409, "IDEMPOTENCY_CONFLICT");
    return seen[0].response as { chalk: number; owned: string[] };
  }
  if ((await ownedIds(playerId, run)).includes(itemId)) throw new ApiError(409, "ALREADY_OWNED");
  const balance = await chalkBalance(playerId, run);
  if (balance < item.price) throw new ApiError(402, "INSUFFICIENT_CHALK", { needed: item.price - balance });
  await recordMovement(db, playerId, -item.price, "purchase", { itemId });
  await db.query("INSERT INTO owned_items (player_id, item_id) VALUES ($1, $2)", [playerId, itemId]);
  const response = { chalk: balance - item.price, owned: await ownedIds(playerId, run) };
  await db.query("INSERT INTO idempotent_requests (player_id, scope, key, fingerprint, response) VALUES ($1, 'purchase', $2, $3, $4)", [
    playerId,
    key,
    print,
    JSON.stringify(response),
  ]);
  return response;
}

const EQUIP_COLUMN: Record<ItemKind, string> = { striker: "equipped_striker", board: "equipped_board", coins: "equipped_coins" };

export async function equip(playerId: string, itemId: string): Promise<Record<ItemKind, string>> {
  const item = SHOP_ITEMS.find((i) => i.id === itemId);
  if (!item) throw new ApiError(403, "NOT_OWNED");
  const owned = ownsByDefault(itemId) || (await query("SELECT 1 FROM owned_items WHERE player_id = $1 AND item_id = $2", [playerId, itemId])).length > 0;
  if (!owned) throw new ApiError(403, "NOT_OWNED");
  const updated = await query(
    `UPDATE players SET ${EQUIP_COLUMN[item.kind]} = $2 WHERE id = $1 RETURNING equipped_striker, equipped_board, equipped_coins`,
    [playerId, itemId],
  );
  const row = updated[0];
  return { striker: row?.equipped_striker as string, board: row?.equipped_board as string, coins: row?.equipped_coins as string };
}

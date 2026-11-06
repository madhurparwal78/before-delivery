/** The trade state machine: offers held, accepts versioned and expiring, completion atomic. */

import type { Pool, Queryer } from "../db/pool.js";
import { newId } from "../db/seed.js";
import { publish } from "../api/events.js";
import { isoInstant } from "../time.js";
import { writeLedgerEntry, balanceOf, availableCoins } from "../coins/ledger.js";

export interface TradeRow {
  id: string;
  server_id: string;
  world_id: string;
  state: "open" | "completed" | "cancelled";
  version: number;
  a_character_id: string;
  b_character_id: string;
  updated_at: Date;
}

export interface TradeSide {
  character_id: string;
  coins: number;
  items: { kind: string; count: number }[];
  accepted: boolean;
  accepted_at: Date | null;
}

export interface TradeView {
  id: string;
  state: "open" | "completed" | "cancelled";
  version: number;
  sides: { character_id: string; name: string; coins: number; items: { kind: string; count: number }[]; accepted: boolean; accepted_at: string | null }[];
  updated_at: string;
}

export async function tradeView(pool: Pool, tradeId: string): Promise<TradeView | null> {
  const trade = (await pool.query<TradeRow>("SELECT * FROM trades WHERE id = $1", [tradeId])).rows[0];
  if (trade === undefined) return null;
  const sides = await pool.query<TradeSide & { name: string }>(
    `SELECT ts.character_id, ts.coins, ts.items, ts.accepted, ts.accepted_at, c.name
     FROM trade_sides ts JOIN characters c ON c.id = ts.character_id WHERE ts.trade_id = $1`,
    [tradeId]
  );
  return {
    id: trade.id,
    state: trade.state,
    version: trade.version,
    sides: sides.rows.map((s) => ({
      character_id: s.character_id,
      name: s.name,
      coins: s.coins,
      items: s.items as { kind: string; count: number }[],
      accepted: s.accepted,
      accepted_at: s.accepted_at === null ? null : isoInstant(s.accepted_at),
    })),
    updated_at: isoInstant(trade.updated_at),
  };
}

export type OpenError = "trade_open" | "too_far";

/** Opens a trade between two characters within one tile of each other. */
export async function openTrade(
  pool: Pool,
  input: { serverId: string; worldId: string; characterId: string; partnerId: string; coins: number; items: { kind: string; count: number }[] }
): Promise<{ ok: boolean; error?: OpenError; tradeId?: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`trade:${input.characterId}`]);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`trade:${input.partnerId}`]);
    const mine = (await client.query<{ x: number; y: number }>("SELECT x, y FROM characters WHERE id = $1", [input.characterId])).rows[0];
    const partner = (await client.query<{ x: number; y: number }>("SELECT x, y FROM characters WHERE id = $1", [input.partnerId])).rows[0];
    if (mine === undefined || partner === undefined) {
      await client.query("ROLLBACK");
      return { ok: false, error: "too_far" };
    }
    if (Math.abs(mine.x - partner.x) > 1 || Math.abs(mine.y - partner.y) > 1) {
      await client.query("ROLLBACK");
      return { ok: false, error: "too_far" };
    }
    const anyOpen = (
      await client.query("SELECT 1 FROM trades WHERE state = 'open' AND ($1 IN (a_character_id, b_character_id) OR $2 IN (a_character_id, b_character_id))", [
        input.characterId,
        input.partnerId,
      ])
    ).rows;
    if (anyOpen.length > 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "trade_open" };
    }
    const tradeId = newId();
    await client.query("INSERT INTO trades (id, server_id, world_id, state, a_character_id, b_character_id) VALUES ($1,$2,$3,'open',$4,$5)", [
      tradeId,
      input.serverId,
      input.worldId,
      input.characterId,
      input.partnerId,
    ]);
    for (const [characterId, coins, items] of [
      [input.characterId, input.coins, input.items],
      [input.partnerId, 0, []],
    ] as [string, number, { kind: string; count: number }[]][]) {
      await client.query("INSERT INTO trade_sides (trade_id, character_id, coins, items) VALUES ($1,$2,$3,$4)", [
        tradeId,
        characterId,
        coins,
        JSON.stringify(items),
      ]);
    }
    await holdItems(client, input.characterId, input.items);
    await client.query("COMMIT");
    await publishTrade(pool, tradeId);
    return { ok: true, tradeId };
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

export type OfferError = "trade_closed" | "trade_changed";

/** Updates one side's offer: the version rises and both accepts clear. */
export async function updateOffer(
  pool: Pool,
  input: { tradeId: string; characterId: string; version: number; coins: number; items: { kind: string; count: number }[] }
): Promise<{ ok: boolean; error?: OfferError; trade?: TradeView }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const trade = (await client.query<TradeRow>("SELECT * FROM trades WHERE id = $1 FOR UPDATE", [input.tradeId])).rows[0];
    if (trade === undefined || trade.state !== "open") {
      await client.query("ROLLBACK");
      return { ok: false, error: "trade_closed" };
    }
    if (trade.version !== input.version) {
      await client.query("ROLLBACK");
      return { ok: false, error: "trade_changed" };
    }
    const before = (await client.query<TradeSide>("SELECT coins, items FROM trade_sides WHERE trade_id = $1 AND character_id = $2", [
      input.tradeId,
      input.characterId,
    ])).rows[0];
    if (before !== undefined) {
      await unholdItems(client, input.characterId, before.items as { kind: string; count: number }[]);
    }
    await client.query("UPDATE trade_sides SET coins = $3, items = $4, accepted = false, accepted_at = NULL WHERE trade_id = $1 AND character_id = $2", [
      input.tradeId,
      input.characterId,
      input.coins,
      JSON.stringify(input.items),
    ]);
    await client.query("UPDATE trade_sides SET accepted = false, accepted_at = NULL WHERE trade_id = $1 AND character_id <> $2", [
      input.tradeId,
      input.characterId,
    ]);
    await client.query("UPDATE trades SET version = version + 1, updated_at = now() WHERE id = $1", [input.tradeId]);
    await holdItems(client, input.characterId, input.items);
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
  const view = await tradeView(pool, input.tradeId);
  await publishTrade(pool, input.tradeId);
  return { ok: true, trade: view ?? undefined };
}

export type AcceptError = "trade_closed" | "trade_changed" | "inventory_full" | "not_enough";

/** Accepts the current version's contents; completes when both sides accepted, atomically. */
export async function acceptTrade(pool: Pool, input: { tradeId: string; characterId: string; version: number }): Promise<{ ok: boolean; error?: AcceptError; trade?: TradeView; completed?: boolean }> {
  const client = await pool.connect();
  let completed = false;
  try {
    await client.query("BEGIN");
    const trade = (await client.query<TradeRow>("SELECT * FROM trades WHERE id = $1 FOR UPDATE", [input.tradeId])).rows[0];
    if (trade === undefined || trade.state !== "open") {
      await client.query("ROLLBACK");
      return { ok: false, error: "trade_closed" };
    }
    if (trade.version !== input.version) {
      await client.query("ROLLBACK");
      return { ok: false, error: "trade_changed" };
    }
    const sides = await client.query<TradeSide>("SELECT * FROM trade_sides WHERE trade_id = $1", [input.tradeId]);
    const mine = sides.rows.find((s) => s.character_id === input.characterId);
    if (mine === undefined) {
      await client.query("ROLLBACK");
      return { ok: false, error: "trade_closed" };
    }
    // Lapsed accepts clear: an accept older than 60 seconds no longer counts.
    const fresh = await client.query(
      "UPDATE trade_sides SET accepted = false, accepted_at = NULL WHERE trade_id = $1 AND accepted_at < now() - interval '60 seconds' RETURNING character_id",
      [input.tradeId]
    );
    void fresh;
    await client.query("UPDATE trade_sides SET accepted = true, accepted_at = now() WHERE trade_id = $1 AND character_id = $2", [
      input.tradeId,
      input.characterId,
    ]);
    const nowSides = (await client.query<TradeSide>("SELECT * FROM trade_sides WHERE trade_id = $1 FOR UPDATE", [input.tradeId])).rows;
    const bothAccepted = nowSides.length === 2 && nowSides.every((s) => s.accepted && s.accepted_at !== null && Date.now() - s.accepted_at.getTime() <= 60000);
    if (bothAccepted) {
      const a = nowSides[0]!;
      const b = nowSides[1]!;
      // Check inventories can take the incoming items and coins suffice.
      for (const [receiver, fromSide] of [
        [b.character_id, a],
        [a.character_id, b],
      ] as [string, TradeSide][]) {
        const available = await availableCoins(client, fromSide.character_id);
        if (available < fromSide.coins) {
          await client.query("ROLLBACK");
          return { ok: false, error: "not_enough" };
        }
        if (!(await inventoryCanTake(client, receiver, fromSide.items))) {
          await client.query("ROLLBACK");
          return { ok: false, error: "inventory_full" };
        }
      }
      // Move the items and coins.
      for (const [receiver, fromSide] of [
        [b.character_id, a],
        [a.character_id, b],
      ] as [string, TradeSide][]) {
        await moveItemsOut(client, fromSide.character_id, fromSide.items);
        await moveItemsIn(client, receiver, fromSide.items);
      }
      const lines: { account: string; amount: number }[] = [];
      if (a.coins > 0) {
        lines.push({ account: a.character_id, amount: -a.coins });
        lines.push({ account: b.character_id, amount: a.coins });
      }
      if (b.coins > 0) {
        lines.push({ account: b.character_id, amount: -b.coins });
        lines.push({ account: a.character_id, amount: b.coins });
      }
      await writeLedgerEntry(client, { serverId: trade.server_id, kind: "trade", tradeId: trade.id, lines });
      await unholdItems(client, a.character_id, a.items as { kind: string; count: number }[]);
      await unholdItems(client, b.character_id, b.items as { kind: string; count: number }[]);
      await client.query("UPDATE trades SET state = 'completed', version = version + 1, updated_at = now() WHERE id = $1", [input.tradeId]);
      completed = true;
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
  const view = await tradeView(pool, input.tradeId);
  await publishTrade(pool, input.tradeId);
  return { ok: true, trade: view ?? undefined, completed };
}

export async function cancelTrade(pool: Pool, tradeId: string, characterId: string): Promise<{ ok: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const trade = (await client.query<TradeRow>("SELECT * FROM trades WHERE id = $1 FOR UPDATE", [tradeId])).rows[0];
    if (trade === undefined || trade.state !== "open") {
      await client.query("ROLLBACK");
      return { ok: false };
    }
    if (trade.a_character_id !== characterId && trade.b_character_id !== characterId) {
      await client.query("ROLLBACK");
      return { ok: false };
    }
    const sides = await client.query<TradeSide>("SELECT character_id, items FROM trade_sides WHERE trade_id = $1", [tradeId]);
    for (const side of sides.rows) {
      await unholdItems(client, side.character_id, side.items as { kind: string; count: number }[]);
    }
    await client.query("UPDATE trades SET state = 'cancelled', version = version + 1, updated_at = now() WHERE id = $1", [tradeId]);
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
  await publishTrade(pool, tradeId);
  return { ok: true };
}

async function publishTrade(pool: Pool, tradeId: string): Promise<void> {
  const trade = (await pool.query<TradeRow>("SELECT server_id, a_character_id, b_character_id, state FROM trades WHERE id = $1", [tradeId])).rows[0];
  if (trade === undefined) return;
  const names = await pool.query<{ handle: string }[] | { handle: string; character_id: string }>(
    `SELECT u.handle, c.id AS character_id FROM users u JOIN characters c ON c.user_id = u.id WHERE c.id IN ($1, $2)`,
    [trade.a_character_id, trade.b_character_id]
  );
  const view = await tradeView(pool, tradeId);
  if (view === null) return;
  void names;
  await publish(pool, trade.server_id, [{ kind: "trade", payload: view, audience: { characters: [trade.a_character_id, trade.b_character_id] } }]);
}

/** Marks items as held: the offered part cannot move or be spent elsewhere. */
async function holdItems(client: Queryer, characterId: string, items: { kind: string; count: number }[]): Promise<void> {
  for (const item of items) {
    let left = item.count;
    const slots = await client.query<{ slot: number; count: number; held: number }>(
      "SELECT slot, count, held FROM inventory_slots WHERE character_id = $1 AND kind = $2 ORDER BY slot",
      [characterId, item.kind]
    );
    for (const slot of slots.rows) {
      if (left <= 0) break;
      const free = slot.count - slot.held;
      const hold = Math.min(free, left);
      if (hold <= 0) continue;
      await client.query("UPDATE inventory_slots SET held = held + $3 WHERE character_id = $1 AND slot = $2", [characterId, slot.slot, hold]);
      left -= hold;
    }
  }
}

/** Clears the holds of items that are no longer offered. */
async function unholdItems(client: Queryer, characterId: string, items: { kind: string; count: number }[]): Promise<void> {
  for (const item of items) {
    let left = item.count;
    const slots = await client.query<{ slot: number; held: number }>(
      "SELECT slot, held FROM inventory_slots WHERE character_id = $1 AND kind = $2 AND held > 0 ORDER BY slot",
      [characterId, item.kind]
    );
    for (const slot of slots.rows) {
      if (left <= 0) break;
      const free = Math.min(slot.held, left);
      await client.query("UPDATE inventory_slots SET held = held - $3 WHERE character_id = $1 AND slot = $2", [characterId, slot.slot, free]);
      left -= free;
    }
  }
}

/** Removes unheld items from the lowest slots first. */
async function moveItemsOut(client: Queryer, characterId: string, items: { kind: string; count: number }[]): Promise<void> {
  for (const item of items) {
    let left = item.count;
    const slots = await client.query<{ slot: number; count: number }>(
      "SELECT slot, count FROM inventory_slots WHERE character_id = $1 AND kind = $2 ORDER BY slot",
      [characterId, item.kind]
    );
    for (const slot of slots.rows) {
      if (left <= 0) break;
      const take = Math.min(slot.count, left);
      await client.query("UPDATE inventory_slots SET count = count - $3 WHERE character_id = $1 AND slot = $2", [characterId, slot.slot, take]);
      if (slot.count - take <= 0) {
        await client.query("UPDATE inventory_slots SET kind = NULL WHERE character_id = $1 AND slot = $2", [characterId, slot.slot]);
      }
      left -= take;
    }
  }
}

/** Adds items by the stacking rule. */
async function moveItemsIn(client: Queryer, characterId: string, items: { kind: string; count: number }[]): Promise<void> {
  for (const item of items) {
    let left = item.count;
    const slots = await client.query<{ slot: number; count: number }>(
      "SELECT slot, count FROM inventory_slots WHERE character_id = $1 AND kind = $2 AND count < 64 ORDER BY slot",
      [characterId, item.kind]
    );
    for (const slot of slots.rows) {
      if (left <= 0) break;
      const add = Math.min(64 - slot.count, left);
      await client.query("UPDATE inventory_slots SET count = count + $3 WHERE character_id = $1 AND slot = $2", [characterId, slot.slot, add]);
      left -= add;
    }
    while (left > 0) {
      const empty = (await client.query<{ slot: number }>(
        "SELECT slot FROM inventory_slots WHERE character_id = $1 AND kind IS NULL ORDER BY slot LIMIT 1",
        [characterId]
      )).rows[0];
      if (empty === undefined) throw new Error("Inventory full");
      const add = Math.min(64, left);
      await client.query("UPDATE inventory_slots SET kind = $3, count = $4 WHERE character_id = $1 AND slot = $2", [characterId, empty.slot, item.kind, add]);
      left -= add;
    }
  }
}

/** True when the receiver can take these items by the stacking rule. */
async function inventoryCanTake(client: Queryer, characterId: string, items: { kind: string; count: number }[]): Promise<boolean> {
  for (const item of items) {
    let left = item.count;
    const slots = await client.query<{ count: number }>(
      "SELECT count FROM inventory_slots WHERE character_id = $1 AND kind = $2 AND count < 64 ORDER BY slot",
      [characterId, item.kind]
    );
    for (const slot of slots.rows) {
      left -= 64 - slot.count;
      if (left <= 0) break;
    }
    while (left > 0) {
      const empty = (await client.query<{ slot: number }>(
        "SELECT slot FROM inventory_slots WHERE character_id = $1 AND kind IS NULL ORDER BY slot LIMIT 1",
        [characterId]
      )).rows[0];
      if (empty === undefined) return false;
      left -= 64;
    }
  }
  return true;
}

export { balanceOf };

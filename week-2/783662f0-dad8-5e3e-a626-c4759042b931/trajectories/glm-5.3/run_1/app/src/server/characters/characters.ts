/** Characters: creation, the roster limits, appearance, inventory moves and crafting. */

import type { Pool, Client } from "../db/pool.js";
import { newId } from "../db/seed.js";
import { Appearances, LoadoutItems, MaxCharactersPerUser, Plans, Recipes, SpawnTile, StarterStacks, itemName } from "../../shared/data.js";
import { writeLedgerEntry, balanceOf, heldCoins, walletLines } from "../coins/ledger.js";
import { isoInstant } from "../time.js";

export interface CharacterView {
  id: string;
  name: string;
  owner: string;
  world: string;
  x: number;
  y: number;
  appearance: "surveyor" | "mason" | "pilot" | "gardener";
  loadout: string[];
  balance: number;
  available: number;
}

export async function characterView(client: Pool | Client, characterId: string): Promise<CharacterView | null> {
  const row = (
    await client.query<{ id: string; name: string; user_id: string; world_id: string; x: number; y: number; appearance: "surveyor" | "mason" | "pilot" | "gardener" }>(
      "SELECT id, name, user_id, world_id, x, y, appearance FROM characters WHERE id = $1",
      [characterId]
    )
  ).rows[0];
  if (row === undefined) return null;
  const loadoutRows = await client.query<{ kind: string }>(
    "SELECT DISTINCT kind FROM inventory_slots WHERE character_id = $1 AND kind = ANY($2)",
    [characterId, [...LoadoutItems]]
  );
  const loadout = loadoutRows.rows;
  const world = (await client.query<{ slug: string }>("SELECT slug FROM worlds WHERE id = $1", [row.world_id])).rows[0];
  const balance = await balanceOf(client, characterId);
  const held = await heldCoins(client, characterId);
  return {
    id: row.id,
    name: row.name,
    owner: row.user_id,
    world: world?.slug ?? "",
    x: row.x,
    y: row.y,
    appearance: row.appearance,
    loadout: loadout.map((l) => l.kind).filter((k) => LoadoutItems.includes(k as (typeof LoadoutItems)[number])),
    balance,
    available: balance - held.trades,
  };
}

export type CreateError = "roster_full" | "character_limit" | "name_taken";

export interface CreateInput {
  serverId: string;
  userId: string;
  worldId: string;
  name: string;
  appearance: string;
  loadout: string[];
}

/** Creates a character with the starter stacks, its loadout items, and the 500-coin grant. */
export async function createCharacter(pool: Pool, input: CreateInput): Promise<{ ok: true; characterId: string } | { ok: false; error: CreateError }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`roster:${input.userId}:${input.serverId}`]);
    const mine = (await client.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM characters WHERE server_id = $1 AND user_id = $2",
      [input.serverId, input.userId]
    )).rows[0];
    if (Number(mine?.n ?? 0) >= MaxCharactersPerUser) {
      await client.query("ROLLBACK");
      return { ok: false, error: "roster_full" };
    }
    const plan = (await client.query<{ plan: "hamlet" | "borough" }>("SELECT plan FROM servers WHERE id = $1", [input.serverId])).rows[0];
    const total = (await client.query<{ n: string }>("SELECT count(*)::text AS n FROM characters WHERE server_id = $1", [input.serverId])).rows[0];
    if (plan !== undefined && Number(total?.n ?? 0) >= Plans[plan.plan].characters) {
      await client.query("ROLLBACK");
      return { ok: false, error: "character_limit" };
    }
    const taken = (await client.query("SELECT 1 FROM characters WHERE server_id = $1 AND lower(name) = lower($2)", [input.serverId, input.name])).rows;
    if (taken.length > 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "name_taken" };
    }
    const characterId = newId();
    await client.query(
      "INSERT INTO characters (id, server_id, user_id, world_id, name, appearance, x, y) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [characterId, input.serverId, input.userId, input.worldId, input.name, input.appearance, SpawnTile.x, SpawnTile.y]
    );
    for (let slot = 1; slot <= 24; slot++) {
      const stack = StarterStacks.find((st) => st.slot === slot);
      await client.query("INSERT INTO inventory_slots (character_id, slot, kind, count) VALUES ($1,$2,$3,$4)", [
        characterId,
        slot,
        stack?.kind ?? null,
        stack?.count ?? 0,
      ]);
    }
    // Loadout items follow the starter stacks, one each, in listbox order.
    let slot = StarterStacks.length + 1;
    for (const kind of LoadoutItems) {
      if (input.loadout.includes(kind)) {
        await client.query("UPDATE inventory_slots SET kind = $3, count = 1 WHERE character_id = $1 AND slot = $2", [characterId, slot, kind]);
        slot += 1;
      }
    }
    await writeLedgerEntry(client, {
      serverId: input.serverId,
      kind: "grant",
      lines: [
        { account: "house", amount: -500 },
        { account: characterId, amount: 500 },
      ],
    });
    await client.query("COMMIT");
    return { ok: true, characterId };
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

export async function setAppearance(pool: Pool, characterId: string, appearance: string): Promise<boolean> {
  if (!Appearances.includes(appearance as (typeof Appearances)[number])) return false;
  await pool.query("UPDATE characters SET appearance = $2 WHERE id = $1", [characterId, appearance]);
  return true;
}

export interface InventoryView {
  character_id: string;
  slots: { slot: number; kind: string | null; count: number; held: number }[];
}

export async function inventoryView(client: Pool | Client, characterId: string): Promise<InventoryView> {
  const rows = await client.query<{ slot: number; kind: string | null; count: number; held: number }>(
    "SELECT slot, kind, count, held FROM inventory_slots WHERE character_id = $1 ORDER BY slot",
    [characterId]
  );
  return { character_id: characterId, slots: rows.rows.map((r) => ({ slot: r.slot, kind: r.kind, count: r.count, held: r.held })) };
}

export type MoveError = "slot_held" | "empty_slot";

/** One inventory move: merge, swap or relocate, with the published stack rules. */
export async function moveSlot(pool: Pool, characterId: string, from: number, to: number): Promise<{ ok: true } | { ok: false; error: MoveError }> {
  if (from === to) return { ok: true };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const a = (await client.query<{ slot: number; kind: string | null; count: number; held: number }>(
      "SELECT slot, kind, count, held FROM inventory_slots WHERE character_id = $1 AND slot = $2 FOR UPDATE",
      [characterId, from]
    )).rows[0];
    const b = (await client.query<{ slot: number; kind: string | null; count: number; held: number }>(
      "SELECT slot, kind, count, held FROM inventory_slots WHERE character_id = $1 AND slot = $2 FOR UPDATE",
      [characterId, to]
    )).rows[0];
    if (a === undefined || b === undefined) {
      await client.query("ROLLBACK");
      return { ok: false, error: "empty_slot" };
    }
    if (a.held > 0 || b.held > 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "slot_held" };
    }
    if (a.kind === null || a.count === 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "empty_slot" };
    }
    if (b.kind === null || b.count === 0) {
      await client.query("UPDATE inventory_slots SET kind = $3, count = $4 WHERE character_id = $1 AND slot = $2", [characterId, to, a.kind, a.count]);
      await client.query("UPDATE inventory_slots SET kind = NULL, count = 0 WHERE character_id = $1 AND slot = $2", [characterId, from]);
    } else if (b.kind === a.kind) {
      const add = Math.min(64 - b.count, a.count);
      await client.query("UPDATE inventory_slots SET count = count + $3 WHERE character_id = $1 AND slot = $2", [characterId, to, add]);
      const rest = a.count - add;
      await client.query("UPDATE inventory_slots SET count = $3 WHERE character_id = $1 AND slot = $2", [characterId, from, rest]);
      if (rest === 0) {
        await client.query("UPDATE inventory_slots SET kind = NULL WHERE character_id = $1 AND slot = $2", [characterId, from]);
      }
    } else {
      await client.query("UPDATE inventory_slots SET kind = $3, count = $4 WHERE character_id = $1 AND slot = $2", [characterId, from, b.kind, b.count]);
      await client.query("UPDATE inventory_slots SET kind = $3, count = $4 WHERE character_id = $1 AND slot = $2", [characterId, to, a.kind, a.count]);
    }
    await client.query("COMMIT");
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

export type CraftError = "missing_ingredients" | "inventory_full";

/** Crafting removes its inputs and adds its output in one transaction, or changes nothing. */
export async function craft(pool: Pool, characterId: string, recipeId: string): Promise<{ ok: true; output: { kind: string; count: number } } | { ok: false; error: CraftError }> {
  const recipe = Recipes.find((r) => r.id === recipeId);
  if (recipe === undefined) return { ok: false, error: "missing_ingredients" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const input of recipe.inputs) {
      const rows = await client.query<{ count: number }>(
        "SELECT count FROM inventory_slots WHERE character_id = $1 AND kind = $2 ORDER BY slot",
        [characterId, input.kind]
      );
      const total = rows.rows.reduce((sum, r) => sum + r.count, 0);
      if (total < input.count) {
        await client.query("ROLLBACK");
        return { ok: false, error: "missing_ingredients" };
      }
    }
    for (const input of recipe.inputs) {
      let left = input.count;
      const rows = await client.query<{ slot: number; count: number; held: number }>(
        "SELECT slot, count, held FROM inventory_slots WHERE character_id = $1 AND kind = $2 ORDER BY slot",
        [characterId, input.kind]
      );
      for (const row of rows.rows) {
        const available = row.count - row.held;
        if (available <= 0) continue;
        const take = Math.min(available, left);
        await client.query("UPDATE inventory_slots SET count = count - $3 WHERE character_id = $1 AND slot = $2", [characterId, row.slot, take]);
        if (row.count - take <= 0) {
          await client.query("UPDATE inventory_slots SET kind = NULL WHERE character_id = $1 AND slot = $2", [characterId, row.slot]);
        }
        left -= take;
        if (left <= 0) break;
      }
    }
    let left = recipe.output.count;
    const partial = await client.query<{ slot: number; count: number }>(
      "SELECT slot, count FROM inventory_slots WHERE character_id = $1 AND kind = $2 AND count < 64 ORDER BY slot",
      [characterId, recipe.output.kind]
    );
    for (const row of partial.rows) {
      const add = Math.min(64 - row.count, left);
      await client.query("UPDATE inventory_slots SET count = count + $3 WHERE character_id = $1 AND slot = $2", [characterId, row.slot, add]);
      left -= add;
      if (left <= 0) break;
    }
    while (left > 0) {
      const empty = (await client.query<{ slot: number }>(
        "SELECT slot FROM inventory_slots WHERE character_id = $1 AND kind IS NULL ORDER BY slot LIMIT 1",
        [characterId]
      )).rows[0];
      if (empty === undefined) {
        await client.query("ROLLBACK");
        return { ok: false, error: "inventory_full" };
      }
      const add = Math.min(64, left);
      await client.query("UPDATE inventory_slots SET kind = $3, count = $4 WHERE character_id = $1 AND slot = $2", [characterId, empty.slot, recipe.output.kind, add]);
      left -= add;
    }
    await client.query("COMMIT");
    return { ok: true, output: { kind: recipe.output.kind, count: recipe.output.count } };
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

/** The wallet view of a character. */
export async function walletView(client: Pool | Client, characterId: string): Promise<{ character_id: string; balance: number; available: number; lines: unknown[] }> {
  const balance = await balanceOf(client, characterId);
  const held = await heldCoins(client, characterId);
  const lines = await walletLines(client, characterId);
  return {
    character_id: characterId,
    balance,
    available: balance - held.trades,
    lines: lines.map((l) => ({
      kind: l.kind,
      game_id: l.game_id,
      trade_id: l.trade_id,
      purchase_id: l.purchase_id,
      amount: l.amount,
      created_at: isoInstant(l.created_at),
    })),
  };
}

export function displayNameOf(kind: string): string {
  return itemName(kind);
}

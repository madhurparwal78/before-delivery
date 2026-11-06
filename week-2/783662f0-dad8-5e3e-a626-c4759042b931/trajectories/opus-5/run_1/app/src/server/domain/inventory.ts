import type { PoolClient, QueryResultRow } from 'pg';
import { query } from '../db/pool.js';
import { fail } from '../errors.js';
import {
  INVENTORY_SLOTS,
  type ItemKind,
  RECIPES,
  STACK_MAX,
  isItemKind,
} from '../../shared/domain.js';
import type { InventoryObject, InventorySlot } from '../../shared/types.js';

export interface SlotRow {
  slot: number;
  kind: ItemKind | null;
  count: number;
}

const run = async <T extends QueryResultRow>(
  client: PoolClient | undefined,
  sql: string,
  params: readonly unknown[],
): Promise<T[]> =>
  client === undefined
    ? await query<T>(sql, params)
    : (await client.query<T>(sql, params as unknown[])).rows;

export async function slotsOf(characterId: string, client?: PoolClient): Promise<SlotRow[]> {
  const rows = await run<SlotRow>(
    client,
    'SELECT slot, kind, count FROM inventory_slots WHERE character_id = $1 ORDER BY slot',
    [characterId],
  );
  const bySlot = new Map(rows.map((row) => [row.slot, row]));
  const out: SlotRow[] = [];
  for (let slot = 1; slot <= INVENTORY_SLOTS; slot += 1) {
    const row = bySlot.get(slot);
    out.push(row ?? { slot, kind: null, count: 0 });
  }
  return out;
}

/** Items offered in open trades are held and cannot move. */
export async function heldItems(
  characterId: string,
  client?: PoolClient,
): Promise<Map<ItemKind, number>> {
  const rows = await run<{ items: { kind: string; count: number }[] }>(
    client,
    `SELECT CASE WHEN a_char = $1 THEN a_items ELSE b_items END AS items
       FROM trades WHERE state = 'open' AND (a_char = $1 OR b_char = $1)`,
    [characterId],
  );
  const held = new Map<ItemKind, number>();
  for (const row of rows) {
    for (const item of row.items) {
      if (!isItemKind(item.kind)) continue;
      held.set(item.kind, (held.get(item.kind) ?? 0) + item.count);
    }
  }
  return held;
}

/** `held` is the part of each slot's count offered in open trades. */
export async function inventoryObject(
  characterId: string,
  client?: PoolClient,
): Promise<InventoryObject> {
  const slots = await slotsOf(characterId, client);
  const held = await heldItems(characterId, client);
  const remaining = new Map(held);
  const out: InventorySlot[] = slots.map((slot) => {
    if (slot.kind === null) return { slot: slot.slot, kind: null, count: 0, held: 0 };
    const left = remaining.get(slot.kind) ?? 0;
    const taken = Math.min(left, slot.count);
    remaining.set(slot.kind, left - taken);
    return { slot: slot.slot, kind: slot.kind, count: slot.count, held: taken };
  });
  return { character_id: characterId, slots: out };
}

async function writeSlot(
  client: PoolClient,
  characterId: string,
  serverId: string,
  slot: number,
  kind: ItemKind | null,
  count: number,
): Promise<void> {
  if (kind === null || count <= 0) {
    await client.query('DELETE FROM inventory_slots WHERE character_id = $1 AND slot = $2', [
      characterId,
      slot,
    ]);
    return;
  }
  await client.query(
    `INSERT INTO inventory_slots (character_id, server_id, slot, kind, count)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (character_id, slot) DO UPDATE SET kind = $4, count = $5`,
    [characterId, serverId, slot, kind, count],
  );
}

export async function setSlots(
  client: PoolClient,
  characterId: string,
  serverId: string,
  slots: readonly SlotRow[],
): Promise<void> {
  for (const slot of slots) {
    await writeSlot(client, characterId, serverId, slot.slot, slot.kind, slot.count);
  }
}

/**
 * A move between slots: into an empty slot moves the whole stack, onto the same
 * kind merges up to 64 and leaves the rest, onto a different kind swaps.
 */
export function moveSlots(
  slots: readonly SlotRow[],
  from: number,
  to: number,
): { slots: SlotRow[]; moved: ItemKind } {
  const next = slots.map((slot) => ({ ...slot }));
  const source = next[from - 1];
  const target = next[to - 1];
  if (source.kind === null || source.count <= 0) throw fail('empty_slot');
  const moved = source.kind;

  if (from === to) return { slots: next, moved };

  if (target.kind === null) {
    target.kind = source.kind;
    target.count = source.count;
    source.kind = null;
    source.count = 0;
  } else if (target.kind === source.kind) {
    const room = STACK_MAX - target.count;
    const taken = Math.min(room, source.count);
    target.count += taken;
    source.count -= taken;
    if (source.count === 0) source.kind = null;
  } else {
    const kind = target.kind;
    const count = target.count;
    target.kind = source.kind;
    target.count = source.count;
    source.kind = kind;
    source.count = count;
  }
  return { slots: next, moved };
}

/**
 * Adds one item by the stacking rule: the first slot holding that kind with
 * fewer than 64, or else the first empty slot.
 */
export function addItem(
  slots: readonly SlotRow[],
  kind: ItemKind,
  count: number,
): SlotRow[] | null {
  const next = slots.map((slot) => ({ ...slot }));
  let left = count;
  for (const slot of next) {
    if (left === 0) break;
    if (slot.kind !== kind || slot.count >= STACK_MAX) continue;
    const taken = Math.min(STACK_MAX - slot.count, left);
    slot.count += taken;
    left -= taken;
  }
  for (const slot of next) {
    if (left === 0) break;
    if (slot.kind !== null) continue;
    const taken = Math.min(STACK_MAX, left);
    slot.kind = kind;
    slot.count = taken;
    left -= taken;
  }
  return left === 0 ? next : null;
}

/** Takes unheld items from the lowest slots first. */
export function takeItems(
  slots: readonly SlotRow[],
  held: ReadonlyMap<ItemKind, number>,
  kind: ItemKind,
  count: number,
): SlotRow[] | null {
  const available = countUnheld(slots, held, kind);
  if (available < count) return null;
  const next = slots.map((slot) => ({ ...slot }));
  const protect = held.get(kind) ?? 0;
  let keep = protect;
  let left = count;
  for (const slot of next) {
    if (left === 0) break;
    if (slot.kind !== kind) continue;
    const reserved = Math.min(keep, slot.count);
    keep -= reserved;
    const free = slot.count - reserved;
    const taken = Math.min(free, left);
    slot.count -= taken;
    left -= taken;
    if (slot.count === 0) slot.kind = null;
  }
  return left === 0 ? next : null;
}

export const countOf = (slots: readonly SlotRow[], kind: ItemKind): number =>
  slots.reduce((sum, slot) => sum + (slot.kind === kind ? slot.count : 0), 0);

export const countUnheld = (
  slots: readonly SlotRow[],
  held: ReadonlyMap<ItemKind, number>,
  kind: ItemKind,
): number => Math.max(0, countOf(slots, kind) - (held.get(kind) ?? 0));

/** The first slot, in slot order, holding one unheld block of that material. */
export function findUnheldSlot(
  slots: readonly SlotRow[],
  held: ReadonlyMap<ItemKind, number>,
  kind: ItemKind,
): number | null {
  let keep = held.get(kind) ?? 0;
  for (const slot of slots) {
    if (slot.kind !== kind) continue;
    const reserved = Math.min(keep, slot.count);
    keep -= reserved;
    if (slot.count - reserved > 0) return slot.slot;
  }
  return null;
}

export const recipeById = (id: string) => RECIPES.find((recipe) => recipe.id === id) ?? null;

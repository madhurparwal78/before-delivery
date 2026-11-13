import type { Db } from './db.js';
import { deriveList, type DerivedLine, type ItemStock } from '../domain/derived.js';
import { CATEGORIES, type Category, type CarryMode, type DisplayUnit, type ListState, type PaperSize } from '../domain/types.js';
import { formatWeight } from '../domain/format.js';
import { currentSheetContent, sheetContentKey, type SheetContent } from '../domain/sheet.js';

/**
 * Server reads. Every figure the API answers is derived from current line
 * state here; none of these values is stored.
 */

export interface ItemRow {
  readonly id: string;
  readonly name: string;
  readonly category: Category;
  readonly weight_grams: number;
  readonly units_owned: number;
  readonly status: 'active' | 'retired';
  readonly price_cents: number | null;
  readonly notes: string;
  readonly photo_id: string | null;
  readonly version: number;
}

export interface LineRow {
  readonly id: string;
  readonly list_id: string;
  readonly item_id: string;
  readonly quantity: number;
  readonly mode: CarryMode;
  readonly name: string;
  readonly unit_weight_grams: number;
  readonly position: number;
}

export interface ListRow {
  readonly id: string;
  readonly name: string;
  readonly state: ListState;
  readonly created_at: Date;
}

export async function readHiker(db: Db): Promise<{ displayName: string; unit: DisplayUnit; goalGrams: number; timeZone: string; paperSize: PaperSize } | null> {
  const rows = await db`SELECT display_name, unit, goal_grams, time_zone, paper_size FROM hiker WHERE id = 1`;
  const row = rows[0];
  if (row === undefined) return null;
  return {
    displayName: row.display_name as string,
    unit: row.unit as DisplayUnit,
    goalGrams: Number(row.goal_grams),
    timeZone: row.time_zone as string,
    paperSize: row.paper_size as PaperSize,
  };
}

export async function readItems(db: Db): Promise<ItemRow[]> {
  return (await db`SELECT id, name, category, weight_grams, units_owned, status, price_cents, notes, photo_id, version FROM closet_items ORDER BY status ASC, category ASC, name ASC`) as unknown as ItemRow[];
}

export async function readItemsById(db: Db): Promise<Map<string, ItemRow>> {
  const rows = await readItems(db);
  return new Map(rows.map((row) => [row.id, row]));
}

export function itemStock(row: ItemRow): ItemStock {
  return { id: row.id, name: row.name, category: row.category, weightGrams: row.weight_grams, unitsOwned: row.units_owned, status: row.status };
}

/** The public Item shape, with its derived packed-in count. */
export function itemJson(row: ItemRow, packedInLists: number, photo: { id: string; url: string } | null, unit: DisplayUnit) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    weightGrams: row.weight_grams,
    weightDisplay: formatWeight(row.weight_grams, unit),
    unitsOwned: row.units_owned,
    status: row.status,
    priceCents: row.price_cents,
    notes: row.notes,
    photo: photo === null ? null : { id: photo.id, status: 'ready', url: `/api/photos/${photo.id}` },
    packedInLists,
    version: row.version,
  };
}

/** Packed-in counts: planning or packed lists holding an in-closet line. */
export async function packedInCounts(db: Db): Promise<Map<string, number>> {
  const rows = await db`
    SELECT l.item_id, COUNT(DISTINCT li.id) AS packed
    FROM lines l
    JOIN lists li ON li.id = l.list_id
    JOIN closet_items ci ON ci.id = l.item_id
    WHERE li.state IN ('planning','packed') AND l.quantity <= ci.units_owned
    GROUP BY l.item_id`;
  const out = new Map<string, number>();
  for (const row of rows) {
    out.set(row.item_id as string, Number(row.packed));
  }
  return out;
}

export async function readLists(db: Db): Promise<ListRow[]> {
  return (await db`SELECT id, name, state, created_at FROM lists ORDER BY created_at DESC, id DESC`) as unknown as ListRow[];
}

export async function readList(db: Db, id: string): Promise<ListRow | null> {
  const rows = await db`SELECT id, name, state, created_at FROM lists WHERE id = ${id}`;
  return (rows[0] as unknown as ListRow) ?? null;
}

export async function readLines(db: Db, listId: string): Promise<LineRow[]> {
  return (await db`SELECT id, list_id, item_id, quantity, mode, name, unit_weight_grams, position FROM lines WHERE list_id = ${listId} ORDER BY position ASC`) as unknown as LineRow[];
}

export interface DerivedListResult {
  readonly list: ListRow;
  readonly derivedLines: readonly DerivedLine[];
  readonly stock: ReadonlyMap<string, ItemRow>;
}

export function lineFromRow(row: LineRow, state: ListState, stock: ReadonlyMap<string, ItemRow>) {
  const item = stock.get(row.item_id);
  // Frozen lines keep their stored name and weight on packed and walked lists.
  if (state === 'planning' && item !== undefined) {
    return { id: row.id, itemId: row.item_id, name: item.name, category: item.category, quantity: row.quantity, mode: row.mode, unitWeightGrams: item.weight_grams };
  }
  return { id: row.id, itemId: row.item_id, name: row.name, category: item?.category ?? ('Essentials' as Category), quantity: row.quantity, mode: row.mode, unitWeightGrams: row.unit_weight_grams };
}

export function deriveForList(list: ListRow, lineRows: readonly LineRow[], stock: ReadonlyMap<string, ItemRow>, goalGrams: number, unit: DisplayUnit) {
  const lines = lineRows.map((row) => lineFromRow(row, list.state, stock));
  const stockMap = new Map<string, ItemStock>([...stock.values()].map((row) => [row.id, itemStock(row)]));
  return deriveList(lines, list.state, stockMap, goalGrams, unit);
}

/** The public List shape with lines, categories and totals. */
export function listJson(list: ListRow, derived: ReturnType<typeof deriveForList>) {
  return {
    id: list.id,
    name: list.name,
    state: list.state,
    lines: derived.lines.map((line) => ({
      id: line.id,
      itemId: line.itemId,
      name: line.name,
      category: line.category,
      quantity: line.quantity,
      mode: line.mode,
      unitWeightGrams: line.unitWeightGrams,
      lineWeightGrams: line.lineWeightGrams,
      baseGrams: line.baseGrams,
      wornGrams: line.wornGrams,
      consumableGrams: line.consumableGrams,
      carryNote: line.carryNote,
      weightDisplay: line.weightDisplay,
      inCloset: line.inCloset,
    })),
    categories: derived.categories.map((entry) => ({
      category: entry.category,
      subtotalGrams: entry.subtotalGrams,
      baseGrams: entry.baseGrams,
      subtotalDisplay: entry.subtotalDisplay,
      baseDisplay: entry.baseDisplay,
    })),
    totals: derived.totals,
  };
}

export interface SheetRow {
  readonly id: string;
  readonly list_id: string;
  readonly paper_size: string;
  readonly content_key: string;
  readonly bytes: number;
  readonly created_at: Date;
}

export async function readSheets(db: Db, listId: string): Promise<SheetRow[]> {
  return (await db`SELECT id, list_id, paper_size, content_key, bytes, created_at FROM pack_sheets WHERE list_id = ${listId} ORDER BY created_at DESC, id DESC`) as unknown as SheetRow[];
}

/** The content the server would render for this list right now. */
export function currentContent(list: ListRow, lines: readonly LineRow[], stock: ReadonlyMap<string, ItemRow>, hiker: { displayName: string; unit: DisplayUnit; goalGrams: number; paperSize: PaperSize }): SheetContent {
  return currentSheetContent({
    listName: list.name,
    state: list.state,
    hikerName: hiker.displayName,
    unit: hiker.unit,
    paperSize: hiker.paperSize,
    goalGrams: hiker.goalGrams,
    lines: lines.map((row) => {
      const item = stock.get(row.item_id);
      const derived = lineFromRow(row, list.state, stock);
      return {
        name: derived.name,
        itemId: row.item_id,
        quantity: row.quantity,
        mode: row.mode,
        nameFrozen: derived.name,
        unitWeightGrams: row.unit_weight_grams,
        unitWeightFrozen: derived.unitWeightGrams,
        inCloset: list.state === 'walked' ? true : item !== undefined && row.quantity <= item.units_owned,
        itemCategory: item?.category ?? ('Essentials' as Category),
      };
    }),
  });
}

export function sheetJson(row: SheetRow, current: boolean, listId: string) {
  return {
    id: row.id,
    listId,
    status: 'ready' as const,
    paperSize: row.paper_size,
    createdAt: row.created_at.toISOString(),
    bytes: row.bytes,
    current,
    url: `/api/pack-sheets/${row.id}/pdf`,
  };
}

export function isCurrent(content: SheetContent, contentKey: string): boolean {
  return sheetContentKey(content) === contentKey;
}

export const CATEGORY_ORDER = CATEGORIES;

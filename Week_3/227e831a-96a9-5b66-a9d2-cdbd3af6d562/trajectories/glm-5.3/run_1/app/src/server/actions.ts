import type { Category } from '../domain/types.js';
import type { Db } from './db.js';
/** An open transaction. */
export type Tx = import('./db.js').Executor;
import { ApiError, itemRetired, listNotEditable, notFound } from './errors.js';
import { invalidOpReason, sameOp, type SyncOp, type SyncRefusal } from '../domain/sync.js';
import type { ItemRow, LineRow, ListRow } from './reads.js';
import { deriveForList, itemStock, listJson, readItemsById } from './reads.js';
import type { CarryMode, DisplayUnit, ListState } from '../domain/types.js';
import { formatWeight, goalDeltaText } from '../domain/format.js';
import type { SheetContent } from '../domain/sheet.js';

/**
 * Write actions shared by the routes: retirement, the sync replay and the
 * pack-sheet document. Each runs its whole write in one transaction.
 */

export interface HikerProfileRow {
  displayName: string;
  unit: DisplayUnit;
  goalGrams: number;
  timeZone: string;
  paperSize: string;
}

/** Applies one retirement inside a transaction and answers its stored body. */
export async function retireItem(db: Db, id: string, row: ItemRow, units: number, reason: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const result = await db.begin(async (tx) => {
    const locked = await tx`SELECT units_owned, status, name FROM closet_items WHERE id = ${id} FOR UPDATE`;
    const current = locked[0] as { units_owned: number; status: string; name: string } | undefined;
    if (current === undefined) throw notFound('item');
    if (current.units_owned === 0) {
      return { status: 409, body: { error: { code: 'item_retired', message: `${current.name} is already retired.` } } };
    }
    if (units > current.units_owned) {
      return { status: 422, body: { error: { code: 'validation_failed', message: 'Check the highlighted fields.', fields: { units: `Enter whole units from 1 to ${current.units_owned}.` } } } };
    }
    const remaining = current.units_owned - units;
    const status = remaining === 0 ? 'retired' : 'active';
    await tx`UPDATE closet_items SET units_owned = ${remaining}, status = ${status}, version = version + 1 WHERE id = ${id}`;
    // affectedLines: planning or packed lines over the remaining stock.
    const affected = await tx`
      SELECT COUNT(*) AS affected FROM lines l JOIN lists li ON li.id = l.list_id
      WHERE li.state IN ('planning','packed') AND l.item_id = ${id} AND l.quantity > ${remaining}`;
    const fresh = await tx`SELECT id, name, category, weight_grams, units_owned, status, price_cents, notes, photo_id, version FROM closet_items WHERE id = ${id}`;
    const updated = fresh[0] as unknown as ItemRow;
    const packed = await packedInCountsTx(tx);
    const item = itemJsonFor(updated, packed.get(id) ?? 0);
    return { status: 200, body: { item, affectedLines: Number(affected[0]?.affected ?? 0) } };
  });
  void reason;
  return result;
}

async function packedInCountsTx(tx: Tx): Promise<Map<string, number>> {
  const rows = await tx`
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

function itemJsonFor(row: ItemRow, packedInLists: number) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    weightGrams: row.weight_grams,
    weightDisplay: '',
    unitsOwned: row.units_owned,
    status: row.status,
    priceCents: row.price_cents,
    notes: row.notes,
    photo: row.photo_id === null ? null : { id: row.photo_id, status: 'ready', url: `/api/photos/${row.photo_id}` },
    packedInLists,
    version: row.version,
  };
}

/** One sync op, applied in its own transaction against current server state. */
export async function applySyncOp(db: Db, op: unknown): Promise<{ opId: string | null; result: 'applied' | 'refused'; reason: SyncRefusal | null }> {
  const shapeError = invalidOpReason(op);
  const record = (typeof op === 'object' && op !== null ? (op as Record<string, unknown>) : {}) as Record<string, unknown>;
  const opId = typeof record['opId'] === 'string' ? (record['opId'] as string) : null;

  // An opId seen before is answered before any state check.
  if (opId !== null && shapeError === null) {
    const remembered = await db`SELECT op, result FROM sync_ops WHERE op_id = ${opId}`;
    const stored = remembered[0];
    if (stored !== undefined) {
      const storedOp = stored.op as unknown;
      if (!sameOp(storedOp as SyncOp, op as SyncOp)) {
        return { opId, result: 'refused', reason: 'op_id_reused' };
      }
      const storedReason = stored.result as string;
      if (storedReason === 'applied') return { opId, result: 'applied', reason: null };
      return { opId, result: 'refused', reason: storedReason as SyncRefusal };
    }
  }
  if (shapeError !== null) {
    // Remember only well-formed opIds: an invalid op is refused, not stored.
    return { opId, result: 'refused', reason: shapeError };
  }

  const parsed = op as unknown as SyncOp;
  const outcome = await db.begin(async (tx) => {
    const listRows = await tx`SELECT id, name, state FROM lists WHERE id = ${parsed.listId} FOR UPDATE`;
    const list = listRows[0] as { id: string; name: string; state: ListState } | undefined;
    if (list === undefined) return 'unknown_list' as SyncRefusal;
    const itemRows = await tx`SELECT id, name, units_owned, status, weight_grams FROM closet_items WHERE id = ${parsed.itemId}`;
    const item = itemRows[0] as { id: string; name: string; units_owned: number; status: string; weight_grams: number } | undefined;
    if (item === undefined) return 'unknown_item' as SyncRefusal;
    const lineRows = await tx`SELECT id, quantity, mode, item_id, list_id, name, unit_weight_grams, position FROM lines WHERE list_id = ${parsed.listId} AND item_id = ${parsed.itemId} FOR UPDATE`;
    const line = lineRows[0] as unknown as LineRow | undefined;

    if (list.state !== 'planning') return 'list_not_editable' as SyncRefusal;

    switch (parsed.type) {
      case 'pack': {
        if (item.units_owned === 0) return 'item_retired' as SyncRefusal;
        if (line !== undefined) return 'already_packed' as SyncRefusal;
        const quantity = parsed.quantity ?? 1;
        const mode = parsed.mode ?? 'base';
        if (quantity > item.units_owned) return 'quantity_exceeds_owned' as SyncRefusal;
        const position = await nextPositionTx(tx, parsed.listId);
        await tx`INSERT INTO lines (id, list_id, item_id, quantity, mode, name, unit_weight_grams, position) VALUES (${newLineId()}, ${parsed.listId}, ${parsed.itemId}, ${quantity}, ${mode}, ${item.name}, ${item.weight_grams}, ${position})`;
        return null;
      }
      case 'set_quantity': {
        if (line === undefined) return 'not_packed' as SyncRefusal;
        if (line.quantity !== parsed.fromQuantity) return 'line_changed' as SyncRefusal;
        if (item.units_owned === 0) return 'item_retired' as SyncRefusal;
        const quantity = parsed.quantity!;
        if (quantity > item.units_owned) return 'quantity_exceeds_owned' as SyncRefusal;
        await tx`UPDATE lines SET quantity = ${quantity} WHERE id = ${line.id}`;
        return null;
      }
      case 'set_mode': {
        if (line === undefined) return 'not_packed' as SyncRefusal;
        await tx`UPDATE lines SET mode = ${parsed.mode ?? 'base'} WHERE id = ${line.id}`;
        return null;
      }
      case 'unpack': {
        if (line === undefined) return 'not_packed' as SyncRefusal;
        await tx`DELETE FROM lines WHERE id = ${line.id}`;
        return null;
      }
    }
  });

  if (outcome !== null) {
    return { opId, result: 'refused', reason: outcome };
  }
  await db`INSERT INTO sync_ops (op_id, op, result) VALUES (${opId}, ${JSON.stringify(op)}, 'applied') ON CONFLICT DO NOTHING`;
  return { opId, result: 'applied', reason: null };
}

function newLineId(): string {
  return `ln${Math.random().toString(36).slice(2, 12)}`;
}

async function nextPositionTx(tx: Tx, listId: string): Promise<number> {
  const rows = await tx`SELECT COALESCE(MAX(position), 0) AS max FROM lines WHERE list_id = ${listId}`;
  return Number(rows[0]?.max ?? 0) + 1;
}

/** The pack-sheet HTML document, sized to the hiker's paper. */
export function packSheetHtml(list: ListRow, lines: readonly LineRow[], stock: ReadonlyMap<string, ItemRow>, profile: HikerProfileRow): string {
  const derived = deriveForList(list, lines, stock, profile.goalGrams, profile.unit);
  const byCategory = new Map<string, (typeof derived.lines)[number][]>();
  for (const line of derived.lines) {
    if (!line.inCloset) continue;
    const group = byCategory.get(line.category) ?? [];
    group.push(line);
    byCategory.set(line.category, group);
  }
  const body = [...byCategory.entries()]
    .sort((a, b) => categoryOrder(a[0]) - categoryOrder(b[0]))
    .map(([category, group]) => {
      const subtotal = group.reduce((sum, line) => sum + line.lineWeightGrams, 0);
      const rowsHtml = group
        .map((line) => {
          const note = line.carryNote === '' ? '' : `<span class="note">${escapeHtml(line.carryNote)}</span>`;
          return `<tr><td class="box"></td><td>${line.quantity} × ${escapeHtml(line.name)} ${note}</td><td class="num">${escapeHtml(formatWeight(line.lineWeightGrams, profile.unit))}</td></tr>`;
        })
        .join('');
      return `<h2>${escapeHtml(category)} ${escapeHtml(formatWeight(subtotal, profile.unit))}</h2><table>${rowsHtml}</table>`;
    })
    .join('');
  const totals = derived.totals;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pack sheet</title><style>
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1f1a; margin: 0; }
  h1 { font-size: 22pt; margin: 0 0 2pt; }
  .who { font-size: 11pt; color: #333; margin: 0 0 10pt; }
  h2 { font-size: 12pt; margin: 10pt 0 3pt; border-bottom: 0.6pt solid #444; }
  table { width: 100%; border-collapse: collapse; font-size: 11pt; }
  td { padding: 2pt 4pt; vertical-align: top; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  .box { width: 12pt; }
  td.box { border: 0.6pt solid #444; width: 11pt; height: 11pt; }
  .note { color: #444; margin-left: 4pt; }
  .totals { margin-top: 12pt; font-size: 11pt; }
  .totals td { padding: 1pt 4pt; }
  </style></head><body>
  <h1>${escapeHtml(list.name)}</h1>
  <p class="who">Pack sheet — ${escapeHtml(profile.displayName)} — ${escapeHtml(list.state)}</p>
  ${body}
  <table class="totals">
  <tr><td>Base</td><td class="num">${escapeHtml(totals.display.base)}</td></tr>
  <tr><td>Worn</td><td class="num">${escapeHtml(totals.display.worn)}</td></tr>
  <tr><td>Consumable</td><td class="num">${escapeHtml(totals.display.consumable)}</td></tr>
  <tr><td>Skin-out</td><td class="num">${escapeHtml(totals.display.skinOut)}</td></tr>
  <tr><td>Goal</td><td class="num">${escapeHtml(totals.display.goal)}</td></tr>
  <tr><td>${escapeHtml(goalDeltaText(profile.goalGrams, totals.baseGrams, profile.unit))}</td><td class="num"></td></tr>
  </table>
  </body></html>`;
}

function categoryOrder(category: string): number {
  const order = ['Shelter', 'Sleep', 'Pack', 'Kitchen', 'Water', 'Clothing', 'Electronics', 'Essentials', 'Hygiene', 'Food'];
  const index = order.indexOf(category);
  return index === -1 ? order.length : index;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/** The list answer the line, state, sheet and list routes share. */
export async function listAnswer(db: Db, id: string): Promise<{ list: Record<string, unknown> }> {
  const list = await readListRow(db, id);
  const profile = await readProfile(db);
  const [lines, stock] = await Promise.all([readLineRows(db, id), readItemsById(db)]);
  const derived = deriveForList(list, lines, stock, profile.goalGrams, profile.unit);
  return { list: listJson(list, derived) };
}

async function readListRow(db: Db, id: string): Promise<ListRow> {
  const rows = await db`SELECT id, name, state, created_at FROM lists WHERE id = ${id}`;
  const row = rows[0] as unknown as ListRow | undefined;
  if (row === undefined) throw notFound('list');
  return row;
}

async function readProfile(db: Db): Promise<HikerProfileRow> {
  const rows = await db`SELECT display_name, unit, goal_grams, time_zone, paper_size FROM hiker WHERE id = 1`;
  const row = rows[0];
  if (row === undefined) throw new ApiError(500, 'internal_error', 'Something went wrong. Try again.');
  return {
    displayName: row.display_name as string,
    unit: row.unit as DisplayUnit,
    goalGrams: Number(row.goal_grams),
    timeZone: row.time_zone as string,
    paperSize: row.paper_size as string,
  };
}

async function readLineRows(db: Db, listId: string): Promise<LineRow[]> {
  return (await db`SELECT id, list_id, item_id, quantity, mode, name, unit_weight_grams, position FROM lines WHERE list_id = ${listId} ORDER BY position ASC`) as unknown as LineRow[];
}

/** Frozen name and weight for a line, from the item or the line itself. */
export function lineFromRow(row: LineRow, state: ListState, stock: ReadonlyMap<string, ItemRow>): { id: string; itemId: string; name: string; category: Category; quantity: number; mode: CarryMode; unitWeightGrams: number } {
  const item = stock.get(row.item_id);
  if (state === 'planning' && item !== undefined) {
    return { id: row.id, itemId: row.item_id, name: item.name, category: item.category, quantity: row.quantity, mode: row.mode, unitWeightGrams: item.weight_grams };
  }
  return { id: row.id, itemId: row.item_id, name: row.name, category: (item?.category ?? 'Essentials') as Category, quantity: row.quantity, mode: row.mode, unitWeightGrams: row.unit_weight_grams };
}

export function sheetContentOf(content: SheetContent): string {
  void content;
  return '';
}

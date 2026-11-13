import { categoryRank, type Category } from '../shared/categories.js';
import { buildCategoryEntries, buildLine, buildTotals, type LineFacts } from '../shared/lines.js';
import type {
  CarryMode,
  Item,
  ItemStatus,
  ListState,
  ListSummary,
  PaperSize,
  Profile,
  TripList,
} from '../shared/types.js';
import { formatGrams, type DisplayUnit } from '../shared/weights.js';
import type { Db } from './db.js';
import { pool } from './db.js';

export interface ProfileRow {
  display_name: string;
  unit: DisplayUnit;
  goal_grams: number;
  time_zone: string;
  paper_size: PaperSize;
  passphrase_hash: string;
}

export interface ItemRow {
  id: string;
  name: string;
  normalised_name: string;
  category: Category;
  weight_grams: number;
  units_owned: number;
  status: ItemStatus;
  price_cents: number | null;
  notes: string;
  version: number;
  photo_id: string | null;
}

export interface LineRow {
  id: string;
  list_id: string;
  item_id: string;
  quantity: number;
  mode: CarryMode;
  frozen_name: string | null;
  frozen_weight_grams: number | null;
  item_name: string;
  item_category: Category;
  item_weight_grams: number;
  units_owned: number;
}

export interface ListRow {
  id: string;
  name: string;
  state: ListState;
}

export async function loadProfileRow(db: Db = pool): Promise<ProfileRow> {
  const result = await db.query<ProfileRow>('SELECT * FROM profile WHERE only_row');
  const row = result.rows[0];
  if (row === undefined) throw new Error('profile missing');
  return row;
}

export function profileJson(row: ProfileRow): Profile {
  return {
    displayName: row.display_name,
    unit: row.unit,
    goalGrams: row.goal_grams,
    goalDisplay: formatGrams(row.goal_grams, row.unit),
    timeZone: row.time_zone,
    paperSize: row.paper_size,
  };
}

async function packedInCounts(db: Db): Promise<Map<string, number>> {
  const result = await db.query<{ item_id: string; count: string }>(
    `SELECT l.item_id, COUNT(*)::text AS count
       FROM lines l
       JOIN trip_lists t ON t.id = l.list_id
       JOIN items i ON i.id = l.item_id
      WHERE t.state IN ('planning', 'packed') AND l.quantity <= i.units_owned
      GROUP BY l.item_id`,
  );
  return new Map(result.rows.map((row) => [row.item_id, Number(row.count)]));
}

export function itemJson(
  row: ItemRow,
  unit: DisplayUnit,
  packedInLists: number,
  photoId: string | null,
): Item {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    weightGrams: row.weight_grams,
    weightDisplay: formatGrams(row.weight_grams, unit),
    unitsOwned: row.units_owned,
    status: row.status,
    priceCents: row.price_cents,
    notes: row.notes,
    photo:
      photoId === null
        ? null
        : { id: photoId, status: 'ready', url: `/api/photos/${photoId}` },
    packedInLists,
    version: row.version,
  };
}

export async function loadItems(db: Db, profile: ProfileRow): Promise<Item[]> {
  const counts = await packedInCounts(db);
  const result = await db.query<ItemRow>(
    `SELECT * FROM items ORDER BY (status = 'retired'), seq`,
  );
  return result.rows.map((row) => itemJson(row, profile.unit, counts.get(row.id) ?? 0, row.photo_id));
}

export async function loadItemRow(db: Db, id: string): Promise<ItemRow | null> {
  if (!isUuid(id)) return null;
  const result = await db.query<ItemRow>('SELECT * FROM items WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function loadItemJson(
  db: Db,
  profile: ProfileRow,
  id: string,
): Promise<Item | null> {
  const row = await loadItemRow(db, id);
  if (row === null) return null;
  const counts = await packedInCounts(db);
  return itemJson(row, profile.unit, counts.get(row.id) ?? 0, row.photo_id);
}

export async function loadListRow(db: Db, id: string): Promise<ListRow | null> {
  if (!isUuid(id)) return null;
  const result = await db.query<ListRow>(
    'SELECT id, name, state FROM trip_lists WHERE id = $1',
    [id],
  );
  return result.rows[0] ?? null;
}

export async function loadLineRows(db: Db, listId: string): Promise<LineRow[]> {
  const result = await db.query<LineRow>(
    `SELECT l.id, l.list_id, l.item_id, l.quantity, l.mode, l.frozen_name, l.frozen_weight_grams,
            i.name AS item_name, i.category AS item_category, i.weight_grams AS item_weight_grams,
            i.units_owned
       FROM lines l JOIN items i ON i.id = l.item_id
      WHERE l.list_id = $1
      ORDER BY l.seq`,
    [listId],
  );
  return result.rows;
}

/** The frozen-line rule: packed and walked lines keep what they were packed with. */
export function lineFacts(row: LineRow, state: ListState): LineFacts {
  const frozen = state !== 'planning' && row.frozen_name !== null && row.frozen_weight_grams !== null;
  return {
    id: row.id,
    itemId: row.item_id,
    name: frozen ? (row.frozen_name as string) : row.item_name,
    category: row.item_category,
    quantity: row.quantity,
    mode: row.mode,
    unitWeightGrams: frozen ? (row.frozen_weight_grams as number) : row.item_weight_grams,
    unitsOwned: row.units_owned,
  };
}

export function buildTripList(
  listRow: ListRow,
  lineRows: LineRow[],
  profile: ProfileRow,
): TripList {
  const lines = lineRows
    .map((row) => buildLine(lineFacts(row, listRow.state), listRow.state, profile.unit))
    .sort((a, b) => categoryRank(a.category) - categoryRank(b.category));
  return {
    id: listRow.id,
    name: listRow.name,
    state: listRow.state,
    lines,
    categories: buildCategoryEntries(lines, profile.unit),
    totals: buildTotals(lines, profile.goal_grams, profile.unit),
  };
}

export async function loadList(
  db: Db,
  profile: ProfileRow,
  id: string,
): Promise<TripList | null> {
  const listRow = await loadListRow(db, id);
  if (listRow === null) return null;
  return buildTripList(listRow, await loadLineRows(db, id), profile);
}

export function listSummary(list: TripList): ListSummary {
  return { id: list.id, name: list.name, state: list.state, totals: list.totals };
}

export async function loadListSummaries(db: Db, profile: ProfileRow): Promise<ListSummary[]> {
  const lists = await db.query<ListRow & { seq: string }>(
    'SELECT id, name, state, seq FROM trip_lists ORDER BY seq DESC',
  );
  const summaries: ListSummary[] = [];
  for (const row of lists.rows) {
    summaries.push(listSummary(buildTripList(row, await loadLineRows(db, row.id), profile)));
  }
  return summaries;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

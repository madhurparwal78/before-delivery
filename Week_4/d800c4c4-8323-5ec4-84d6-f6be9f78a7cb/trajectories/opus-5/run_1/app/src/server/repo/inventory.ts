import type {
  BoardRead,
  Hold,
  HoldStatus,
  Item,
  LoanStatus,
  Part,
  PartShape,
  PartState,
} from '../../shared/types';
import { BOARD_COLUMNS, boardRows, countParts, itemStatusOf } from '../domain/board';
import { formatInstant, type LibraryDate } from '../../shared/time';
import type { Db } from './calendar';

interface PartRow {
  id: number;
  item_id: number;
  name: string;
  shape: PartShape;
  grid_col: number;
  grid_row: number;
  width: number;
  height: number;
  state: PartState;
}

interface ItemRow {
  id: number;
  tag: string;
  name: string;
  replacement_cost_cents: number;
  open_loan_status: LoanStatus | null;
  open_loan_due_date: LibraryDate | null;
  hold_queue_length: number;
  ready_holds: number;
}

const ITEM_SELECT = `
  select i.id, i.tag, i.name, i.replacement_cost_cents,
    (select l.status from loan_items li join loans l on l.id = li.loan_id
      where li.item_id = i.id and l.status in ('reserved', 'out', 'pending-photo')
      order by l.id desc limit 1) as open_loan_status,
    (select l.due_date from loan_items li join loans l on l.id = li.loan_id
      where li.item_id = i.id and l.status in ('out', 'pending-photo')
      order by l.id desc limit 1) as open_loan_due_date,
    (select count(*)::int from holds h where h.item_id = i.id
      and h.status in ('queued', 'ready')) as hold_queue_length,
    (select count(*)::int from holds h where h.item_id = i.id
      and h.status = 'ready') as ready_holds
  from items i`;

function partView(row: PartRow): Part {
  return {
    id: row.id,
    item_id: row.item_id,
    name: row.name,
    shape: row.shape,
    col: row.grid_col,
    row: row.grid_row,
    width: row.width,
    height: row.height,
    state: row.state,
  };
}

async function readPartRows(db: Db, itemId?: number): Promise<PartRow[]> {
  const rows = itemId
    ? await db.query<PartRow>(
        `select id, item_id, name, shape, grid_col, grid_row, width, height, state
         from parts where item_id = $1 order by grid_row, grid_col`,
        [itemId],
      )
    : await db.query<PartRow>(
        `select id, item_id, name, shape, grid_col, grid_row, width, height, state
         from parts order by grid_row, grid_col`,
      );
  return rows.rows;
}

function buildItem(row: ItemRow, parts: Part[]): Item {
  const status = itemStatusOf({
    partStates: parts.map((part) => part.state),
    openLoanStatus: row.open_loan_status,
    hasReadyHold: row.ready_holds > 0,
  });
  return {
    id: row.id,
    tag: row.tag,
    name: row.name,
    replacement_cost_cents: row.replacement_cost_cents,
    status,
    due_date: status === 'out' || status === 'pending-photo' ? row.open_loan_due_date : null,
    hold_queue_length: row.hold_queue_length,
    parts,
  };
}

export async function readBoard(db: Db): Promise<BoardRead> {
  const itemRows = await db.query<ItemRow>(`${ITEM_SELECT} order by i.id`);
  const partRows = await readPartRows(db);
  const byItem = new Map<number, Part[]>();
  for (const row of partRows) {
    const list = byItem.get(row.item_id) ?? [];
    list.push(partView(row));
    byItem.set(row.item_id, list);
  }
  return {
    counts: countParts(partRows.map((row) => row.state)),
    columns: BOARD_COLUMNS,
    rows: boardRows(
      partRows.map((row) => ({
        col: row.grid_col,
        row: row.grid_row,
        width: row.width,
        height: row.height,
      })),
    ),
    items: itemRows.rows.map((row) => buildItem(row, byItem.get(row.id) ?? [])),
  };
}

export async function readCounts(db: Db): Promise<BoardRead['counts']> {
  const rows = await db.query<{ state: PartState }>('select state from parts');
  return countParts(rows.rows.map((row) => row.state));
}

export async function readItem(db: Db, id: number): Promise<Item | null> {
  const rows = await db.query<ItemRow>(`${ITEM_SELECT} where i.id = $1`, [id]);
  const row = rows.rows[0];
  if (!row) return null;
  const parts = (await readPartRows(db, id)).map(partView);
  return buildItem(row, parts);
}

export async function insertItem(
  db: Db,
  tag: string,
  name: string,
  replacementCostCents: number,
): Promise<number> {
  const rows = await db.query<{ id: number }>(
    'insert into items (tag, name, replacement_cost_cents) values ($1, $2, $3) returning id',
    [tag, name, replacementCostCents],
  );
  return rows.rows[0]?.id as number;
}

export async function insertPart(
  db: Db,
  itemId: number,
  part: {
    name: string;
    shape: PartShape;
    col: number;
    row: number;
    width: number;
    height: number;
    listedAt: number;
  },
): Promise<void> {
  await db.query(
    `insert into parts (item_id, name, shape, grid_col, grid_row, width, height, state, listed_at)
     values ($1, $2, $3, $4, $5, $6, $7, 'hung', $8)`,
    [itemId, part.name, part.shape, part.col, part.row, part.width, part.height, part.listedAt],
  );
}

export async function updateItem(
  db: Db,
  id: number,
  changes: { name?: string; replacementCostCents?: number },
): Promise<void> {
  if (changes.name !== undefined) {
    await db.query('update items set name = $2 where id = $1', [id, changes.name]);
  }
  if (changes.replacementCostCents !== undefined) {
    await db.query('update items set replacement_cost_cents = $2 where id = $1', [
      id,
      changes.replacementCostCents,
    ]);
  }
}

export async function takenPlacements(
  db: Db,
): Promise<{ col: number; row: number; width: number; height: number }[]> {
  const rows = await db.query<{ col: number; row: number; width: number; height: number }>(
    'select grid_col as col, grid_row as row, width, height from parts',
  );
  return rows.rows;
}

export async function setPartState(db: Db, partId: number, state: PartState): Promise<void> {
  await db.query('update parts set state = $2 where id = $1', [partId, state]);
}

export async function setItemPartsState(
  db: Db,
  itemIds: readonly number[],
  state: PartState,
): Promise<void> {
  await db.query('update parts set state = $2 where item_id = any($1::int[])', [
    [...itemIds],
    state,
  ]);
}

interface HoldRow {
  id: number;
  item_id: number;
  member_id: number;
  status: HoldStatus;
  placed_at: Date;
}

/** Queued holds are numbered 1 to n on every read, in `placed_at` order, ties by id. */
function withPositions(rows: readonly HoldRow[], queueByItem: Map<number, number[]>, zone: string): Hold[] {
  return rows.map((row) => {
    const queue = queueByItem.get(row.item_id) ?? [];
    const index = queue.indexOf(row.id);
    return {
      id: row.id,
      item_id: row.item_id,
      member_id: row.member_id,
      status: row.status,
      position: row.status === 'queued' && index >= 0 ? index + 1 : null,
      placed_at: formatInstant(row.placed_at, zone),
    };
  });
}

async function queueOrder(db: Db, itemIds: readonly number[]): Promise<Map<number, number[]>> {
  const rows = await db.query<{ id: number; item_id: number }>(
    `select id, item_id from holds where item_id = any($1::int[]) and status = 'queued'
     order by placed_at, id`,
    [[...itemIds]],
  );
  const queues = new Map<number, number[]>();
  for (const row of rows.rows) {
    const list = queues.get(row.item_id) ?? [];
    list.push(row.id);
    queues.set(row.item_id, list);
  }
  return queues;
}

const HOLD_SELECT = 'select id, item_id, member_id, status, placed_at from holds';

export async function readHolds(
  db: Db,
  filter: { memberId?: number; itemId?: number },
  zone: string,
): Promise<Hold[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.memberId !== undefined) {
    params.push(filter.memberId);
    clauses.push(`member_id = $${params.length}`);
  }
  if (filter.itemId !== undefined) {
    params.push(filter.itemId);
    clauses.push(`item_id = $${params.length}`);
  }
  const where = clauses.length > 0 ? ` where ${clauses.join(' and ')}` : '';
  const rows = await db.query<HoldRow>(`${HOLD_SELECT}${where} order by id`, params);
  const queues = await queueOrder(db, [...new Set(rows.rows.map((row) => row.item_id))]);
  return withPositions(rows.rows, queues, zone);
}

export async function readHold(db: Db, id: number, zone: string): Promise<Hold | null> {
  const rows = await db.query<HoldRow>(`${HOLD_SELECT} where id = $1`, [id]);
  const row = rows.rows[0];
  if (!row) return null;
  const queues = await queueOrder(db, [row.item_id]);
  return withPositions([row], queues, zone)[0] ?? null;
}

export async function insertHold(db: Db, itemId: number, memberId: number): Promise<number> {
  const rows = await db.query<{ id: number }>(
    "insert into holds (item_id, member_id, status) values ($1, $2, 'queued') returning id",
    [itemId, memberId],
  );
  return rows.rows[0]?.id as number;
}

export async function setHoldStatus(db: Db, id: number, status: HoldStatus): Promise<void> {
  await db.query('update holds set status = $2 where id = $1', [id, status]);
}

export async function lockItems(db: Db, itemIds: readonly number[]): Promise<void> {
  await db.query('select id from items where id = any($1::int[]) order by id for update', [
    [...itemIds],
  ]);
}

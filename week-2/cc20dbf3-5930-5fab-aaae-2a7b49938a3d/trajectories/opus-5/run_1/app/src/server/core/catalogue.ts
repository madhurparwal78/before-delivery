import { localDateOf, type LocalDate } from '../../domain/calendar.js';
import type { OccupyingSpan } from '../../domain/occupancy.js';
import type { Queryable } from '../db/queryable.js';
import type { LibrarySettings } from './library.js';

export interface ItemRecord {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly depositCents: number;
  readonly replacementCents: number;
}

export interface UnitRecord {
  readonly id: string;
  readonly itemId: string;
  readonly label: string;
  readonly laneIndex: number;
}

interface ItemRow {
  id: string;
  name: string;
  category: string;
  deposit_cents: number;
  replacement_cents: number;
}

interface UnitRow {
  id: string;
  item_id: string;
  label: string;
  lane_index: number;
}

interface HoldSpanRow {
  id: string;
  item_id: string;
  unit_id: string;
  lane_index: number;
  member_id: string;
  member_name: string;
  start_date: LocalDate;
  end_date: LocalDate;
}

interface LoanSpanRow {
  id: string;
  item_id: string;
  unit_id: string;
  lane_index: number;
  member_id: string;
  member_name: string;
  checked_out_at: Date;
  due_date: LocalDate;
  due_at: Date;
}

export async function listItems(db: Queryable): Promise<ItemRecord[]> {
  const result = await db.query<ItemRow>(
    `select id, name, category, deposit_cents, replacement_cents from item order by seed_order asc`,
  );
  return result.rows.map(toItem);
}

export async function findItem(db: Queryable, itemId: string): Promise<ItemRecord | null> {
  const result = await db.query<ItemRow>(
    `select id, name, category, deposit_cents, replacement_cents from item where id = $1`,
    [itemId],
  );
  const row = result.rows[0];
  return row === undefined ? null : toItem(row);
}

function toItem(row: ItemRow): ItemRecord {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    depositCents: row.deposit_cents,
    replacementCents: row.replacement_cents,
  };
}

export async function listUnits(db: Queryable, itemId?: string): Promise<UnitRecord[]> {
  const result =
    itemId === undefined
      ? await db.query<UnitRow>(
          `select unit.id, unit.item_id, unit.label, unit.lane_index
           from unit join item on item.id = unit.item_id
           order by item.seed_order asc, unit.lane_index asc`,
        )
      : await db.query<UnitRow>(
          `select id, item_id, label, lane_index from unit where item_id = $1 order by lane_index asc`,
          [itemId],
        );
  return result.rows.map((row) => ({
    id: row.id,
    itemId: row.item_id,
    label: row.label,
    laneIndex: row.lane_index,
  }));
}

export async function findUnit(db: Queryable, unitId: string): Promise<UnitRecord | null> {
  const result = await db.query<UnitRow>(
    `select id, item_id, label, lane_index from unit where id = $1`,
    [unitId],
  );
  const row = result.rows[0];
  return row === undefined
    ? null
    : { id: row.id, itemId: row.item_id, label: row.label, laneIndex: row.lane_index };
}

/**
 * Every span that occupies a unit right now: active holds and loans that are out.
 * `itemId` narrows the read to one item; the catalogue reads them all at once.
 */
export async function loadOccupyingSpans(
  db: Queryable,
  library: LibrarySettings,
  now: Date,
  itemId?: string,
): Promise<Map<string, OccupyingSpan[]>> {
  const filter = itemId === undefined ? '' : ' and h.item_id = $2';
  const parameters: unknown[] = itemId === undefined ? [now] : [now, itemId];
  const holds = await db.query<HoldSpanRow>(
    `select h.id, h.item_id, h.unit_id, u.lane_index, h.member_id, p.name as member_name,
            h.start_date, h.end_date
     from hold h
     join unit u on u.id = h.unit_id
     join person p on p.id = h.member_id
     where (h.status = 'requested' or (h.status = 'ready' and h.pickup_deadline > $1))${filter}`,
    parameters,
  );
  const loanFilter = itemId === undefined ? '' : ' and l.item_id = $1';
  const loans = await db.query<LoanSpanRow>(
    `select l.id, l.item_id, l.unit_id, u.lane_index, l.member_id, p.name as member_name,
            l.checked_out_at, l.due_date, l.due_at
     from loan l
     join unit u on u.id = l.unit_id
     join person p on p.id = l.member_id
     where l.status = 'out'${loanFilter}`,
    itemId === undefined ? [] : [itemId],
  );

  const todayDate = localDateOf(library.calendar, now);
  const byItem = new Map<string, OccupyingSpan[]>();
  const push = (key: string, span: OccupyingSpan): void => {
    const list = byItem.get(key);
    if (list === undefined) byItem.set(key, [span]);
    else list.push(span);
  };

  for (const row of holds.rows) {
    push(row.item_id, {
      recordType: 'hold',
      recordId: row.id,
      unitId: row.unit_id,
      laneIndex: row.lane_index,
      memberId: row.member_id,
      memberName: row.member_name,
      status: 'held',
      startDate: row.start_date,
      endDate: row.end_date,
      occupiedFrom: row.start_date,
      occupiedTo: row.end_date,
    });
  }

  for (const row of loans.rows) {
    const overdue = now.getTime() > row.due_at.getTime();
    const startDate = localDateOf(library.calendar, row.checked_out_at);
    const endDate = overdue ? todayDate : row.due_date;
    push(row.item_id, {
      recordType: 'loan',
      recordId: row.id,
      unitId: row.unit_id,
      laneIndex: row.lane_index,
      memberId: row.member_id,
      memberName: row.member_name,
      status: overdue ? 'overdue' : 'out',
      startDate,
      endDate,
      occupiedFrom: startDate,
      occupiedTo: endDate < startDate ? startDate : endDate,
    });
  }

  return byItem;
}

export function spansFor(byItem: Map<string, OccupyingSpan[]>, itemId: string): OccupyingSpan[] {
  return byItem.get(itemId) ?? [];
}

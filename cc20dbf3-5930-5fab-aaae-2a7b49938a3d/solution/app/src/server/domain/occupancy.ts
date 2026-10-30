// Occupancy: which days each unit is taken, and the one free-unit check every claim uses.
// A unit is busy on a date when an active span covers it (both ends included); it is free for a range
// when it is busy on none of the range's dates.

import type { Item, Lane, Lanes, Span, SpanStatus, Unit, User } from "../../shared/api.js";
import { addDays, localDate, nextOpenDayAfter } from "../../shared/calendar.js";
import type { Db } from "../db.js";
import { library, today } from "./library.js";
import { holdStatusSql, loanStatusSql } from "./status.js";

type Queryable = Pick<Db, "query">;

const LANE_DAYS = 28;

interface ActiveSpan {
  unitId: string;
  memberId: string;
  memberName: string;
  record: { type: "hold" | "loan"; id: string };
  start: string;
  end: string;
  status: SpanStatus;
}

interface UnitRow extends Unit {
  item_id: string;
}

/** A loan's span: from the local date of checkout to its due date, or to today while it is overdue. */
export function loanSpan(checkedOutAt: Date, dueDate: string, overdue: boolean, now: Date): { start: string; end: string } {
  return { start: localDate(checkedOutAt, library().calendar.timeZone), end: overdue ? today(now) : dueDate };
}

export async function activeSpans(db: Queryable, now: Date, itemIds: readonly string[]): Promise<ActiveSpan[]> {
  const holds = await db.query<{ id: string; unit_id: string; member_id: string; name: string; start_date: string; end_date: string }>(
    `SELECT h.id, h.unit_id, h.member_id, m.name, h.start_date, h.end_date
     FROM hold h JOIN person m ON m.id = h.member_id
     WHERE h.item_id = ANY($2) AND h.status IN ('requested', 'ready') AND ${holdStatusSql()} IN ('requested', 'ready')`,
    [now, itemIds],
  );
  const loans = await db.query<{ id: string; unit_id: string; member_id: string; name: string; checked_out_at: Date; due_date: string; status: "out" | "overdue" }>(
    `SELECT l.id, l.unit_id, l.member_id, m.name, l.checked_out_at, l.due_date, ${loanStatusSql()} AS status
     FROM loan l JOIN person m ON m.id = l.member_id
     WHERE l.item_id = ANY($2) AND l.status = 'out'`,
    [now, itemIds],
  );
  return [
    ...holds.rows.map((h): ActiveSpan => ({
      unitId: h.unit_id,
      memberId: h.member_id,
      memberName: h.name,
      record: { type: "hold", id: h.id },
      start: h.start_date,
      end: h.end_date,
      status: "held",
    })),
    ...loans.rows.map((l): ActiveSpan => ({
      unitId: l.unit_id,
      memberId: l.member_id,
      memberName: l.name,
      record: { type: "loan", id: l.id },
      ...loanSpan(l.checked_out_at, l.due_date, l.status === "overdue", now),
      status: l.status,
    })),
  ];
}

export function isUnitFree(spans: readonly ActiveSpan[], unitId: string, start: string, end: string, ignoreRecordId?: string): boolean {
  return !spans.some((s) => s.unitId === unitId && s.record.id !== ignoreRecordId && s.start <= end && start <= s.end);
}

export function freeUnits<U extends Unit>(units: readonly U[], spans: readonly ActiveSpan[], start: string, end: string): U[] {
  return units.filter((unit) => isUnitFree(spans, unit.id, start, end)).sort((a, b) => a.lane_index - b.lane_index);
}

export async function unitsOf(db: Queryable, itemIds: readonly string[]): Promise<UnitRow[]> {
  const found = await db.query<UnitRow>(
    "SELECT id, item_id, label, lane_index FROM unit WHERE item_id = ANY($1) ORDER BY item_id, lane_index",
    [itemIds],
  );
  return found.rows;
}

interface ItemRow {
  id: string;
  name: string;
  category: string;
  deposit_cents: number;
  replacement_cents: number;
}

/** Items in seed order with their units free today. */
export async function itemsWithFreeToday(db: Queryable, now: Date, itemId?: string): Promise<Item[]> {
  const found = await db.query<ItemRow>(
    `SELECT id, name, category, deposit_cents, replacement_cents FROM item
     WHERE $1::text IS NULL OR id = $1 ORDER BY position`,
    [itemId ?? null],
  );
  const ids = found.rows.map((row) => row.id);
  const units = await unitsOf(db, ids);
  const spans = await activeSpans(db, now, ids);
  const day = today(now);
  return found.rows.map((row) => {
    const own = units.filter((unit) => unit.item_id === row.id);
    return { ...row, unit_count: own.length, units_free_today: freeUnits(own, spans, day, day).length };
  });
}

/** The span as the caller may see it: members get when and whether it is theirs; staff add who and which record. */
function spanJson(span: ActiveSpan, user: User): Span {
  const shared: Span = {
    start_date: span.start,
    end_date: span.end,
    status: span.status,
    back_on: span.status === "overdue" ? null : nextOpenDayAfter(library().calendar, span.end),
    mine: span.memberId === user.id,
  };
  return user.role === "member" ? shared : { ...shared, borrower: { name: span.memberName }, record: span.record };
}

export async function lanes(
  db: Queryable,
  now: Date,
  user: User,
  itemId: string,
  from: string,
  range: { start: string; end: string } | null,
): Promise<Lanes> {
  const to = addDays(from, LANE_DAYS - 1);
  const units = await unitsOf(db, [itemId]);
  const spans = await activeSpans(db, now, [itemId]);
  const laneList: Lane[] = units.map((unit) => ({
    lane_index: unit.lane_index,
    unit_id: unit.id,
    label: unit.label,
    busy_for_range: range ? !isUnitFree(spans, unit.id, range.start, range.end) : null,
    spans: spans
      .filter((s) => s.unitId === unit.id && s.start <= to && from <= s.end)
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((s) => spanJson(s, user)),
  }));
  return {
    item_id: itemId,
    from,
    to,
    unit_count: units.length,
    units_free: range ? freeUnits(units, spans, range.start, range.end).length : null,
    lanes: laneList,
  };
}

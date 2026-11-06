import { PoolClient } from "pg";

export type SpanStatus = "held" | "out" | "overdue";

export type UnitRow = {
  id: string;
  label: string;
  lane_index: number;
  item_id?: string;
};

export interface BusySpanRecord {
  unit_id: string;
  start_date: string;
  end_date: string;
  status: SpanStatus;
  member_id: string;
  member_name: string;
  record_type: "hold" | "loan";
  record_id: string;
}

/**
 * The one occupancy definition: which dates a unit's active spans cover.
 * A hold is active while requested, or ready and before its pickup deadline.
 * A loan is active while out or overdue; an overdue loan's span runs to today.
 * Due instants are judged in library time using the seeded zone and closing time.
 */
const ACTIVE_SPANS_SQL = `
  WITH lib AS (SELECT time_zone AS zone, closing_time FROM library WHERE id = 'library')
  SELECT h.unit_id, h.start_date::text AS start_date, h.end_date::text AS end_date,
         'held' AS status, h.member_id, u.name AS member_name, 'hold' AS record_type, h.id::text AS record_id
    FROM holds h JOIN users u ON u.id = h.member_id
   WHERE (h.status = 'requested' OR (h.status = 'ready' AND h.pickup_deadline > now()))
  UNION ALL
  SELECT l.unit_id,
         (l.checked_out_at AT TIME ZONE lib.zone)::date::text AS start_date,
         CASE WHEN now() > ((l.due_date::text || ' ' || lib.closing_time)::timestamp AT TIME ZONE lib.zone)
              THEN (now() AT TIME ZONE lib.zone)::date::text
              ELSE l.due_date::text END AS end_date,
         CASE WHEN now() > ((l.due_date::text || ' ' || lib.closing_time)::timestamp AT TIME ZONE lib.zone)
              THEN 'overdue' ELSE 'out' END AS status,
         l.member_id, u.name AS member_name, 'loan' AS record_type, l.id::text AS record_id
    FROM loans l JOIN users u ON u.id = l.member_id CROSS JOIN lib
   WHERE l.status = 'out'
`;

export async function activeSpansForItem(client: PoolClient, itemId: string): Promise<BusySpanRecord[]> {
  const rows = await activeSpansAll(client);
  const units = (await client.query("SELECT id FROM units WHERE item_id = $1", [itemId])).rows as { id: string }[];
  const unitIds = new Set(units.map((unit) => unit.id));
  return rows.filter((row) => unitIds.has(row.unit_id));
}

export async function activeSpansAll(client: PoolClient): Promise<BusySpanRecord[]> {
  const result = await client.query(ACTIVE_SPANS_SQL);
  return result.rows as BusySpanRecord[];
}

/** A date is busy when an active span covers it, ranges including both ends. */
export function isBusyOn(spans: readonly BusySpanRecord[], date: string): boolean {
  return spans.some((span) => span.start_date <= date && date <= span.end_date);
}

function addOneDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const result = new Date(Date.UTC(y, m - 1, d + 1));
  return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, "0")}-${String(result.getUTCDate()).padStart(2, "0")}`;
}

/** A unit is free for a range when it is busy on none of the range's dates. */
export function isFreeForRange(spans: readonly BusySpanRecord[], from: string, to: string): boolean {
  let cursor = from;
  // Ranges are at most 28 days; the bound guards against malformed input.
  for (let i = 0; i < 60 && cursor <= to; i++) {
    if (isBusyOn(spans, cursor)) return false;
    cursor = addOneDay(cursor);
  }
  return true;
}

/** The lowest-lane unit free on every day of the range, or null. */
export function lowestFreeUnit(
  units: readonly UnitRow[],
  spans: readonly BusySpanRecord[],
  from: string,
  to: string,
): UnitRow | null {
  const ordered = [...units].sort((a, b) => a.lane_index - b.lane_index);
  for (const unit of ordered) {
    if (isFreeForRange(spans.filter((s) => s.unit_id === unit.id), from, to)) return unit;
  }
  return null;
}

/** How many of the item's units are free on every day of the range. */
export function countFreeForRange(
  units: readonly UnitRow[],
  spans: readonly BusySpanRecord[],
  from: string,
  to: string,
): number {
  let count = 0;
  for (const unit of units) {
    if (isFreeForRange(spans.filter((s) => s.unit_id === unit.id), from, to)) count++;
  }
  return count;
}

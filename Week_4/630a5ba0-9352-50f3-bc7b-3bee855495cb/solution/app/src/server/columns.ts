import type { Db } from "./db.js";

// A column is the member's tasks sharing one dayDate (or none, the Backlog). Positions are 0-based
// and the server renumbers the rest of the column on every move.

async function columnIds(db: Db, memberId: string, dayDate: string | null, except: string[]): Promise<string[]> {
  const rows = await db<{ id: string }[]>`
    SELECT id FROM tasks
    WHERE member_id = ${memberId} AND day_date IS NOT DISTINCT FROM ${dayDate}::date AND NOT (id = ANY(${except}::uuid[]))
    ORDER BY position, created_at`;
  return rows.map((r) => r.id);
}

async function renumber(db: Db, ordered: string[]): Promise<void> {
  if (ordered.length === 0) return;
  await db`
    UPDATE tasks t SET position = v.ord - 1
    FROM unnest(${ordered}::uuid[]) WITH ORDINALITY AS v(id, ord)
    WHERE t.id = v.id AND t.position <> v.ord - 1`;
}

/**
 * Puts tasks into a column at a position (end of the column when null), sets their dayDate, and
 * closes the gaps they leave behind in their previous columns.
 */
export async function place(
  db: Db,
  memberId: string,
  taskIds: string[],
  dayDate: string | null,
  position: number | null,
  leaving: (string | null)[] = [],
): Promise<void> {
  const others = await columnIds(db, memberId, dayDate, taskIds);
  const at = position === null ? others.length : Math.min(Math.max(position, 0), others.length);
  await db`UPDATE tasks SET day_date = ${dayDate}::date WHERE id = ANY(${taskIds}::uuid[])`;
  await renumber(db, [...others.slice(0, at), ...taskIds, ...others.slice(at)]);
  for (const previous of new Set(leaving)) {
    if (previous !== dayDate) await renumber(db, await columnIds(db, memberId, previous, []));
  }
}

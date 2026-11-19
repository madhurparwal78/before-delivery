import { SOMEONE } from "../shared/protocol.js";
import { query, type Db } from "./db.js";

/** Everyone with a block to or from the person: the pair stays in the room but is named Someone and hears nothing. */
export async function blockedWith(personId: string, db?: Db): Promise<Set<string>> {
  const rows = await query<{ id: string }>(
    "SELECT to_id AS id FROM blocks WHERE from_id = $1 UNION SELECT from_id FROM blocks WHERE to_id = $1",
    [personId],
    db,
  );
  return new Set(rows.map((row) => row.id));
}

/** How a viewer names people: the real name unless a block stands between them. */
export async function namesFor(viewerId: string, ids: string[]): Promise<Map<string, string>> {
  const [apart, rows] = await Promise.all([
    blockedWith(viewerId),
    query<{ id: string; display_name: string }>("SELECT id, display_name FROM people WHERE id = ANY($1)", [ids]),
  ]);
  return new Map(rows.map((row) => [row.id, apart.has(row.id) ? SOMEONE : row.display_name]));
}

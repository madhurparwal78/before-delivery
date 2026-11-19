/**
 * Keeping Meilisearch in step with Postgres. On start the index is built from
 * the database, whatever the engine holds, and the app keeps trying while the
 * engine is down.
 */
import type { App } from '../app.ts';
import {
  clientEntry,
  entryId,
  materialEntry,
  pieceEntry,
  SearchUnavailable,
  type SearchEntry,
} from '../services/search.ts';
import type { Row } from '../present.ts';

async function entriesForDesk(app: App, deskId: string): Promise<SearchEntry[]> {
  const entries: SearchEntry[] = [];
  const materials = await app.db.query<Row>(
    `SELECT code, name FROM materials WHERE desk_id = $1`,
    [deskId],
  );
  for (const row of materials) {
    entries.push(materialEntry(deskId, String(row.code), String(row.name)));
  }
  const clients = await app.db.query<Row>(
    `SELECT id, name FROM clients WHERE desk_id = $1 AND state IN ('active','closing')`,
    [deskId],
  );
  for (const row of clients) entries.push(clientEntry(deskId, String(row.id), String(row.name)));

  const pieces = await app.db.query<Row>(
    `SELECT p.id, p.title FROM pieces p JOIN clients c ON c.id = p.client_id
      WHERE p.desk_id = $1 AND c.state IN ('active','closing')`,
    [deskId],
  );
  for (const row of pieces) entries.push(pieceEntry(deskId, String(row.id), String(row.title)));
  return entries;
}

/** Writes one desk's entries. Returns false when the engine is unreachable. */
export async function indexDesk(app: App, deskId: string): Promise<boolean> {
  try {
    await app.search.put(await entriesForDesk(app, deskId));
    return true;
  } catch (error) {
    if (error instanceof SearchUnavailable) return false;
    throw error;
  }
}

/** Builds the whole index from the database. */
export async function rebuildIndex(app: App): Promise<boolean> {
  const desks = await app.db.query<Row>(`SELECT id FROM desks`);
  for (const desk of desks) {
    if (!(await indexDesk(app, String(desk.id)))) return false;
  }
  return true;
}

/** One entry written as part of an action; a failure is the caller's to read. */
export async function putEntries(app: App, entries: readonly SearchEntry[]): Promise<void> {
  await app.search.put(entries);
}

export async function removeEntries(app: App, ids: readonly string[]): Promise<void> {
  await app.search.remove(ids);
}

export { clientEntry, entryId, materialEntry, pieceEntry };

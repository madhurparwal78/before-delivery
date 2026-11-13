// External references: another drawing of the same workspace drawn into this one. A server-owned base command.
import { randomUUID } from 'node:crypto';
import { HttpError } from './http.ts';
import { isUuid, type Queryable } from './db.ts';
import type { CommandOutcome, DrawingModel } from './engine/types.ts';

const XREF_ARGS_INVALID = 'Check the external reference command.';

function stringField(args: unknown, key: string): string | null {
  if (typeof args !== 'object' || args === null) return null;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

function outcome(model: DrawingModel, changed: boolean): CommandOutcome {
  return { created: [], modified: [], erased: [], locked: [], history: null, changed, next: model, before: { objects: {} }, after: { objects: {} } };
}

async function attach(client: Queryable, drawingId: string, workspaceId: string, sourceId: string | null): Promise<void> {
  const source = isUuid(sourceId)
    ? await client.query('SELECT 1 FROM drawings WHERE id = $1 AND workspace_id = $2 AND id <> $3 AND deleted_at IS NULL', [sourceId, workspaceId, drawingId])
    : null;
  if (!source || source.rowCount === 0) throw new HttpError(404, { error: 'not_found' });
  await client.query(
    `INSERT INTO xrefs (id, drawing_id, source_drawing_id, loaded, position)
     VALUES ($1, $2, $3, true, COALESCE((SELECT MAX(position) + 1 FROM xrefs WHERE drawing_id = $2), 0))`,
    [randomUUID(), drawingId, sourceId]);
}

/** Loaded state a `reload` or `unload` leads to; returns whether the row changed. */
async function setLoaded(client: Queryable, drawingId: string, xrefId: string | null, loaded: boolean): Promise<boolean> {
  const found = isUuid(xrefId)
    ? await client.query<{ loaded: boolean }>('SELECT loaded FROM xrefs WHERE id = $1 AND drawing_id = $2 FOR UPDATE', [xrefId, drawingId])
    : null;
  const row = found?.rows[0];
  if (!row) throw new HttpError(404, { error: 'not_found' });
  if (row.loaded === loaded) return false;
  await client.query('UPDATE xrefs SET loaded = $2 WHERE id = $1', [xrefId, loaded]);
  return true;
}

async function detach(client: Queryable, drawingId: string, xrefId: string | null): Promise<void> {
  const removed = isUuid(xrefId)
    ? await client.query('DELETE FROM xrefs WHERE id = $1 AND drawing_id = $2', [xrefId, drawingId])
    : null;
  if (!removed || removed.rowCount === 0) throw new HttpError(404, { error: 'not_found' });
}

/** Applies `XREF` args inside the caller's transaction; a no-op reload or unload changes nothing. */
export async function applyXref(client: Queryable, drawingId: string, workspaceId: string, model: DrawingModel, args: unknown): Promise<CommandOutcome> {
  const op = stringField(args, 'op');
  if (op === 'attach') {
    await attach(client, drawingId, workspaceId, stringField(args, 'drawing_id'));
    return outcome(model, true);
  }
  if (op === 'unload' || op === 'reload') return outcome(model, await setLoaded(client, drawingId, stringField(args, 'xref_id'), op === 'reload'));
  if (op === 'detach') {
    await detach(client, drawingId, stringField(args, 'xref_id'));
    return outcome(model, true);
  }
  throw new HttpError(422, { errors: { args: XREF_ARGS_INVALID } });
}

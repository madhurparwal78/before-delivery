/**
 * The edit engine: one transaction per edit — the change, its recalculation,
 * its history entry and its idempotency record — plus undo stacks and the
 * recalculation response. One place applies edits, in one linear order.
 */
import { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { DocState } from './docstate.js';
import { Database } from './db.js';
import { recalculate, RecalcInput, RecalcResult } from './recalc.js';
import { Access, Person, viewFor } from './access.js';
import { View } from './docstate.js';
import { ApiError } from '../shared/errors.js';

export const UNDO_LIMIT = 50;

export type HistoryKind =
  | 'cell_write'
  | 'cell_batch'
  | 'row_add'
  | 'row_delete'
  | 'column_add'
  | 'column_update'
  | 'column_delete'
  | 'table_add'
  | 'table_rename'
  | 'summary_add'
  | 'access_update'
  | 'undo'
  | 'redo';

export type UndoKind =
  | 'cell_write'
  | 'cell_batch'
  | 'row_add'
  | 'row_delete'
  | 'column_add'
  | 'column_update'
  | 'column_delete'
  | 'table_rename';

export interface UndoEntry {
  id: string;
  seq: number;
  kind: UndoKind;
  data: Record<string, unknown>;
}

export interface EditOutcome {
  /** the operation's own response body, without the recalc object */
  body: Record<string, unknown>;
  status: number;
  historyKind: HistoryKind;
  historyTableId: string | null;
  seeds: Set<string>;
  directs: Set<string>;
  /** undo entry to push, or null when the edit is not undoable */
  undo: { kind: UndoKind; data: Record<string, unknown> } | null;
  /** tables created by this edit (always listed in counts) */
  newTableIds: string[];
  /** revisions this edit produced, for other entries' accept lists */
  touchedTargets: TouchedTarget[];
}

export interface TouchedTarget {
  kind: 'cell' | 'row' | 'column' | 'table';
  id: string;
  revision: number;
}

export interface RecalcResponse {
  cells: RecalcResult['cells'];
  count: number;
  tables: number;
  sentence: string;
  row_counts: Record<string, number>;
  column_counts: Record<string, number>;
  stacks: { undo_count: number; redo_count: number };
  access: { role: string; row_scope: string };
  document_revision: number;
}

export interface EditContext {
  client: PoolClient;
  documentId: string;
  person: Person;
  access: Access;
  view: View;
  preState: DocState;
}

const keyHash = (personId: string, documentId: string, key: string): string =>
  `idem:${createHash('sha256').update(`${personId}:${documentId}:${key}`).digest('hex')}`;

const docHash = (documentId: string): string => `doc:${createHash('sha256').update(documentId).digest('hex')}`;

export function lockDocument(client: PoolClient, documentId: string): Promise<unknown> {
  return client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [docHash(documentId)]);
}

/** The idempotency step: replay stored answers, refuse reused keys. */
async function idempotencyStep(
  client: PoolClient,
  person: Person,
  documentId: string,
  key: string | undefined,
  request: { method: string; path: string; query: string; body: string },
  ttlSeconds: number,
): Promise<{ replay: { status: number; body: string } | null }> {
  if (!key) return { replay: null };
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(key)) {
    throw new ApiError(422, 'idempotency_key', 'The request is invalid.', {
      fields: {
        idempotency_key: 'Send a key of 1 to 100 letters, digits, hyphens or underscores.',
      },
    });
  }
  // serialise duplicates in flight on any instance
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [keyHash(person.id, documentId, key)]);
  await client.query('DELETE FROM idempotency_keys WHERE person_id = $1 AND document_id = $2 AND key = $3 AND created_at < now() - ($4 || \' seconds\')::interval', [person.id, documentId, key, String(ttlSeconds)]).catch(() => undefined);
  const stored = await client.query<{ method: string; path: string; query: string; body: string; status: number | null; response: string | null }>(
    'SELECT method, path, query, body, status, response FROM idempotency_keys WHERE person_id = $1 AND document_id = $2 AND key = $3',
    [person.id, documentId, key],
  );
  const row = stored.rows[0];
  if (row) {
    if (row.method !== request.method || row.path !== request.path || row.query !== request.query || row.body !== request.body) {
      throw new ApiError(422, 'idempotency_key', 'The request is invalid.', {
        fields: { idempotency_key: 'This key was already used for a different change.' },
      });
    }
    if (row.status !== null && row.response !== null) {
      return { replay: { status: row.status, body: row.response } };
    }
  }
  return { replay: null };
}

async function storeIdempotency(
  client: PoolClient,
  person: Person,
  documentId: string,
  key: string | undefined,
  request: { method: string; path: string; query: string; body: string },
  status: number,
  responseBody: string,
): Promise<void> {
  if (!key) return;
  await client.query(
    `INSERT INTO idempotency_keys (person_id, document_id, key, method, path, query, body, status, response)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (person_id, document_id, key) DO UPDATE SET status = $8, response = $9`,
    [person.id, documentId, key, request.method, request.path, request.query, request.body, status, responseBody],
  );
}

export interface Stacks {
  undo_count: number;
  redo_count: number;
}

export async function readStacks(client: PoolClient, personId: string, documentId: string): Promise<Stacks> {
  const r = await client.query<{ stack: string; n: string }>(
    'SELECT stack, COUNT(*)::text AS n FROM undo_entries WHERE person_id = $1 AND document_id = $2 GROUP BY stack',
    [personId, documentId],
  );
  let undo = 0;
  let redo = 0;
  for (const row of r.rows) {
    if (row.stack === 'undo') undo = parseInt(row.n, 10);
    if (row.stack === 'redo') redo = parseInt(row.n, 10);
  }
  return { undo_count: undo, redo_count: redo };
}

export async function pushUndoEntry(
  client: PoolClient,
  personId: string,
  documentId: string,
  entry: { kind: UndoKind; data: Record<string, unknown> },
): Promise<void> {
  const next = await client.query<{ n: string }>(
    'SELECT COALESCE(MAX(seq), 0)::text AS n FROM undo_entries WHERE person_id = $1 AND document_id = $2',
    [personId, documentId],
  );
  const seq = parseInt(next.rows[0]!.n, 10) + 1;
  await client.query('DELETE FROM undo_entries WHERE person_id = $1 AND document_id = $2 AND stack = $3', [
    personId,
    documentId,
    'redo',
  ]);
  await client.query(
    'INSERT INTO undo_entries (person_id, document_id, stack, seq, kind, data) VALUES ($1, $2, $3, $4, $5, $6)',
    [personId, documentId, 'undo', seq, entry.kind, JSON.stringify(entry.data)],
  );
  // cap the undo stack at the last 50 entries
  await client.query(
    `DELETE FROM undo_entries WHERE person_id = $1 AND document_id = $2 AND stack = 'undo'
     AND seq <= (SELECT MAX(seq) - $3 FROM undo_entries WHERE person_id = $1 AND document_id = $2 AND stack = 'undo')`,
    [personId, documentId, UNDO_LIMIT],
  );
}

/** After an undo or redo, extend the accept lists of the person's entries. */
export async function extendAccepts(
  client: PoolClient,
  personId: string,
  documentId: string,
  touched: TouchedTarget[],
): Promise<void> {
  if (touched.length === 0) return;
  const rows = await client.query<{ id: string; kind: string; data: Record<string, unknown> }>(
    'SELECT id, kind, data FROM undo_entries WHERE person_id = $1 AND document_id = $2',
    [personId, documentId],
  );
  const byCell = new Map(touched.filter((t) => t.kind === 'cell').map((t) => [t.id, t.revision]));
  const byRow = new Map(touched.filter((t) => t.kind === 'row').map((t) => [t.id, t.revision]));
  const byColumn = new Map(touched.filter((t) => t.kind === 'column').map((t) => [t.id, t.revision]));
  const byTable = new Map(touched.filter((t) => t.kind === 'table').map((t) => [t.id, t.revision]));
  for (const row of rows.rows) {
    const data = row.data;
    let changed = false;
    const extendList = (list: number[] | undefined, rev: number | undefined): void => {
      if (list && rev !== undefined && !list.includes(rev)) {
        list.push(rev);
        changed = true;
      }
    };
    switch (row.kind) {
      case 'cell_write': {
        const id = `${String(data.row_id)}:${String(data.column_id)}`;
        extendList(data.accept_cell as number[] | undefined, byCell.get(id));
        break;
      }
      case 'cell_batch': {
        const accepts = data.accept_cells as Record<string, number[]> | undefined;
        if (accepts) {
          for (const [id, rev] of byCell) extendList(accepts[id], rev);
        }
        break;
      }
      case 'row_add':
      case 'row_delete': {
        extendList(data.accept as number[] | undefined, byRow.get(String(data.row_id)));
        break;
      }
      case 'column_add':
      case 'column_update': {
        extendList(data.accept as number[] | undefined, byColumn.get(String(data.column_id)));
        break;
      }
      case 'table_rename': {
        extendList(data.accept as number[] | undefined, byTable.get(String(data.table_id)));
        const columns = data.accept_columns as Record<string, number[]> | undefined;
        if (columns) {
          for (const [id, crev] of byColumn) extendList(columns[id], crev);
        }
        break;
      }
    }
    if (changed) {
      await client.query('UPDATE undo_entries SET data = $1 WHERE id = $2', [JSON.stringify(data), row.id]);
    }
  }
}

export interface RunEditOptions {
  method: string;
  path: string;
  query: string;
  bodyText: string;
  idempotencyKey?: string;
  ttlSeconds: number;
}

/**
 * Run one edit: lock the document, replay idempotency, apply the operation,
 * recalculate, record history and stacks, all in one transaction.
 */
export async function runEdit(
  db: Database,
  documentId: string,
  person: Person,
  access: Access,
  opts: RunEditOptions,
  op: (ctx: EditContext) => Promise<EditOutcome>,
  preRun?: (ctx: EditContext) => Promise<void>,
): Promise<{ status: number; body: Record<string, unknown>; replayed: boolean }> {
  return db.transaction(async (client) => {
    await lockDocument(client, documentId);
    const preState = await DocState.load(client, documentId);
    const view = viewFor(person.email, access, preState);
    const ctx: EditContext = { client, documentId, person, access, view, preState };
    if (preRun) {
      await preRun(ctx);
    }
    const idem = await idempotencyStep(client, person, documentId, opts.idempotencyKey, {
      method: opts.method,
      path: opts.path,
      query: opts.query,
      body: opts.bodyText,
    }, opts.ttlSeconds);
    if (idem.replay) {
      return { status: idem.replay.status, body: JSON.parse(idem.replay.body), replayed: true };
    }
    const outcome = await op(ctx);
    const postState = await DocState.load(client, documentId);
    const postView = viewFor(person.email, access, postState);
    const result = recalculate(preState, postState, postView, {
      seeds: outcome.seeds,
      directs: outcome.directs,
    } satisfies RecalcInput);
    const rev = await client.query<{ revision: number }>(
      'UPDATE documents SET revision = revision + 1 WHERE id = $1 RETURNING revision',
      [documentId],
    );
    const documentRevision = rev.rows[0]!.revision;
    await client.query(
      'INSERT INTO history (document_id, revision, kind, actor_id, table_id) VALUES ($1, $2, $3, $4, $5)',
      [documentId, documentRevision, outcome.historyKind, person.id, outcome.historyTableId],
    );
    if (outcome.undo) {
      await pushUndoEntry(client, person.id, documentId, outcome.undo);
    }
    if (outcome.touchedTargets.length > 0) {
      await extendAccepts(client, person.id, documentId, outcome.touchedTargets);
    }
    for (const g of postState.newGroupIds) {
      await client.query(
        `INSERT INTO doc_summary_groups (summary_table_id, document_id, key_json, row_id)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [g.summaryId, documentId, g.keyJson, g.rowId],
      );
    }
    // group ids allocated by the pre-load pass belong to earlier commits;
    // only the post state's new groups are persisted
    const counts = await buildCounts(preState, postState, postView, outcome.newTableIds);
    const stacks = await readStacks(client, person.id, documentId);
    const recalc: RecalcResponse = {
      cells: result.cells,
      count: result.count,
      tables: result.tables,
      sentence: result.sentence,
      row_counts: counts.rowCounts,
      column_counts: counts.columnCounts,
      stacks,
      access: { role: access.role, row_scope: access.rowScope },
      document_revision: documentRevision,
    };
    const body = { ...outcome.body, recalc };
    await storeIdempotency(client, person, documentId, opts.idempotencyKey, {
      method: opts.method,
      path: opts.path,
      query: opts.query,
      body: opts.bodyText,
    }, outcome.status, JSON.stringify(body));
    return { status: outcome.status, body, replayed: false };
  });
}

async function buildCounts(
  preState: DocState,
  postState: DocState,
  postView: View,
  newTableIds: string[],
): Promise<{ rowCounts: Record<string, number>; columnCounts: Record<string, number> }> {
  const rowCounts: Record<string, number> = {};
  const columnCounts: Record<string, number> = {};
  for (const table of postState.tables) {
    const postRows = postView.visibleRows(table.id, postState).length;
    const preRows = postView.visibleRows(table.id, preState).length;
    const postCols = postState.tableColumns(table.id).length;
    const preCols = preState.tableColumns(table.id).length;
    const isNew = newTableIds.includes(table.id) || !preState.tableById(table.id);
    if (isNew || postRows !== preRows) rowCounts[table.id] = postRows;
    if (isNew || postCols !== preCols) columnCounts[table.id] = postCols;
  }
  return { rowCounts, columnCounts };
}

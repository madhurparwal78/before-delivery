import type { ColumnType, StacksJson, UndoneKind } from '../shared/api.js';
import { newId, type Client } from './db.js';

export type UndoTarget =
  | { k: 'cell'; rowId: string; columnId: string; revision: number }
  | { k: 'row'; rowId: string; revision: number }
  | { k: 'column'; columnId: string; revision: number }
  | { k: 'table'; tableId: string; revision: number };

export type CellWriteUndo = {
  rowId: string;
  columnId: string;
  oldRaw: string | null;
  newRaw: string | null;
};

export type ColumnState = { name: string; type: ColumnType; formula: string | null };

export type FormulaRewrite = { columnId: string; before: string; after: string };

export type UndoPayload =
  | { k: 'cell_write'; tableId: string; writes: CellWriteUndo[] }
  | { k: 'cell_batch'; tableId: string; writes: CellWriteUndo[] }
  | {
      k: 'row_add';
      tableId: string;
      rowId: string;
      /** Set when the add is undone, so the redo restores the same references. */
      references?: Array<{ rowId: string; columnId: string; revision: number }>;
    }
  | {
      k: 'row_delete';
      tableId: string;
      rowId: string;
      references: Array<{ rowId: string; columnId: string; revision: number }>;
    }
  | { k: 'column_add'; tableId: string; columnId: string }
  | {
      k: 'column_update';
      tableId: string;
      columnId: string;
      before: ColumnState;
      after: ColumnState;
      rewrites: FormulaRewrite[];
      cellsBefore: Array<{ rowId: string; raw: string | null }>;
    }
  | { k: 'column_delete'; tableId: string; columnId: string }
  | {
      k: 'table_rename';
      tableId: string;
      before: string;
      after: string;
      rewrites: FormulaRewrite[];
    };

export type UndoEntry = {
  id: string;
  kind: UndoneKind;
  payload: UndoPayload;
  targets: UndoTarget[];
};

type StoredPayload = { payload: UndoPayload; targets: UndoTarget[] };

export async function pushEntry(
  client: Client,
  documentId: string,
  actorId: string,
  stack: 'undo' | 'redo',
  entry: { payload: UndoPayload; targets: UndoTarget[] },
): Promise<void> {
  const next = await client.query<{ position: string }>(
    `select coalesce(max(position), 0) + 1 as position from undo_entries
     where document_id = $1 and actor_id = $2 and stack = $3`,
    [documentId, actorId, stack],
  );
  await client.query(
    `insert into undo_entries (id, document_id, actor_id, stack, position, kind, payload)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      newId('und'),
      documentId,
      actorId,
      stack,
      Number(next.rows[0]?.position ?? 1),
      entry.payload.k,
      JSON.stringify({ payload: entry.payload, targets: entry.targets } satisfies StoredPayload),
    ],
  );
  if (stack === 'undo') {
    await client.query(
      `delete from undo_entries where id in (
         select id from undo_entries
         where document_id = $1 and actor_id = $2 and stack = 'undo'
         order by position desc offset 50)`,
      [documentId, actorId],
    );
  }
}

export async function clearStack(
  client: Client,
  documentId: string,
  actorId: string,
  stack: 'undo' | 'redo',
): Promise<void> {
  await client.query(
    'delete from undo_entries where document_id = $1 and actor_id = $2 and stack = $3',
    [documentId, actorId, stack],
  );
}

export async function topEntry(
  client: Client,
  documentId: string,
  actorId: string,
  stack: 'undo' | 'redo',
): Promise<UndoEntry | null> {
  const result = await client.query<{ id: string; kind: UndoneKind; payload: StoredPayload }>(
    `select id, kind, payload from undo_entries
     where document_id = $1 and actor_id = $2 and stack = $3
     order by position desc limit 1`,
    [documentId, actorId, stack],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return { id: row.id, kind: row.kind, payload: row.payload.payload, targets: row.payload.targets };
}

export async function deleteEntry(client: Client, id: string): Promise<void> {
  await client.query('delete from undo_entries where id = $1', [id]);
}

export async function stackCounts(
  client: Client,
  documentId: string,
  actorId: string,
): Promise<StacksJson> {
  const result = await client.query<{ stack: string; count: string }>(
    `select stack, count(*) as count from undo_entries
     where document_id = $1 and actor_id = $2 group by stack`,
    [documentId, actorId],
  );
  let undoCount = 0;
  let redoCount = 0;
  for (const row of result.rows) {
    if (row.stack === 'undo') undoCount = Number(row.count);
    if (row.stack === 'redo') redoCount = Number(row.count);
  }
  return { undo_count: undoCount, redo_count: redoCount };
}

function sameTarget(a: UndoTarget, b: UndoTarget): boolean {
  if (a.k !== b.k) return false;
  if (a.k === 'cell' && b.k === 'cell') return a.rowId === b.rowId && a.columnId === b.columnId;
  if (a.k === 'row' && b.k === 'row') return a.rowId === b.rowId;
  if (a.k === 'column' && b.k === 'column') return a.columnId === b.columnId;
  if (a.k === 'table' && b.k === 'table') return a.tableId === b.tableId;
  return false;
}

/**
 * An own undo or redo keeps that person's other entries applicable, so their
 * expected revisions follow the revision the undo produced.
 */
export async function followOwnRevisions(
  client: Client,
  documentId: string,
  actorId: string,
  produced: UndoTarget[],
): Promise<void> {
  const result = await client.query<{ id: string; payload: StoredPayload }>(
    'select id, payload from undo_entries where document_id = $1 and actor_id = $2',
    [documentId, actorId],
  );
  for (const row of result.rows) {
    let changed = false;
    const targets = row.payload.targets.map((target) => {
      const match = produced.find((candidate) => sameTarget(candidate, target));
      if (match === undefined || match.revision === target.revision) return target;
      changed = true;
      return { ...target, revision: match.revision };
    });
    if (!changed) continue;
    await client.query('update undo_entries set payload = $2 where id = $1', [
      row.id,
      JSON.stringify({ payload: row.payload.payload, targets } satisfies StoredPayload),
    ]);
  }
}

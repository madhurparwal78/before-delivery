import type { EditContext } from './commit.js';
import type { Client } from './db.js';
import {
  applyFormulaRewrites,
  convertColumnValues,
  deleteRow,
  restoreRow,
  setColumnDeleted,
  updateColumnFields,
  writeCells,
  type CellRevision,
} from './edits.js';
import { cellKey } from './evaluate.js';
import { emptyClasses, type CellClasses } from './recalc.js';
import type { UndoEntry, UndoPayload, UndoTarget } from './undo.js';
import { requireColumn, requireTable } from './routes/helpers.js';

export type Direction = 'undo' | 'redo';

export type AppliedEntry = {
  classes: CellClasses;
  payload: UndoPayload;
  targets: UndoTarget[];
  produced: UndoTarget[];
  tableId: string;
};

export async function entryApplies(client: Client, entry: UndoEntry): Promise<boolean> {
  for (const target of entry.targets) {
    if (target.k === 'cell') {
      const result = await client.query<{ revision: number; row_deleted: boolean; column_deleted: boolean }>(
        `select c.revision, r.deleted as row_deleted, col.deleted as column_deleted
         from doc_cells c
         join doc_rows r on r.id = c.row_id
         join doc_columns col on col.id = c.column_id
         where c.row_id = $1 and c.column_id = $2`,
        [target.rowId, target.columnId],
      );
      const cell = result.rows[0];
      if (cell === undefined) return false;
      if (cell.row_deleted || cell.column_deleted) return false;
      if (cell.revision !== target.revision) return false;
      continue;
    }
    if (target.k === 'row') {
      const result = await client.query<{ revision: number }>(
        'select revision from doc_rows where id = $1',
        [target.rowId],
      );
      if (result.rows[0]?.revision !== target.revision) return false;
      continue;
    }
    if (target.k === 'column') {
      const result = await client.query<{ revision: number }>(
        'select revision from doc_columns where id = $1',
        [target.columnId],
      );
      if (result.rows[0]?.revision !== target.revision) return false;
      continue;
    }
    const result = await client.query<{ revision: number }>(
      'select revision from doc_tables where id = $1',
      [target.tableId],
    );
    if (result.rows[0]?.revision !== target.revision) return false;
  }
  return true;
}

function cellTargets(revisions: CellRevision[]): UndoTarget[] {
  return revisions.map((revision) => ({
    k: 'cell',
    rowId: revision.rowId,
    columnId: revision.columnId,
    revision: revision.revision,
  }));
}

export async function applyEntry(
  context: EditContext,
  entry: UndoEntry,
  direction: Direction,
): Promise<AppliedEntry | 'conflict'> {
  const { client, doc, before } = context;
  const payload = entry.payload;
  const classes = emptyClasses();

  switch (payload.k) {
    case 'cell_write':
    case 'cell_batch': {
      const writes = payload.writes.map((write) => ({
        rowId: write.rowId,
        columnId: write.columnId,
        raw: direction === 'undo' ? write.oldRaw : write.newRaw,
      }));
      const revisions = await writeCells(client, writes);
      for (const write of writes) classes.seeds.add(cellKey(write.rowId, write.columnId));
      return {
        classes,
        payload,
        targets: cellTargets(revisions),
        produced: cellTargets(revisions),
        tableId: payload.tableId,
      };
    }
    case 'row_add': {
      const table = requireTable(doc, payload.tableId);
      if (direction === 'undo') {
        for (const column of table.columns) classes.seeds.add(cellKey(payload.rowId, column.id));
        const references = await deleteRow(client, doc, payload.rowId);
        for (const reference of references) {
          classes.directs.add(cellKey(reference.rowId, reference.columnId));
        }
        return {
          classes,
          payload: { ...payload, references },
          targets: [{ k: 'row', rowId: payload.rowId, revision: await rowRevision(client, payload.rowId) }],
          produced: cellTargets(references),
          tableId: payload.tableId,
        };
      }
      const produced = await restoreRow(client, payload.rowId, payload.references ?? []);
      for (const column of table.columns) {
        if (column.type !== 'formula') classes.seeds.add(cellKey(payload.rowId, column.id));
      }
      for (const reference of produced) {
        classes.directs.add(cellKey(reference.rowId, reference.columnId));
      }
      return {
        classes,
        payload,
        targets: [
          { k: 'row', rowId: payload.rowId, revision: await rowRevision(client, payload.rowId) },
        ],
        produced: cellTargets(produced),
        tableId: payload.tableId,
      };
    }
    case 'row_delete': {
      const table = requireTable(doc, payload.tableId);
      if (direction === 'undo') {
        const produced = await restoreRow(client, payload.rowId, payload.references);
        for (const column of table.columns) {
          if (column.type !== 'formula') classes.seeds.add(cellKey(payload.rowId, column.id));
        }
        for (const reference of produced) {
          classes.directs.add(cellKey(reference.rowId, reference.columnId));
        }
        return {
          classes,
          payload,
          targets: [],
          produced: cellTargets(produced),
          tableId: payload.tableId,
        };
      }
      for (const column of table.columns) classes.seeds.add(cellKey(payload.rowId, column.id));
      const references = await deleteRow(client, doc, payload.rowId);
      for (const reference of references) {
        classes.directs.add(cellKey(reference.rowId, reference.columnId));
      }
      return {
        classes,
        payload: { ...payload, references },
        targets: [],
        produced: cellTargets(references),
        tableId: payload.tableId,
      };
    }
    case 'column_add':
    case 'column_delete': {
      const removing =
        (payload.k === 'column_add' && direction === 'undo') ||
        (payload.k === 'column_delete' && direction === 'redo');
      const table = requireTable(doc, payload.tableId);
      if (!removing) {
        const stored = await client.query<{ name: string }>(
          'select name from doc_columns where id = $1',
          [payload.columnId],
        );
        const name = stored.rows[0]?.name ?? '';
        const taken = table.columns.some(
          (column) =>
            column.id !== payload.columnId && column.name.toLowerCase() === name.toLowerCase(),
        );
        if (taken) return 'conflict';
      }
      const revision = await setColumnDeleted(client, payload.columnId, removing);
      for (const row of before.visible.get(payload.tableId) ?? []) {
        classes.seeds.add(cellKey(row.id, payload.columnId));
      }
      classes.nameResolutionDirect = true;
      classes.includeTables.push(payload.tableId);
      return {
        classes,
        payload,
        targets: [{ k: 'column', columnId: payload.columnId, revision }],
        produced: [{ k: 'column', columnId: payload.columnId, revision }],
        tableId: payload.tableId,
      };
    }
    case 'column_update': {
      const table = requireTable(doc, payload.tableId);
      const wanted = direction === 'undo' ? payload.before : payload.after;
      const taken = table.columns.some(
        (column) =>
          column.id !== payload.columnId &&
          column.name.toLowerCase() === wanted.name.toLowerCase(),
      );
      if (taken) return 'conflict';
      const rewrites = new Map(
        payload.rewrites.map((rewrite) => [
          rewrite.columnId,
          direction === 'undo' ? rewrite.before : rewrite.after,
        ]),
      );
      const rewritten = await applyFormulaRewrites(client, rewrites);
      const restored: CellRevision[] = [];
      if (payload.before.type !== payload.after.type) {
        if (direction === 'undo') {
          for (const cell of payload.cellsBefore) {
            restored.push(
              ...(await writeCells(client, [
                { rowId: cell.rowId, columnId: payload.columnId, raw: cell.raw },
              ])),
            );
          }
        } else {
          const conversion = await convertColumnValues(
            client,
            table,
            requireColumn(table, payload.columnId),
            payload.after.type,
          );
          restored.push(...conversion.converted);
        }
      }
      const revision = await updateColumnFields(client, payload.columnId, {
        name: wanted.name,
        type: wanted.type,
        formula: wanted.formula,
      });
      for (const cell of restored) classes.directs.add(cellKey(cell.rowId, cell.columnId));
      classes.directColumns.push(payload.columnId, ...rewrites.keys());
      classes.nameResolutionDirect = true;
      const targets: UndoTarget[] = [
        { k: 'column', columnId: payload.columnId, revision },
        ...rewritten.map(
          (entry2): UndoTarget => ({
            k: 'column',
            columnId: entry2.columnId,
            revision: entry2.revision,
          }),
        ),
      ];
      return {
        classes,
        payload,
        targets,
        produced: [...targets, ...cellTargets(restored)],
        tableId: payload.tableId,
      };
    }
    case 'table_rename': {
      const wanted = direction === 'undo' ? payload.before : payload.after;
      const taken = doc.tables.some(
        (table) =>
          table.id !== payload.tableId && table.name.toLowerCase() === wanted.toLowerCase(),
      );
      if (taken) return 'conflict';
      const rewrites = new Map(
        payload.rewrites.map((rewrite) => [
          rewrite.columnId,
          direction === 'undo' ? rewrite.before : rewrite.after,
        ]),
      );
      const rewritten = await applyFormulaRewrites(client, rewrites);
      const result = await client.query<{ revision: number }>(
        'update doc_tables set name = $2, revision = revision + 1 where id = $1 returning revision',
        [payload.tableId, wanted],
      );
      classes.directColumns.push(...rewrites.keys());
      classes.nameResolutionDirect = true;
      const targets: UndoTarget[] = [
        { k: 'table', tableId: payload.tableId, revision: result.rows[0]?.revision ?? 1 },
        ...rewritten.map(
          (entry2): UndoTarget => ({
            k: 'column',
            columnId: entry2.columnId,
            revision: entry2.revision,
          }),
        ),
      ];
      return { classes, payload, targets, produced: targets, tableId: payload.tableId };
    }
  }
}

async function rowRevision(client: Client, rowId: string): Promise<number> {
  const result = await client.query<{ revision: number }>(
    'select revision from doc_rows where id = $1',
    [rowId],
  );
  return result.rows[0]?.revision ?? 1;
}

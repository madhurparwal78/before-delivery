import type { ApiErrorBody, CellJson } from '../../shared/api.js';
import { fieldMessages } from '../../shared/copy.js';
import { runCommit, type Outcome } from '../commit.js';
import { deleteRow, insertRow, writeCells } from '../edits.js';
import { cellJson, cellKey } from '../evaluate.js';
import { invalid, notFound, staleCell, stalePaste, staleRow } from '../errors.js';
import { asArray, asInteger, asObject, asString } from '../json.js';
import {
  rowIsVisible,
  type ColumnData,
  type DocData,
  type RowData,
  type TableData,
  type Viewer,
} from '../model.js';
import { dataRowJson } from '../present.js';
import { emptyClasses } from '../recalc.js';
import type { CellWriteUndo, UndoTarget } from '../undo.js';
import { parseCellValue } from '../validate.js';
import { requireColumn, requireTable, requireVisibleRow } from './helpers.js';
import type { Reply, RouteContext } from './types.js';

function referenceIsVisible(
  doc: DocData,
  column: ColumnData,
  viewer: Viewer,
): (rowId: string) => boolean {
  const target = doc.tables.find((table) => table.id === column.targetTableId);
  return (rowId: string): boolean => {
    if (target === undefined) return false;
    const row = target.rows.find((candidate) => candidate.id === rowId);
    return row !== undefined && rowIsVisible(target, row, viewer);
  };
}

function targetTableOf(doc: DocData, column: ColumnData): TableData | null {
  return doc.tables.find((table) => table.id === column.targetTableId) ?? null;
}

/** A member with own-row scope may only ever name themselves in an owner cell. */
function checkOwnerCell(
  table: TableData,
  column: ColumnData,
  raw: string | null,
  viewer: Viewer,
): string | null {
  if (viewer.role === 'owner' || viewer.rowScope !== 'own') return null;
  if (table.ownerColumnId !== column.id) return null;
  const email = viewer.email.trim().toLowerCase();
  if (raw !== null && raw.trim().toLowerCase() === email) return null;
  return fieldMessages.ownRowOnly;
}

function parseWrite(
  doc: DocData,
  table: TableData,
  column: ColumnData,
  value: unknown,
  viewer: Viewer,
): { raw: string | null } | { error: string } {
  if (column.type === 'formula') return { error: fieldMessages.formulaCell };
  const parsed = parseCellValue(column, value, {
    targetTable: targetTableOf(doc, column),
    referenceIsVisible: referenceIsVisible(doc, column, viewer),
  });
  if ('error' in parsed) return parsed;
  const ownerError = checkOwnerCell(table, column, parsed.raw, viewer);
  if (ownerError !== null) return { error: ownerError };
  return parsed;
}

export async function createRow(context: RouteContext): Promise<Reply> {
  const documentId = context.params['doc'] as string;
  return runCommit(context.client, context.request, context.account, documentId, {
    requires: 'editor',
    resolve: ({ doc }) => {
      requireTable(doc, context.params['table']);
    },
    apply: async ({ client, doc, viewer }): Promise<Outcome> => {
      const table = requireTable(doc, context.params['table']);
      if (table.kind === 'summary') throw invalid({ table: fieldMessages.summaryReadOnly });
      const body = asObject(context.request.body) ?? {};
      const cells = asObject(body['cells']) ?? {};
      const writes: Array<{ columnId: string; raw: string | null }> = [];
      const fields: Record<string, string> = {};
      for (const [columnId, value] of Object.entries(cells)) {
        const column = table.columns.find((candidate) => candidate.id === columnId);
        if (column === undefined) {
          fields[columnId] = 'This column does not exist.';
          continue;
        }
        const parsed = parseWrite(doc, table, column, value, viewer);
        if ('error' in parsed) {
          fields[columnId] = parsed.error;
          continue;
        }
        writes.push({ columnId, raw: parsed.raw });
      }
      if (viewer.role !== 'owner' && viewer.rowScope === 'own' && table.ownerColumnId !== null) {
        const ownerColumnId = table.ownerColumnId;
        const existing = writes.find((write) => write.columnId === ownerColumnId);
        if (existing === undefined) {
          writes.push({ columnId: ownerColumnId, raw: viewer.email });
        }
      }
      if (Object.keys(fields).length > 0) throw invalid(fields);

      const rowId = await insertRow(client, table, writes);
      const classes = emptyClasses();
      for (const column of table.columns) {
        if (column.type !== 'formula') classes.seeds.add(cellKey(rowId, column.id));
      }
      classes.includeTables.push(table.id);
      return {
        kind: 'applied',
        status: 201,
        body: {},
        bodyFrom: (after, afterDoc) => {
          const afterTable = requireTable(afterDoc, table.id);
          const row = afterTable.rows.find((candidate) => candidate.id === rowId) as RowData;
          return { row: dataRowJson(after, afterTable, row) };
        },
        classes,
        historyKind: 'row_add',
        historyTableId: table.id,
        undo: {
          payload: { k: 'row_add', tableId: table.id, rowId },
          targets: [{ k: 'row', rowId, revision: 1 }],
        },
      };
    },
  });
}

export async function removeRow(context: RouteContext): Promise<Reply> {
  const documentId = context.params['doc'] as string;
  return runCommit(context.client, context.request, context.account, documentId, {
    requires: 'editor',
    resolve: ({ doc, viewer }) => {
      const table = requireTable(doc, context.params['table']);
      requireVisibleRow(table, context.params['row'], viewer);
    },
    apply: async ({ client, doc, viewer, before }): Promise<Outcome> => {
      const table = requireTable(doc, context.params['table']);
      if (table.kind === 'summary') throw invalid({ table: fieldMessages.summaryReadOnly });
      const row = requireVisibleRow(table, context.params['row'], viewer);
      const revisionText = context.request.query.get('revision');
      if (revisionText === null || !/^[0-9]+$/.test(revisionText)) {
        throw invalid({ revision: fieldMessages.rowRevision });
      }
      if (Number(revisionText) !== row.revision) {
        throw staleRow(dataRowJson(before, table, row));
      }

      const references = await deleteRow(client, doc, row.id);
      const classes = emptyClasses();
      for (const column of table.columns) classes.seeds.add(cellKey(row.id, column.id));
      for (const reference of references) {
        classes.directs.add(cellKey(reference.rowId, reference.columnId));
      }
      classes.includeTables.push(table.id);
      return {
        kind: 'applied',
        status: 200,
        body: {},
        classes,
        historyKind: 'row_delete',
        historyTableId: table.id,
        undo: {
          payload: { k: 'row_delete', tableId: table.id, rowId: row.id, references },
          targets: [],
        },
      };
    },
  });
}

export async function writeCell(context: RouteContext): Promise<Reply> {
  const documentId = context.params['doc'] as string;
  return runCommit(context.client, context.request, context.account, documentId, {
    requires: 'editor',
    resolve: ({ doc, viewer }) => {
      const table = requireTable(doc, context.params['table']);
      if (table.kind !== 'summary') requireVisibleRow(table, context.params['row'], viewer);
      requireColumn(table, context.params['column']);
    },
    apply: async ({ client, doc, viewer, before }): Promise<Outcome> => {
      const table = requireTable(doc, context.params['table']);
      if (table.kind === 'summary') throw invalid({ table: fieldMessages.summaryReadOnly });
      const row = requireVisibleRow(table, context.params['row'], viewer);
      const column = requireColumn(table, context.params['column']);
      const body = asObject(context.request.body) ?? {};
      if (column.type === 'formula') throw invalid({ value: fieldMessages.formulaCell });
      const revision = asInteger(body['revision']);
      if (revision === null) throw invalid({ revision: fieldMessages.cellRevision });
      const current = before.cells.get(cellKey(row.id, column.id));
      if (current === undefined) throw notFound();
      if (revision !== current.revision) throw staleCell(cellJson(current));
      const parsed = parseWrite(doc, table, column, body['value'], viewer);
      if ('error' in parsed) throw invalid({ value: parsed.error });

      await writeCells(client, [{ rowId: row.id, columnId: column.id, raw: parsed.raw }]);
      const classes = emptyClasses();
      classes.seeds.add(cellKey(row.id, column.id));
      const undoWrite: CellWriteUndo = {
        rowId: row.id,
        columnId: column.id,
        oldRaw: row.cells.get(column.id)?.raw ?? null,
        newRaw: parsed.raw,
      };
      return {
        kind: 'applied',
        status: 200,
        body: {},
        bodyFrom: (after) => {
          const cell = after.cells.get(cellKey(row.id, column.id));
          return { cell: cell === undefined ? null : cellJson(cell) };
        },
        classes,
        historyKind: 'cell_write',
        historyTableId: table.id,
        undo: {
          payload: { k: 'cell_write', tableId: table.id, writes: [undoWrite] },
          targets: [
            { k: 'cell', rowId: row.id, columnId: column.id, revision: current.revision + 1 },
          ],
        },
      };
    },
  });
}

type PasteWrite = { rowId: string; columnId: string; value: unknown; revision: number | null };

function readPasteWrites(body: Record<string, unknown>): PasteWrite[] {
  const list = asArray(body['writes']);
  if (list === null) throw invalid({ writes: fieldMessages.pasteCount });
  if (list.length < 1 || list.length > 500) throw invalid({ writes: fieldMessages.pasteCount });
  const writes: PasteWrite[] = [];
  for (const entry of list) {
    const item = asObject(entry);
    const rowId = item === null ? null : asString(item['row_id']);
    const columnId = item === null ? null : asString(item['column_id']);
    if (item === null || rowId === null || columnId === null) {
      throw invalid({ writes: fieldMessages.pasteCount });
    }
    writes.push({
      rowId,
      columnId,
      value: item['value'],
      revision: asInteger(item['revision']),
    });
  }
  const seen = new Set<string>();
  for (const write of writes) {
    const key = `${write.rowId}:${write.columnId}`;
    if (seen.has(key)) throw invalid({ writes: fieldMessages.pasteDuplicate });
    seen.add(key);
  }
  return writes;
}

export async function pasteCells(context: RouteContext): Promise<Reply> {
  const documentId = context.params['doc'] as string;
  const body = asObject(context.request.body) ?? {};
  return runCommit(context.client, context.request, context.account, documentId, {
    requires: 'editor',
    resolve: ({ doc, viewer }) => {
      const table = requireTable(doc, context.params['table']);
      if (table.kind === 'summary') return;
      const writes = readPasteWrites(body);
      for (const write of writes) {
        requireVisibleRow(table, write.rowId, viewer);
        requireColumn(table, write.columnId);
      }
    },
    apply: async ({ client, doc, viewer, before }): Promise<Outcome> => {
      const table = requireTable(doc, context.params['table']);
      if (table.kind === 'summary') throw invalid({ table: fieldMessages.summaryReadOnly });
      const writes = readPasteWrites(body);

      const conflicts: NonNullable<ApiErrorBody['error']['conflicts']> = [];
      let firstStale: CellJson | null = null;
      for (const write of writes) {
        const column = requireColumn(table, write.columnId);
        if (column.type === 'formula' || write.revision === null) continue;
        const current = before.cells.get(cellKey(write.rowId, write.columnId));
        if (current === undefined) throw notFound();
        if (write.revision === current.revision) continue;
        const json = cellJson(current);
        if (firstStale === null) firstStale = json;
        conflicts.push({
          row_id: write.rowId,
          column_id: write.columnId,
          current: { value: json.value, display: json.display, revision: json.revision },
        });
      }
      if (firstStale !== null) throw stalePaste(firstStale, conflicts);

      const fields: Record<string, string> = {};
      const applied: Array<{ write: PasteWrite; raw: string | null; column: ColumnData }> = [];
      for (const write of writes) {
        const column = requireColumn(table, write.columnId);
        const key = `${write.rowId}:${write.columnId}`;
        if (write.revision === null) {
          fields[key] = fieldMessages.cellRevision;
          continue;
        }
        const parsed = parseWrite(doc, table, column, write.value, viewer);
        if ('error' in parsed) {
          fields[key] = parsed.error;
          continue;
        }
        applied.push({ write, raw: parsed.raw, column });
      }
      if (Object.keys(fields).length > 0) throw invalid(fields);

      const undoWrites: CellWriteUndo[] = applied.map(({ write, raw }) => {
        const row = table.rows.find((candidate) => candidate.id === write.rowId) as RowData;
        return {
          rowId: write.rowId,
          columnId: write.columnId,
          oldRaw: row.cells.get(write.columnId)?.raw ?? null,
          newRaw: raw,
        };
      });
      const revisions = await writeCells(
        client,
        applied.map(({ write, raw }) => ({ rowId: write.rowId, columnId: write.columnId, raw })),
      );

      const classes = emptyClasses();
      for (const write of applied) {
        classes.seeds.add(cellKey(write.write.rowId, write.write.columnId));
      }
      const targets: UndoTarget[] = revisions.map((revision) => ({
        k: 'cell',
        rowId: revision.rowId,
        columnId: revision.columnId,
        revision: revision.revision,
      }));
      return {
        kind: 'applied',
        status: 200,
        body: {},
        bodyFrom: (after) => ({
          cells: applied.map(({ write }) => {
            const cell = after.cells.get(cellKey(write.rowId, write.columnId));
            return {
              row_id: write.rowId,
              column_id: write.columnId,
              cell: cell === undefined ? null : cellJson(cell),
            };
          }),
        }),
        classes,
        historyKind: 'cell_batch',
        historyTableId: table.id,
        undo: {
          payload: { k: 'cell_batch', tableId: table.id, writes: undoWrites },
          targets,
        },
      };
    },
  });
}

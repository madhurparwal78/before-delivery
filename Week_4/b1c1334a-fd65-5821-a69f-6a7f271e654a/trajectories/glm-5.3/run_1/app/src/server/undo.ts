/**
 * Undo and redo: one place applies a person's own stack entries, drops the
 * entries that no longer apply, and keeps the winner rules.
 */
import { Database } from './db.js';
import { DocState } from './docstate.js';
import { runEdit, readStacks, extendAccepts, EditContext } from './edits-core.js';
import { Access, Person } from './access.js';
import { ApiError } from '../shared/errors.js';
import {
  nodeKey,
} from './evaluator.js';
import {
  deleteRowForUndo,
  restoreRowForUndo,
  restoreColumnForUndo,
  resolveWriteTarget,
  nameErrorCells,
} from './edits-ops.js';
import { rewriteColumnRename, rewriteTableRename } from './rename.js';

interface EntryRow {
  id: string;
  seq: number;
  kind: string;
  data: Record<string, unknown>;
}

const UNDO_CONFLICT = () =>
  new ApiError(409, 'undo_conflict', 'This undo no longer applies because the cells changed since. Nothing was changed.');
const NOTHING_TO_UNDO = () => new ApiError(409, 'nothing_to_undo', 'Nothing to undo.');

export interface UndoResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Undo or redo: pop the newest applicable entry, apply its inverse or
 * forward edit as one document edit, and move it to the other stack.
 */
export async function runUndo(
  db: Database,
  documentId: string,
  person: Person,
  access: Access,
  opts: { method: string; path: string; query: string; bodyText: string; idempotencyKey?: string; ttlSeconds: number },
  stack: 'undo' | 'redo',
): Promise<UndoResult> {
  if (access.role === 'viewer') {
    throw new ApiError(403, 'forbidden', 'You may not take this action.');
  }
  const result = await runEdit(db, documentId, person, access, opts, async (ctx) => {
    const entry = await topOfStack(ctx.client, person.id, documentId, stack);
    if (!entry) {
      const stacks = await readStacks(ctx.client, person.id, documentId);
      throw new ApiError(
        409,
        stack === 'undo' ? 'nothing_to_undo' : 'nothing_to_redo',
        stack === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.',
        { stacks },
      );
    }
    const applies = await checkApplies(ctx, entry, stack === 'undo' ? 'undo' : 'redo');
    if (!applies) {
      await ctx.client.query('DELETE FROM undo_entries WHERE id = $1', [entry.id]);
      throw UNDO_CONFLICT();
    }
    const outcome = await applyEntry(ctx, entry, stack === 'undo' ? 'undo' : 'redo');
    // move the entry to the other stack, keeping its order
    const other = stack === 'undo' ? 'redo' : 'undo';
    await ctx.client.query('UPDATE undo_entries SET stack = $1 WHERE id = $2', [other, entry.id]);
    const keyName = stack === 'undo' ? 'undone' : 'redone';
    return {
      ...outcome,
      body: { [keyName]: { kind: entry.kind }, ...outcome.body },
      historyKind: stack === 'undo' ? 'undo' : 'redo',
    };
  });
  return { status: result.status, body: result.body };
}

async function topOfStack(
  client: EditContext['client'],
  personId: string,
  documentId: string,
  stack: 'undo' | 'redo',
): Promise<EntryRow | null> {
  // undo takes the newest entry; redo takes the oldest undone entry
  const order = stack === 'undo' ? 'DESC' : 'ASC';
  const r = await client.query<{ id: string; seq: number; kind: string; data: Record<string, unknown> }>(
    `SELECT id, seq, kind, data FROM undo_entries
     WHERE person_id = $1 AND document_id = $2 AND stack = $3
     ORDER BY seq ${order} LIMIT 1`,
    [personId, documentId, stack],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { id: row.id, seq: row.seq, kind: row.kind, data: row.data };
}

/** Whether the entry's targets still have the revisions its edit produced. */
async function checkApplies(ctx: EditContext, entry: EntryRow, direction: 'undo' | 'redo'): Promise<boolean> {
  const data = entry.data;
  switch (entry.kind) {
    case 'cell_write': {
      const current = await currentCellRevision(ctx, String(data.row_id), String(data.column_id));
      const accepts = (data.accept_cell as number[]) ?? [];
      return current !== null && accepts.includes(current);
    }
    case 'cell_batch': {
      const accepts = (data.accept_cells as Record<string, number[]>) ?? {};
      for (const row of (data.rows as { row_id: string; column_id: string }[]) ?? []) {
        const key = `${row.row_id}:${row.column_id}`;
        const current = await currentCellRevision(ctx, row.row_id, row.column_id);
        const list = accepts[key];
        if (!list || current === null || !list.includes(current)) return false;
      }
      return true;
    }
    case 'row_add': {
      const row = await currentRowRevision(ctx, String(data.row_id));
      const accepts = (data.accept as number[]) ?? [];
      if (!row || !accepts.includes(row.revision)) return false;
      return direction === 'undo' ? !row.deleted : row.deleted;
    }
    case 'row_delete': {
      const row = await currentRowRevision(ctx, String(data.row_id));
      const accepts = (data.accept as number[]) ?? [];
      if (!row || !accepts.includes(row.revision)) return false;
      return direction === 'undo' ? row.deleted : !row.deleted;
    }
    case 'column_add': {
      const column = await currentColumnRevision(ctx, String(data.column_id));
      if (direction === 'undo') {
        const accepts = (data.accept as number[]) ?? [];
        return column !== null && accepts.includes(column);
      }
      return column === null;
    }
    case 'column_update': {
      const column = await currentColumnRevision(ctx, String(data.column_id));
      const accepts = (data.accept as number[]) ?? [];
      return column !== null && accepts.includes(column);
    }
    case 'column_delete': {
      const column = await currentColumnRevision(ctx, String((data.column as { id: string }).id));
      return direction === 'undo' ? column === null : column !== null;
    }
    case 'table_rename': {
      const table = await currentTableRevision(ctx, String(data.table_id));
      const accepts = (data.accept as number[]) ?? [];
      if (table === null || !accepts.includes(table)) return false;
      const acceptColumns = (data.accept_columns as Record<string, number[]>) ?? {};
      for (const rewrite of (data.rewrites as { column_id: string }[]) ?? []) {
        const column = await currentColumnRevision(ctx, rewrite.column_id);
        const list = acceptColumns[rewrite.column_id];
        if (!list || column === null || !list.includes(column)) return false;
      }
      return true;
    }
    default:
      return false;
  }
}

async function currentCellRevision(ctx: EditContext, rowId: string, columnId: string): Promise<number | null> {
  const r = await ctx.client.query<{ revision: number }>(
    'SELECT revision FROM doc_cells WHERE row_id = $1 AND column_id = $2',
    [rowId, columnId],
  );
  return r.rows[0]?.revision ?? null;
}

async function currentRowRevision(ctx: EditContext, rowId: string): Promise<{ revision: number; deleted: boolean } | null> {
  const r = await ctx.client.query<{ revision: number; deleted: boolean }>(
    'SELECT revision, deleted FROM doc_rows WHERE id = $1',
    [rowId],
  );
  return r.rows[0] ?? null;
}

async function currentColumnRevision(ctx: EditContext, columnId: string): Promise<number | null> {
  const r = await ctx.client.query<{ revision: number }>('SELECT revision FROM doc_columns WHERE id = $1', [columnId]);
  return r.rows[0]?.revision ?? null;
}

async function currentTableRevision(ctx: EditContext, tableId: string): Promise<number | null> {
  const r = await ctx.client.query<{ revision: number }>('SELECT revision FROM doc_tables WHERE id = $1', [tableId]);
  return r.rows[0]?.revision ?? null;
}

/**
 * Apply one stack entry: undo applies the inverse, redo the forward change.
 * The returned outcome carries seeds, directs and touched targets.
 */
async function applyEntry(
  ctx: EditContext,
  entry: EntryRow,
  direction: 'undo' | 'redo',
): Promise<{
  status: number;
  body: Record<string, unknown>;
  historyTableId: string | null;
  seeds: Set<string>;
  directs: Set<string>;
  undo: null;
  newTableIds: string[];
  touchedTargets: import('./edits-core.js').TouchedTarget[];
}> {
  const data = entry.data;
  const kind = entry.kind as string;
  const state = ctx.preState;

  const finish = (
    outcome: {
      status: number;
      body: Record<string, unknown>;
      historyTableId: string | null;
      seeds: Set<string>;
      directs: Set<string>;
      newTableIds: string[];
      touchedTargets: import('./edits-core.js').TouchedTarget[];
    },
  ) => ({ ...outcome, undo: null });

  if (kind === 'cell_write') {
    const value = (direction === 'undo' ? data.before_value : data.after_value) as string | null;
    const outcome = await opWriteCellForUndo(ctx, String(data.table_id), String(data.row_id), String(data.column_id), value ?? null);
    return finish(outcome);
  }
  if (kind === 'cell_batch') {
    const writes = (data.rows as { row_id: string; column_id: string }[]) ?? [];
    const source = direction === 'undo' ? (data.before_values as Record<string, string | null>) : (data.after_values as Record<string, string | null>);
    const outcome = await pasteForUndo(ctx, String(data.table_id), writes.map((w) => ({
      row_id: w.row_id,
      column_id: w.column_id,
      value: source?.[`${w.row_id}:${w.column_id}`] ?? null,
    })));
    return finish(outcome);
  }

  if (kind === 'row_add') {
    if (direction === 'undo') {
      const outcome = await deleteRowForUndo(ctx, String(data.table_id), String(data.row_id));
      return finish({ ...outcome, historyTableId: String(data.table_id) });
    }
    // redo: bring the row back with the same id
    const rowId = String(data.row_id);
    const tableId = String(data.table_id);
    const row = state.rows.get(rowId);
    if (row && row.deleted) {
      const outcome = await restoreRowForUndo(ctx, tableId, rowId);
      return finish({ ...outcome, historyTableId: tableId });
    }
    throw UNDO_CONFLICT();
  }

  if (kind === 'row_delete') {
    const tableId = String(data.table_id);
    const rowId = String(data.row_id);
    if (direction === 'undo') {
      const outcome = await restoreRowForUndo(ctx, tableId, rowId);
      return finish({ ...outcome, historyTableId: tableId });
    }
    const outcome = await deleteRowForUndo(ctx, tableId, rowId);
    return finish({ ...outcome, historyTableId: tableId });
  }

  if (kind === 'column_add') {
    const columnId = String(data.column_id);
    const tableId = String(data.table_id);
    if (direction === 'undo') {
      // delete the column; its cells were blank at creation
      const seeds = new Set<string>();
      for (const row of ctx.view.visibleRows(tableId, state)) seeds.add(nodeKey(row.id, columnId));
      await ctx.client.query('DELETE FROM doc_cells WHERE column_id = $1', [columnId]);
      await ctx.client.query('DELETE FROM doc_columns WHERE id = $1', [columnId]);
      return finish({
        status: 200,
        body: {},
        historyTableId: tableId,
        seeds,
        directs: new Set(),
        newTableIds: [],
        touchedTargets: [],
      });
    }
    // redo: re-add the column blank at its position
    const columnId2 = columnId;
    const exists = state.columnOf(tableId, columnId2);
    if (exists) throw UNDO_CONFLICT();
    const stored = data.column as { name: string; type: string; formula: string | null; target_table_id: string | null; position: number } | undefined;
    const position = stored?.position ?? state.tableColumns(tableId).length + 1;
    await ctx.client.query(
      'INSERT INTO doc_columns (id, table_id, name, type, formula, target_table_id, position, revision) VALUES ($1, $2, $3, $4, $5, $6, $7, 1)',
      [columnId2, tableId, stored?.name ?? data.name ?? 'Column', stored?.type ?? 'text', stored?.formula ?? null, stored?.target_table_id ?? null, position],
    );
    const seeds = new Set<string>();
    if ((stored?.type ?? 'text') !== 'formula') {
      for (const row of ctx.view.visibleRows(tableId, state)) seeds.add(nodeKey(row.id, columnId2));
    }
    return finish({
      status: 200,
      body: {},
      historyTableId: tableId,
      seeds,
      directs: new Set(),
      newTableIds: [],
      touchedTargets: [],
    });
  }

  if (kind === 'column_delete') {
    if (direction === 'undo') {
      const outcome = await restoreColumnForUndo(ctx, data as never);
      return finish(outcome);
    }
    // redo: delete again
    const stored = data.column as { id: string };
    const tableId = String(data.table_id);
    const columnId = stored.id;
    const exists = state.columnOf(tableId, columnId);
    if (!exists) throw UNDO_CONFLICT();
    const seeds = new Set<string>();
    for (const row of ctx.view.visibleRows(tableId, state)) seeds.add(nodeKey(row.id, columnId));
    await ctx.client.query('DELETE FROM doc_cells WHERE column_id = $1', [columnId]);
    await ctx.client.query('DELETE FROM doc_columns WHERE id = $1', [columnId]);
    return finish({
      status: 200,
      body: {},
      historyTableId: tableId,
      seeds,
      directs: new Set(),
      newTableIds: [],
      touchedTargets: [],
    });
  }

  if (kind === 'column_update') {
    return finish(await applyColumnUpdate(ctx, data, direction));
  }

  if (kind === 'table_rename') {
    return finish(await applyTableRename(ctx, data, direction));
  }

  throw UNDO_CONFLICT();
}

/** A cell write made by undo or redo: no revision check, target must exist. */
async function opWriteCellForUndo(
  ctx: EditContext,
  tableId: string,
  rowId: string,
  columnId: string,
  value: string | null,
): Promise<{
  status: number;
  body: Record<string, unknown>;
  historyTableId: string;
  seeds: Set<string>;
  directs: Set<string>;
  newTableIds: string[];
  touchedTargets: import('./edits-core.js').TouchedTarget[];
}> {
  const { row } = resolveWriteTarget(ctx, tableId, rowId, columnId);
  void row;
  const updated = await ctx.client.query<{ revision: number }>(
    `INSERT INTO doc_cells (row_id, column_id, value, revision)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (row_id, column_id) DO UPDATE SET value = $3, revision = doc_cells.revision + 1
     RETURNING revision`,
    [rowId, columnId, value],
  );
  await ctx.client.query('UPDATE doc_rows SET revision = revision + 1 WHERE id = $1', [rowId]);
  return {
    status: 200,
    body: {},
    historyTableId: tableId,
    seeds: new Set([nodeKey(rowId, columnId)]),
    directs: new Set(),
    newTableIds: [],
    touchedTargets: [{ kind: 'cell', id: `${rowId}:${columnId}`, revision: updated.rows[0]!.revision }],
  };
}

/** A paste made by undo or redo: no revision checks. */
async function pasteForUndo(
  ctx: EditContext,
  tableId: string,
  writes: { row_id: string; column_id: string; value: string | null }[],
): Promise<{
  status: number;
  body: Record<string, unknown>;
  historyTableId: string;
  seeds: Set<string>;
  directs: Set<string>;
  newTableIds: string[];
  touchedTargets: import('./edits-core.js').TouchedTarget[];
}> {
  const seeds = new Set<string>();
  const touched: import('./edits-core.js').TouchedTarget[] = [];
  for (const w of writes) {
    const updated = await ctx.client.query<{ revision: number }>(
      `INSERT INTO doc_cells (row_id, column_id, value, revision)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (row_id, column_id) DO UPDATE SET value = $3, revision = doc_cells.revision + 1
       RETURNING revision`,
      [w.row_id, w.column_id, w.value],
    );
    await ctx.client.query('UPDATE doc_rows SET revision = revision + 1 WHERE id = $1', [w.row_id]);
    seeds.add(nodeKey(w.row_id, w.column_id));
    touched.push({ kind: 'cell', id: `${w.row_id}:${w.column_id}`, revision: updated.rows[0]!.revision });
  }
  return {
    status: 200,
    body: {},
    historyTableId: tableId,
    seeds,
    directs: new Set(),
    newTableIds: [],
    touchedTargets: touched,
  };
}

/** Undo or redo of a column update: restore or re-apply the changed fields. */
async function applyColumnUpdate(
  ctx: EditContext,
  data: Record<string, unknown>,
  direction: 'undo' | 'redo',
): Promise<{
  status: number;
  body: Record<string, unknown>;
  historyTableId: string | null;
  seeds: Set<string>;
  directs: Set<string>;
  newTableIds: string[];
  touchedTargets: import('./edits-core.js').TouchedTarget[];
}> {
  const tableId = String(data.table_id);
  const columnId = String(data.column_id);
  const before = data.before as Record<string, unknown>;
  const after = data.after as Record<string, unknown> | undefined;
  const want = direction === 'undo' ? before : (after ?? before);
  const column = ctx.preState.columnOf(tableId, columnId);
  if (!column) throw UNDO_CONFLICT();

  const touched: import('./edits-core.js').TouchedTarget[] = [];
  const seeds = new Set<string>();
  const directs = new Set<string>();

  if (typeof want.name === 'string' && want.name !== column.name) {
    // a restored name that is now taken does not apply
    let taken = false;
    for (const c of ctx.preState.tableColumns(tableId)) {
      if (c.id !== columnId && c.name.toLowerCase() === want.name.toLowerCase()) taken = true;
    }
    if (taken) throw UNDO_CONFLICT();
    const rewrites = rewriteColumnRename(ctx.preState, tableId, direction === 'undo' ? column.name : String(before.name), want.name);
    for (const r of rewrites) {
      await ctx.client.query('UPDATE doc_columns SET formula = $1, revision = revision + 1 WHERE id = $2', [r.after, r.columnId]);
    }
    await ctx.client.query('UPDATE doc_columns SET name = $1, revision = revision + 1 WHERE id = $2', [want.name, columnId]);
    touched.push({ kind: 'column', id: columnId, revision: column.revision + 1 });
    for (const key of nameErrorCells(ctx)) directs.add(key);
  }

  if (typeof want.formula === 'string' || want.formula === null) {
    const newFormula = want.formula ?? null;
    if (newFormula !== column.formula && (newFormula !== null || column.formula !== null)) {
      await ctx.client.query('UPDATE doc_columns SET formula = $1, revision = revision + 1 WHERE id = $2', [newFormula, columnId]);
      touched.push({ kind: 'column', id: columnId, revision: (column.revision + (touched.length > 0 ? 2 : 1)) });
      for (const row of ctx.view.visibleRows(tableId, ctx.preState)) {
        directs.add(nodeKey(row.id, columnId));
      }
    }
  }

  if (typeof want.type === 'string' && want.type !== column.type) {
    await ctx.client.query('UPDATE doc_columns SET type = $1, revision = revision + 1 WHERE id = $2', [want.type, columnId]);
    const cellsBefore = data.cells_before as Record<string, { value: string | null; revision: number }>;
    if (direction === 'undo' && cellsBefore) {
      // restore the stored values exactly
      for (const [rowId, cell] of Object.entries(cellsBefore)) {
        await ctx.client.query(
          'UPDATE doc_cells SET value = $1, revision = $2 WHERE row_id = $3 AND column_id = $4',
          [cell.value, cell.revision, rowId, columnId],
        );
        const row = ctx.preState.rows.get(rowId);
        if (row && !row.deleted) seeds.add(nodeKey(rowId, columnId));
        directs.add(nodeKey(rowId, columnId));
      }
    } else {
      // redo of a type change: blank the cells again, as the change did
      for (const row of ctx.view.visibleRows(tableId, ctx.preState)) {
        await ctx.client.query('UPDATE doc_cells SET value = NULL, revision = revision + 1 WHERE row_id = $1 AND column_id = $2', [row.id, columnId]);
        seeds.add(nodeKey(row.id, columnId));
        directs.add(nodeKey(row.id, columnId));
      }
    }
    touched.push({ kind: 'column', id: columnId, revision: column.revision + 1 });
  }

  return {
    status: 200,
    body: {},
    historyTableId: tableId,
    seeds,
    directs,
    newTableIds: [],
    touchedTargets: touched,
  };
}

/** Undo or redo of a table rename: restore or re-apply name and texts. */
async function applyTableRename(
  ctx: EditContext,
  data: Record<string, unknown>,
  direction: 'undo' | 'redo',
): Promise<{
  status: number;
  body: Record<string, unknown>;
  historyTableId: string | null;
  seeds: Set<string>;
  directs: Set<string>;
  newTableIds: string[];
  touchedTargets: import('./edits-core.js').TouchedTarget[];
}> {
  const tableId = String(data.table_id);
  const table = ctx.preState.tableById(tableId);
  if (!table) throw UNDO_CONFLICT();
  const beforeName = String(data.before_name);
  const afterName = String(data.after_name);
  const rewrites = (data.rewrites as { column_id: string; before: string }[]) ?? [];
  const wantName = direction === 'undo' ? beforeName : afterName;
  if (wantName !== table.name) {
    // a restored name that is now taken does not apply
    let taken = false;
    for (const t of ctx.preState.tables) {
      if (t.id !== tableId && t.name.toLowerCase() === wantName.toLowerCase()) taken = true;
    }
    if (taken) throw UNDO_CONFLICT();
    if (direction === 'undo') {
      for (const r of rewrites) {
        await ctx.client.query('UPDATE doc_columns SET formula = $1, revision = revision + 1 WHERE id = $2', [r.before, r.column_id]);
      }
      await ctx.client.query('UPDATE doc_tables SET name = $1, revision = revision + 1 WHERE id = $2', [wantName, tableId]);
    } else {
      const forward = rewriteTableRename(ctx.preState, table.name, wantName);
      for (const r of forward) {
        await ctx.client.query('UPDATE doc_columns SET formula = $1, revision = revision + 1 WHERE id = $2', [r.after, r.columnId]);
      }
      await ctx.client.query('UPDATE doc_tables SET name = $1, revision = revision + 1 WHERE id = $2', [wantName, tableId]);
    }
  }
  const touched: import('./edits-core.js').TouchedTarget[] = [{ kind: 'table', id: tableId, revision: table.revision + 1 }];
  for (const r of rewrites) {
    const column = findColumnAnywhere(ctx.preState, r.column_id);
    if (column) touched.push({ kind: 'column', id: r.column_id, revision: column.revision + 1 });
  }
  return {
    status: 200,
    body: {},
    historyTableId: tableId,
    seeds: new Set(),
    directs: new Set(nameErrorCells(ctx)),
    newTableIds: [],
    touchedTargets: touched,
  };
}

function findColumnAnywhere(state: DocState, columnId: string) {
  for (const columns of state.tableColumnsMap.values()) {
    const found = columns.find((c) => c.id === columnId);
    if (found) return found;
  }
  return undefined;
}


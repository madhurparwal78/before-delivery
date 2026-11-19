/**
 * The edit operations: cell writes, pastes, rows, columns, tables, summaries
 * and access. Each applies its change and reports its seeds and directs.
 */
import { DocState, Column, Table, Row, newId } from './docstate.js';
import { EditContext, EditOutcome, TouchedTarget } from './edits-core.js';
import { jsonCell, JsonRow, jsonColumn } from './jsoncells.js';
import { evaluateDoc, nodeKey, Evaluator } from './evaluator.js';
import { COPY, ApiError, invalid, notFound, staleRevision } from '../shared/errors.js';
import { RawNumber, parseDecimalText } from '../shared/decimal.js';
import { readFormula, diagText, stripEquals, cpLen } from './formula.js';
import { isValidDate } from './values.js';
import { rewriteColumnRename, rewriteTableRename, Rewrite } from './rename.js';
import { apiColumns } from './names.js';

// ---------------------------------------------------------------------------
// Validation of typed values (one place)
// ---------------------------------------------------------------------------

export function validateValue(
  state: DocState,
  column: Column,
  input: unknown,
  viewParameters: { state: DocState; view: EditContext['view'] },
  field: string,
): string | null {
  const isBlank = (v: unknown): boolean =>
    v === null || v === undefined || (typeof v === 'string' && v === '');
  if (isBlank(input)) return null;
  switch (column.type) {
    case 'text': {
      if (typeof input !== 'string') throw invalid({ [field]: COPY.enterText });
      if ([...input].length > 10000) throw invalid({ [field]: COPY.textTooLong });
      return input;
    }
    case 'decimal': {
      let raw: string | null = null;
      if (input instanceof RawNumber) raw = input.raw;
      else if (typeof input === 'string') raw = input;
      if (raw === null) throw invalid({ [field]: COPY.enterNumber });
      if (/[eE]/.test(raw)) throw invalid({ [field]: COPY.enterNumber });
      const parsed = parseDecimalText(raw);
      if (parsed === null) throw invalid({ [field]: COPY.enterNumber });
      return parsed;
    }
    case 'date': {
      if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input) || !isValidDate(input)) {
        throw invalid({ [field]: COPY.enterDate });
      }
      return input;
    }
    case 'bool': {
      if (typeof input === 'boolean') return input ? 'TRUE' : 'FALSE';
      if (typeof input === 'string') {
        const lower = input.toLowerCase();
        if (lower === 'true') return 'TRUE';
        if (lower === 'false') return 'FALSE';
      }
      throw invalid({ [field]: COPY.enterBool });
    }
    case 'reference': {
      if (typeof input !== 'string') {
        throw invalid({ [field]: COPY.enterReference(state.tableById(column.targetTableId ?? '')?.name ?? '') });
      }
      const targetTable = column.targetTableId ? state.tableById(column.targetTableId) : undefined;
      const targetRow = state.rows.get(input);
      if (
        !targetTable ||
        !targetRow ||
        targetRow.deleted ||
        targetRow.tableId !== targetTable.id ||
        !viewParameters.view.visibleRows(targetTable.id, state).some((r) => r.id === input)
      ) {
        throw invalid({ [field]: COPY.enterReference(targetTable?.name ?? '') });
      }
      return input;
    }
    case 'formula':
      throw invalid({ [field]: COPY.formulaCells });
  }
}

const isBlankValue = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === 'string' && v === '');

/** A revision as sent in JSON: a whole number, never a float. */
export const asRevision = (v: unknown): number | null => {
  if (v instanceof RawNumber) {
    return /^-?\d+$/.test(v.raw) ? parseInt(v.raw, 10) : null;
  }
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
};

// ---------------------------------------------------------------------------
// Names (one place)
// ---------------------------------------------------------------------------

export function validateTableName(state: DocState, name: unknown, selfId: string | null): void {
  if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name)) {
    throw invalid({ name: COPY.tableName });
  }
  const lower = name.toLowerCase();
  for (const t of state.tables) {
    if (t.id !== selfId && t.name.toLowerCase() === lower) {
      throw invalid({ name: COPY.tableDuplicate });
    }
  }
}

export function validateColumnName(state: DocState, tableId: string, name: unknown, selfId: string | null): void {
  if (typeof name !== 'string' || name.length < 1 || name.length > 60 || name.includes('[') || name.includes(']')) {
    throw invalid({ name: COPY.columnName });
  }
  const lower = name.toLowerCase();
  for (const c of state.tableColumns(tableId)) {
    if (c.id !== selfId && c.name.toLowerCase() === lower) {
      throw invalid({ name: COPY.columnDuplicate });
    }
  }
}

export function validateDocumentName(name: unknown): void {
  if (typeof name !== 'string' || name.length < 1 || name.length > 80) {
    throw invalid({ name: COPY.docName });
  }
  for (const ch of name) {
    const code = ch.codePointAt(0)!;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || ch === '\n' || ch === '\r') {
      throw invalid({ name: COPY.docName });
    }
  }
}

/** Read and validate a stored formula; 422 with the located copy. */
export function validateFormula(formula: unknown): string {
  if (typeof formula !== 'string' || cpLen(formula) > 2000) {
    throw invalid({ formula: COPY.formulaTooLong });
  }
  if (formula.length === 0) {
    throw invalid({ formula: COPY.formulaTooEarly });
  }
  const read = readFormula(formula);
  if (!read.ast) {
    throw invalid({ formula: diagText(read.diag!) });
  }
  return stripEquals(formula);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Every reference cell in the document pointing at a given row id. */
export function referencesTo(state: DocState, rowId: string): { rowId: string; columnId: string }[] {
  const out: { rowId: string; columnId: string }[] = [];
  for (const [key, cell] of state.cells) {
    if (cell.value !== rowId) continue;
    const [rid, cid] = key.split('\u0000');
    const row = state.rows.get(rid!);
    if (!row || row.deleted) continue;
    const column = state.columnOf(row.tableId, cid!);
    if (column?.type !== 'reference') continue;
    out.push({ rowId: rid!, columnId: cid! });
  }
  return out;
}

const cellCurrent = async (client: EditContext['client'], rowId: string, columnId: string): Promise<{ value: string | null; revision: number }> => {
  const r = await client.query<{ value: string | null; revision: number }>(
    'SELECT value, revision FROM doc_cells WHERE row_id = $1 AND column_id = $2',
    [rowId, columnId],
  );
  return r.rows[0] ?? { value: null, revision: 1 };
};

/** Look up table, column and row for a write, with 404s and visibility. */
export function resolveWriteTarget(
  ctx: EditContext,
  tableId: string,
  rowId: string,
  columnId: string,
): { table: Table; row: Row; column: Column } {
  const table = ctx.preState.tableById(tableId);
  if (!table) throw notFound();
  if (table.kind === 'summary') throw invalid({ table: COPY.summaryNoEdit });
  const column = ctx.preState.columnOf(tableId, columnId);
  if (!column) throw notFound();
  const row = ctx.preState.rows.get(rowId);
  if (!row || row.deleted || row.tableId !== tableId) throw notFound();
  if (!ctx.view.visibleRows(tableId, ctx.preState).some((r) => r.id === rowId)) throw notFound();
  return { table, row, column };
}

/** The current cells of a whole table's worth of writes, for 409 bodies. */
async function currentCellJsons(
  ctx: EditContext,
  targets: { rowId: string; columnId: string; tableId: string }[],
): Promise<Map<string, unknown>> {
  const state = await DocState.load(ctx.client, ctx.documentId);
  const ev = evaluateDoc(state, ctx.view);
  const out = new Map<string, unknown>();
  for (const t of targets) {
    const column = state.columnOf(t.tableId, t.columnId);
    const row = state.rows.get(t.rowId);
    if (!column || !row) continue;
    out.set(`${t.rowId}:${t.columnId}`, jsonCell(state, column, row, ev));
  }
  return out;
}

/** A member with own-row scope may only write their own email in the owner cell. */
function validateOwnerValue(input: unknown, email: string, field: string): string | null {
  if (isBlankValue(input)) return null;
  if (typeof input !== 'string') throw invalid({ [field]: COPY.enterText });
  if (input.trim().toLowerCase() !== email.toLowerCase()) {
    throw invalid({ [field]: COPY.ownRowsOnly });
  }
  return input;
}

/** Formula cells that currently show #NAME!, candidates for direct cells. */
export function nameErrorCells(ctx: EditContext): Set<string> {
  const ev = new Evaluator(ctx.preState, ctx.view).run();
  const out = new Set<string>();
  for (const [key, computed] of ev.cells) {
    if (computed.kind === 'error' && computed.display === '#NAME?') out.add(key);
  }
  return out;
}

async function bumpRowRevision(client: EditContext['client'], rowId: string): Promise<void> {
  await client.query('UPDATE doc_rows SET revision = revision + 1 WHERE id = $1', [rowId]);
}

// ---------------------------------------------------------------------------
// Cell write
// ---------------------------------------------------------------------------

export async function opWriteCell(
  ctx: EditContext,
  tableId: string,
  rowId: string,
  columnId: string,
  rawValue: unknown,
  revision: unknown,
): Promise<EditOutcome> {
  const { table, column } = resolveWriteTarget(ctx, tableId, rowId, columnId);
  const fields: Record<string, string> = {};
  const revisionNumber = asRevision(revision);
  let stale = false;
  if (revisionNumber !== null) {
    const current = await cellCurrent(ctx.client, rowId, columnId);
    stale = revisionNumber !== current.revision;
  }
  if (stale) {
    const currents = await currentCellJsons(ctx, [{ rowId, columnId, tableId }]);
    throw staleRevision({ current: currents.get(`${rowId}:${columnId}`) });
  }
  if (revisionNumber === null) {
    fields.revision = COPY.sendCellRevision;
  }
  const ownScope = ctx.access.rowScope === 'own' && ctx.access.role !== 'owner';
  let stored: string | null;
  if (ownScope && table.ownerColumnId === columnId) {
    stored = validateOwnerValue(rawValue, ctx.person.email, 'value');
  } else {
    stored = validateValue(ctx.preState, column, rawValue, { state: ctx.preState, view: ctx.view }, 'value');
  }
  if (Object.keys(fields).length > 0) throw invalid(fields);

  const before = await cellCurrent(ctx.client, rowId, columnId);
  const updated = await ctx.client.query<{ revision: number }>(
    `INSERT INTO doc_cells (row_id, column_id, value, revision)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (row_id, column_id) DO UPDATE SET value = $3, revision = doc_cells.revision + 1
     RETURNING revision`,
    [rowId, columnId, stored],
  );
  const afterRevision = updated.rows[0]!.revision;
  await bumpRowRevision(ctx.client, rowId);
  const currents = await currentCellJsons(ctx, [{ rowId, columnId, tableId }]);
  const cellJson = currents.get(`${rowId}:${columnId}`)!;
  return {
    status: 200,
    body: { cell: cellJson },
    historyKind: 'cell_write',
    historyTableId: tableId,
    seeds: new Set([nodeKey(rowId, columnId)]),
    directs: new Set(),
    undo: {
      kind: 'cell_write',
      data: {
        table_id: tableId,
        row_id: rowId,
        column_id: columnId,
        before_value: before.value,
        after_value: stored,
        accept_cell: [afterRevision],
      },
    },
    newTableIds: [],
    touchedTargets: [{ kind: 'cell', id: `${rowId}:${columnId}`, revision: afterRevision }],
  };
}

// ---------------------------------------------------------------------------
// Paste
// ---------------------------------------------------------------------------

export interface PasteWrite {
  row_id: unknown;
  column_id: unknown;
  value: unknown;
  revision: unknown;
}

export async function opPaste(ctx: EditContext, tableId: string, writes: PasteWrite[]): Promise<EditOutcome> {
  if (writes.length < 1 || writes.length > 500) {
    throw invalid({ writes: COPY.pasteWrites });
  }
  const seen = new Set<string>();
  for (const w of writes) {
    if (typeof w.row_id !== 'string' || typeof w.column_id !== 'string') {
      throw invalid({ writes: COPY.pasteWrites });
    }
    const key = `${w.row_id}:${w.column_id}`;
    if (seen.has(key)) throw invalid({ writes: COPY.pasteDuplicate });
    seen.add(key);
  }
  const table = ctx.preState.tableById(tableId);
  if (!table) throw notFound();
  if (table.kind === 'summary') throw invalid({ table: COPY.summaryNoEdit });

  const targets: { row: Row; column: Column; write: PasteWrite }[] = [];
  for (const w of writes) {
    const { row, column } = resolveWriteTarget(ctx, tableId, w.row_id as string, w.column_id as string);
    targets.push({ row, column, write: w });
  }

  // 409 stale revisions first, listing every stale write in request order
  const staleTargets: { rowId: string; columnId: string }[] = [];
  for (const t of targets) {
    const revisionNumber = asRevision(t.write.revision);
    if (revisionNumber !== null) {
      const current = await cellCurrent(ctx.client, t.row.id, t.column.id);
      if (revisionNumber !== current.revision) {
        staleTargets.push({ rowId: t.row.id, columnId: t.column.id });
      }
    }
  }
  if (staleTargets.length > 0) {
    const currents = await currentCellJsons(
      ctx,
      staleTargets.map((s) => ({ ...s, tableId })),
    );
    const first = staleTargets[0]!;
    throw staleRevision(
      {
        current: currents.get(`${first.rowId}:${first.columnId}`),
        conflicts: staleTargets.map((s) => ({
          row_id: s.rowId,
          column_id: s.columnId,
          current: currents.get(`${s.rowId}:${s.columnId}`),
        })),
      },
    );
  }

  // then 422s: missing revisions and invalid values, merged
  const fields: Record<string, string> = {};
  const stored: { rowId: string; columnId: string; value: string | null }[] = [];
  const ownScope = ctx.access.rowScope === 'own' && ctx.access.role !== 'owner';
  for (const t of targets) {
    const field = `${t.row.id}:${t.column.id}`;
    if (asRevision(t.write.revision) === null) {
      fields[field] = COPY.sendCellRevision;
      continue;
    }
    try {
      if (ownScope && table.ownerColumnId === t.column.id) {
        stored.push({ rowId: t.row.id, columnId: t.column.id, value: validateOwnerValue(t.write.value, ctx.person.email, field) });
      } else {
        stored.push({
          rowId: t.row.id,
          columnId: t.column.id,
          value: validateValue(ctx.preState, t.column, t.write.value, { state: ctx.preState, view: ctx.view }, field),
        });
      }
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        Object.assign(fields, err.fields);
      } else {
        throw err;
      }
    }
  }
  if (Object.keys(fields).length > 0) throw invalid(fields);

  // apply all writes
  const seeds = new Set<string>();
  const acceptCells: Record<string, number[]> = {};
  const touched: TouchedTarget[] = [];
  const beforeValues: Record<string, string | null> = {};
  const afterValues: Record<string, string | null> = {};
  for (const s of stored) {
    const prior = await cellCurrent(ctx.client, s.rowId, s.columnId);
    beforeValues[`${s.rowId}:${s.columnId}`] = prior.value;
    const updated = await ctx.client.query<{ revision: number }>(
      `INSERT INTO doc_cells (row_id, column_id, value, revision)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (row_id, column_id) DO UPDATE SET value = $3, revision = doc_cells.revision + 1
       RETURNING revision`,
      [s.rowId, s.columnId, s.value],
    );
    const rev = updated.rows[0]!.revision;
    acceptCells[`${s.rowId}:${s.columnId}`] = [rev];
    afterValues[`${s.rowId}:${s.columnId}`] = s.value;
    seeds.add(nodeKey(s.rowId, s.columnId));
    touched.push({ kind: 'cell', id: `${s.rowId}:${s.columnId}`, revision: rev });
    await bumpRowRevision(ctx.client, s.rowId);
  }
  const currents = await currentCellJsons(ctx, stored.map((s) => ({ rowId: s.rowId, columnId: s.columnId, tableId })));
  const cells = stored.map((s) => ({
    row_id: s.rowId,
    column_id: s.columnId,
    cell: currents.get(`${s.rowId}:${s.columnId}`)!,
  }));
  return {
    status: 200,
    body: { cells },
    historyKind: 'cell_batch',
    historyTableId: tableId,
    seeds,
    directs: new Set(),
    undo: {
      kind: 'cell_batch',
      data: {
        table_id: tableId,
        rows: stored.map((s) => ({ row_id: s.rowId, column_id: s.columnId })),
        before_values: beforeValues,
        after_values: afterValues,
        accept_cells: acceptCells,
      },
    },
    newTableIds: [],
    touchedTargets: touched,
  };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export async function opAddRow(
  ctx: EditContext,
  tableId: string,
  cells: Record<string, unknown>,
): Promise<EditOutcome> {
  const table = ctx.preState.tableById(tableId);
  if (!table) throw notFound();
  if (table.kind === 'summary') throw invalid({ table: COPY.summaryNoEdit });
  const ownScope = ctx.access.rowScope === 'own' && ctx.access.role !== 'owner';
  const columns = ctx.preState.tableColumns(tableId);
  // validate every provided cell first
  const fields: Record<string, string> = {};
  for (const column of columns) {
    if (column.type === 'formula') continue;
    const input = cells[column.id];
    if (isBlankValue(input)) continue;
    try {
      if (ownScope && table.ownerColumnId === column.id) {
        validateOwnerValue(input, ctx.person.email, column.id);
      } else {
        validateValue(ctx.preState, column, input, { state: ctx.preState, view: ctx.view }, column.id);
      }
    } catch (err) {
      if (err instanceof ApiError && err.fields) Object.assign(fields, err.fields);
      else throw err;
    }
  }
  if (Object.keys(fields).length > 0) throw invalid(fields);

  const rowId = newId();
  const position = ctx.preState.nextRowPosition(tableId);
  await ctx.client.query(
    'INSERT INTO doc_rows (id, table_id, position, revision, deleted) VALUES ($1, $2, $3, 1, FALSE)',
    [rowId, tableId, position],
  );
  const seeds = new Set<string>();
  for (const column of columns) {
    if (column.type === 'formula') continue;
    const input = cells[column.id];
    let value: string | null = null;
    if (ownScope && table.ownerColumnId === column.id) {
      value = isBlankValue(input) ? ctx.person.email : (input as string);
    } else if (!isBlankValue(input)) {
      value = validateValue(ctx.preState, column, input, { state: ctx.preState, view: ctx.view }, column.id);
    }
    await ctx.client.query(
      'INSERT INTO doc_cells (row_id, column_id, value, revision) VALUES ($1, $2, $3, 1) ON CONFLICT (row_id, column_id) DO NOTHING',
      [rowId, column.id, value],
    );
    seeds.add(nodeKey(rowId, column.id));
  }
  const state = await DocState.load(ctx.client, ctx.documentId);
  const ev = evaluateDoc(state, ctx.view);
  const row = state.rows.get(rowId)!;
  const rowJson: JsonRow = {
    id: rowId,
    revision: row.revision,
    cells: Object.fromEntries(state.tableColumns(tableId).map((c) => [c.id, jsonCell(state, c, row, ev)])),
  };
  return {
    status: 201,
    body: { row: rowJson },
    historyKind: 'row_add',
    historyTableId: tableId,
    seeds,
    directs: new Set(),
    undo: { kind: 'row_add', data: { table_id: tableId, row_id: rowId, accept: [1] } },
    newTableIds: [],
    touchedTargets: [],
  };
}

export async function opDeleteRow(ctx: EditContext, tableId: string, rowId: string, revision: unknown): Promise<EditOutcome> {
  const table = ctx.preState.tableById(tableId);
  if (!table) throw notFound();
  if (table.kind === 'summary') throw invalid({ table: COPY.summaryNoEdit });
  const row = ctx.preState.rows.get(rowId);
  if (!row || row.deleted || row.tableId !== tableId) throw notFound();
  if (!ctx.view.visibleRows(tableId, ctx.preState).some((r) => r.id === rowId)) throw notFound();
  const revisionNumber = asRevision(revision);
  if (revisionNumber === null) {
    throw invalid({ revision: COPY.sendRowRevision });
  }
  const current = await ctx.client.query<{ revision: number }>(
    'SELECT revision FROM doc_rows WHERE id = $1',
    [rowId],
  );
  if (current.rows[0]?.revision !== revisionNumber) {
    const state = await DocState.load(ctx.client, ctx.documentId);
    const r = state.rows.get(rowId)!;
    const ev = evaluateDoc(state, ctx.view);
    throw staleRevision({
      current: {
        row: {
          id: rowId,
          revision: r.revision,
          cells: Object.fromEntries(
            state.tableColumns(tableId).map((c) => [c.id, jsonCell(state, c, r, ev)]),
          ),
        },
      },
    });
  }
  const seeds = new Set<string>();
  for (const column of ctx.preState.tableColumns(tableId)) {
    seeds.add(nodeKey(rowId, column.id));
  }
  const refs = referencesTo(ctx.preState, rowId);
  const directs = new Set<string>(refs.map((r) => nodeKey(r.rowId, r.columnId)));
  await ctx.client.query('UPDATE doc_rows SET deleted = TRUE WHERE id = $1', [rowId]);
  return {
    status: 200,
    body: {},
    historyKind: 'row_delete',
    historyTableId: tableId,
    seeds,
    directs,
    undo: { kind: 'row_delete', data: { table_id: tableId, row_id: rowId, accept: [revisionNumber] } },
    newTableIds: [],
    touchedTargets: [],
  };
}

/** A row delete made by undo of a row add; no revision check. */
export async function deleteRowForUndo(ctx: EditContext, tableId: string, rowId: string): Promise<EditOutcome> {
  const seeds = new Set<string>();
  for (const column of ctx.preState.tableColumns(tableId)) {
    seeds.add(nodeKey(rowId, column.id));
  }
  const refs = referencesTo(ctx.preState, rowId);
  const directs = new Set<string>(refs.map((r) => nodeKey(r.rowId, r.columnId)));
  await ctx.client.query('UPDATE doc_rows SET deleted = TRUE WHERE id = $1', [rowId]);
  return {
    status: 200,
    body: {},
    historyKind: 'undo',
    historyTableId: tableId,
    seeds,
    directs,
    undo: null,
    newTableIds: [],
    touchedTargets: [],
  };
}

/** Restore a row for undo or redo of a row delete. */
export async function restoreRowForUndo(ctx: EditContext, tableId: string, rowId: string): Promise<EditOutcome> {
  const row = ctx.preState.rows.get(rowId);
  if (!row || !row.deleted) throw notFound();
  const seeds = new Set<string>();
  for (const column of ctx.preState.tableColumns(tableId)) {
    if (column.type !== 'formula') seeds.add(nodeKey(rowId, column.id));
  }
  const refs = referencesTo(ctx.preState, rowId);
  const directs = new Set<string>();
  const touched: TouchedTarget[] = [];
  for (const ref of refs) {
    const updated = await ctx.client.query<{ revision: number }>(
      'UPDATE doc_cells SET revision = revision + 1 WHERE row_id = $1 AND column_id = $2 RETURNING revision',
      [ref.rowId, ref.columnId],
    );
    await bumpRowRevision(ctx.client, ref.rowId);
    directs.add(nodeKey(ref.rowId, ref.columnId));
    touched.push({ kind: 'cell', id: `${ref.rowId}:${ref.columnId}`, revision: updated.rows[0]!.revision });
  }
  await ctx.client.query('UPDATE doc_rows SET deleted = FALSE WHERE id = $1', [rowId]);
  return {
    status: 200,
    body: {},
    historyKind: 'undo',
    historyTableId: tableId,
    seeds,
    directs,
    undo: null,
    newTableIds: [],
    touchedTargets: touched,
  };
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export async function opAddColumn(
  ctx: EditContext,
  tableId: string,
  body: { name: unknown; type: unknown; target_table_id?: unknown; formula?: unknown },
): Promise<EditOutcome> {
  const table = ctx.preState.tableById(tableId);
  if (!table || table.kind === 'summary') {
    throw table ? invalid({ table: COPY.summaryNoEdit }) : notFound();
  }
  validateColumnName(ctx.preState, tableId, body.name, null);
  const type = body.type;
  if (typeof type !== 'string' || !['text', 'decimal', 'date', 'bool', 'reference', 'formula'].includes(type)) {
    throw invalid({ type: 'Choose a column type.' });
  }
  let targetTableId: string | null = null;
  let formula: string | null = null;
  if (type === 'reference') {
    if (typeof body.target_table_id !== 'string' || !ctx.preState.tableById(body.target_table_id)) {
      throw invalid({ target_table_id: 'Choose a target table.' });
    }
    const target = ctx.preState.tableById(body.target_table_id)!;
    if (target.kind === 'summary') throw invalid({ target_table_id: 'Choose a target table.' });
    targetTableId = target.id;
    if (body.formula !== undefined && body.formula !== null) {
      throw invalid({ formula: 'Formula columns cannot have a target table.' });
    }
  }
  if (type === 'formula') {
    formula = validateFormula(body.formula ?? '');
    if (body.target_table_id !== undefined && body.target_table_id !== null) {
      throw invalid({ target_table_id: 'Formula columns cannot have a target table.' });
    }
  }
  if (type !== 'formula' && type !== 'reference' && (body.formula !== undefined && body.formula !== null)) {
    throw invalid({ formula: 'Only Formula columns take a formula.' });
  }
  const columnId = newId();
  const position = ctx.preState.tableColumns(tableId).length + 1;
  await ctx.client.query(
    'INSERT INTO doc_columns (id, table_id, name, type, formula, target_table_id, position, revision) VALUES ($1, $2, $3, $4, $5, $6, $7, 1)',
    [columnId, tableId, body.name as string, type, formula, targetTableId, position],
  );
  const seeds = new Set<string>();
  if (type !== 'formula') {
    for (const row of ctx.view.visibleRows(tableId, ctx.preState)) {
      seeds.add(nodeKey(row.id, columnId));
    }
  }
  const state = await DocState.load(ctx.client, ctx.documentId);
  const column = state.columnOf(tableId, columnId)!;
  const directs = new Set<string>();
  if (type === 'formula') {
    // the new column's cells are direct cells
    for (const row of ctx.view.visibleRows(tableId, state)) {
      directs.add(nodeKey(row.id, columnId));
    }
  } else {
    // formulas that now resolve because of this column are direct cells
    for (const key of nameErrorCells(ctx)) directs.add(key);
  }
  return {
    status: 201,
    body: { column: jsonColumn(column) },
    historyKind: 'column_add',
    historyTableId: tableId,
    seeds,
    directs,
    undo: {
      kind: 'column_add',
      data: {
        table_id: tableId,
        column_id: columnId,
        accept: [1],
        column: { name: body.name as string, type, formula, target_table_id: targetTableId, position },
      },
    },
    newTableIds: [],
    touchedTargets: [],
  };
}

export async function opUpdateColumn(
  ctx: EditContext,
  tableId: string,
  columnId: string,
  body: { revision: unknown; name?: unknown; type?: unknown; formula?: unknown },
  isUndoRedo: boolean,
): Promise<EditOutcome> {
  const table = ctx.preState.tableById(tableId);
  if (!table || table.kind === 'summary') {
    throw table ? invalid({ table: COPY.summaryNoEdit }) : notFound();
  }
  const column = ctx.preState.columnOf(tableId, columnId);
  if (!column) throw notFound();
  if (!isUndoRedo) {
    const revisionNumber = asRevision(body.revision);
    if (revisionNumber === null) {
      throw invalid({ revision: COPY.sendColumnRevision });
    }
    const current = await ctx.client.query<{ revision: number; name: string; type: string; formula: string | null }>(
      'SELECT revision, name, type, formula FROM doc_columns WHERE id = $1',
      [columnId],
    );
    if (current.rows[0]?.revision !== revisionNumber) {
      const state = await DocState.load(ctx.client, ctx.documentId);
      throw staleRevision({ current: { column: jsonColumn(state.columnOf(tableId, columnId)!) } });
    }
    if (ctx.access.role === 'editor' && (body.name !== undefined || body.type !== undefined)) {
      throw new ApiError(403, 'forbidden', 'You may not take this action.');
    }
  }

  const before = { name: column.name, type: column.type, formula: column.formula, targetTableId: column.targetTableId };
  const after: { name?: string; type?: string; formula?: string | null; targetTableId?: string | null } = {};
  const fields: Record<string, string> = {};

  if (body.name !== undefined) {
    try {
      validateColumnName(ctx.preState, tableId, body.name, columnId);
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        Object.assign(fields, err.fields);
      } else throw err;
    }
    if (Object.keys(fields).length === 0) after.name = body.name as string;
  }
  if (body.type !== undefined) {
    if (typeof body.type !== 'string' || !['text', 'decimal', 'date', 'bool'].includes(body.type)) {
      if (typeof body.type === 'string' && ['reference', 'formula'].includes(body.type)) {
        fields.type = COPY.typeCannotChange;
      } else {
        fields.type = 'Choose a column type.';
      }
    } else if (column.type === 'formula' || column.type === 'reference') {
      fields.type = COPY.typeCannotChange;
    } else if (body.type !== column.type) {
      after.type = body.type;
    }
  }
  if (body.formula !== undefined) {
    if (column.type !== 'formula') {
      fields.formula = 'Only Formula columns take a formula.';
    } else {
      try {
        after.formula = validateFormula(body.formula ?? '');
      } catch (err) {
        if (err instanceof ApiError && err.fields) {
          Object.assign(fields, err.fields);
        } else throw err;
      }
    }
  }
  if (Object.keys(fields).length > 0) throw invalid(fields);

  const touched: TouchedTarget[] = [];
  const seeds = new Set<string>();
  const directs = new Set<string>();
  let undoData: Record<string, unknown> | null = null;

  if (after.name !== undefined && after.name !== before.name) {
    const rewrites: Rewrite[] = rewriteColumnRename(ctx.preState, tableId, before.name, after.name);
    for (const r of rewrites) {
      await ctx.client.query('UPDATE doc_columns SET formula = $1, revision = revision + 1 WHERE id = $2', [r.after, r.columnId]);
    }
    await ctx.client.query('UPDATE doc_columns SET name = $1, revision = revision + 1 WHERE id = $2', [after.name, columnId]);
    touched.push({ kind: 'column', id: columnId, revision: column.revision + 1 });
    for (const r of rewrites) {
      const target = findColumnTable(ctx.preState, r.columnId);
      if (target) touched.push({ kind: 'column', id: r.columnId, revision: ctx.preState.columnOf(target, r.columnId)!.revision + 1 });
    }
    // formulas that now resolve are direct cells
    for (const key of nameErrorCells(ctx)) directs.add(key);
    undoData = {
      table_id: tableId,
      column_id: columnId,
      before: { name: before.name, formula: before.formula },
      rewrites: rewrites.map((r) => ({ column_id: r.columnId, before: r.before, after: r.after })),
      accept: [column.revision + 1],
      accept_columns: Object.fromEntries(rewrites.map((r) => {
        const target = findColumnTable(ctx.preState, r.columnId);
        return [r.columnId, [ctx.preState.columnOf(target ?? '', r.columnId)!.revision + 1]];
      })),
    };
  }
  if (after.type !== undefined) {
    // convert each non-blank cell from its old display text
    const converted = await convertColumnCells(ctx, tableId, columnId, before.type, after.type);
    for (const c of converted.cells) seeds.add(nodeKey(c.rowId, columnId));
    for (const c of converted.cells) directs.add(nodeKey(c.rowId, columnId));
    await ctx.client.query('UPDATE doc_columns SET type = $1, revision = revision + 1 WHERE id = $2', [after.type, columnId]);
    touched.push({ kind: 'column', id: columnId, revision: column.revision + 1 });
    undoData = {
      table_id: tableId,
      column_id: columnId,
      before: { type: before.type, cells: converted.before },
      accept: [column.revision + 1],
      cells_before: converted.before,
    };
  }
  if (after.formula !== undefined) {
    await ctx.client.query('UPDATE doc_columns SET formula = $1, revision = revision + 1 WHERE id = $2', [after.formula, columnId]);
    touched.push({ kind: 'column', id: columnId, revision: column.revision + 1 });
    // every cell of a formula column whose formula changed is a direct cell
    for (const row of ctx.view.visibleRows(tableId, ctx.preState)) {
      directs.add(nodeKey(row.id, columnId));
    }
    undoData = {
      table_id: tableId,
      column_id: columnId,
      before: { formula: before.formula },
      accept: [column.revision + 1],
    };
  }

  const state = await DocState.load(ctx.client, ctx.documentId);
  const updated = state.columnOf(tableId, columnId)!;
  return {
    status: 200,
    body: { column: jsonColumn(updated) },
    historyKind: 'column_update',
    historyTableId: tableId,
    seeds,
    directs,
    undo: undoData ? { kind: 'column_update', data: undoData } : null,
    newTableIds: [],
    touchedTargets: touched,
  };
}

function findColumnTable(state: DocState, columnId: string): string | null {
  for (const [tableId, columns] of state.tableColumnsMap) {
    if (columns.some((c) => c.id === columnId)) return tableId;
  }
  return null;
}

/** Convert a data column's cells to a new type, from their old display text. */
async function convertColumnCells(
  ctx: EditContext,
  tableId: string,
  columnId: string,
  fromType: string,
  toType: string,
): Promise<{ cells: { rowId: string; value: string | null }[]; before: Record<string, { value: string | null; revision: number }> }> {
  const rows = await ctx.client.query<{ row_id: string; value: string | null; revision: number }>(
    'SELECT row_id, value, revision FROM doc_cells WHERE column_id = $1',
    [columnId],
  );
  const before: Record<string, { value: string | null; revision: number }> = {};
  const cells: { rowId: string; value: string | null }[] = [];
  for (const r of rows.rows) {
    before[r.row_id] = { value: r.value, revision: r.revision };
    if (r.value === null) continue;
    const row = ctx.preState.rows.get(r.row_id);
    if (!row || row.deleted) continue;
    const oldDisplay = r.value;
    const trimmed = oldDisplay.trim();
    let next: string | null = null;
    switch (toType) {
      case 'text':
        next = oldDisplay;
        break;
      case 'bool':
        next = ['true', 'True', 'TRUE'].includes(trimmed) ? 'TRUE' : ['false', 'False', 'FALSE'].includes(trimmed) ? 'FALSE' : null;
        break;
      case 'decimal':
        next = parseDecimalText(trimmed);
        break;
      case 'date':
        next = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) && isValidDate(trimmed) ? trimmed : null;
        break;
    }
    await ctx.client.query(
      'UPDATE doc_cells SET value = $1, revision = revision + 1 WHERE row_id = $2 AND column_id = $3',
      [next, r.row_id, columnId],
    );
    await bumpRowRevision(ctx.client, r.row_id);
    cells.push({ rowId: r.row_id, value: next });
  }
  void fromType;
  return { cells, before };
}

export async function opDeleteColumn(ctx: EditContext, tableId: string, columnId: string): Promise<EditOutcome> {
  const table = ctx.preState.tableById(tableId);
  if (!table || table.kind === 'summary') {
    throw table ? invalid({ table: COPY.summaryNoEdit }) : notFound();
  }
  const column = ctx.preState.columnOf(tableId, columnId);
  if (!column) throw notFound();
  // protected columns: in a summary first, then the row owner
  let inSummary = false;
  for (const t of ctx.preState.tables) {
    if (t.kind !== 'summary' || t.sourceTableId !== tableId) continue;
    if (t.groupBy.includes(columnId) || t.sumColumns.includes(columnId)) inSummary = true;
  }
  if (inSummary) throw new ApiError(409, 'column_in_summary', 'This column is used by a summary.');
  if (table.ownerColumnId === columnId) {
    throw new ApiError(409, 'column_is_row_owner', 'This column marks row owners.');
  }
  const cells = await ctx.client.query<{ row_id: string; value: string | null; revision: number }>(
    'SELECT row_id, value, revision FROM doc_cells WHERE column_id = $1',
    [columnId],
  );
  const seeds = new Set<string>();
  for (const row of ctx.view.visibleRows(tableId, ctx.preState)) {
    seeds.add(nodeKey(row.id, columnId));
  }
  await ctx.client.query('DELETE FROM doc_cells WHERE column_id = $1', [columnId]);
  await ctx.client.query('DELETE FROM doc_columns WHERE id = $1', [columnId]);
  return {
    status: 200,
    body: {},
    historyKind: 'column_delete',
    historyTableId: tableId,
    seeds,
    directs: new Set(),
    undo: {
      kind: 'column_delete',
      data: {
        table_id: tableId,
        column: { id: columnId, name: column.name, type: column.type, formula: column.formula, target_table_id: column.targetTableId, position: column.position, revision: column.revision },
        cells: cells.rows.map((c) => ({ row_id: c.row_id, value: c.value, revision: c.revision })),
      },
    },
    newTableIds: [],
    touchedTargets: [],
  };
}

/** Restore a deleted column for undo. */
export async function restoreColumnForUndo(
  ctx: EditContext,
  data: {
    table_id: string;
    column: { id: string; name: string; type: string; formula: string | null; target_table_id: string | null; position: number; revision: number };
    cells: { row_id: string; value: string | null; revision: number }[];
  },
): Promise<EditOutcome> {
  const exists = ctx.preState.columnOf(data.table_id, data.column.id);
  if (exists) throw new ApiError(409, 'undo_conflict', 'This undo no longer applies.');
  await ctx.client.query(
    'INSERT INTO doc_columns (id, table_id, name, type, formula, target_table_id, position, revision) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [data.column.id, data.table_id, data.column.name, data.column.type, data.column.formula, data.column.target_table_id, data.column.position, data.column.revision + 1],
  );
  for (const c of data.cells) {
    await ctx.client.query(
      'INSERT INTO doc_cells (row_id, column_id, value, revision) VALUES ($1, $2, $3, $4) ON CONFLICT (row_id, column_id) DO NOTHING',
      [c.row_id, data.column.id, c.value, c.revision],
    );
  }
  const seeds = new Set<string>();
  for (const c of data.cells) {
    const row = ctx.preState.rows.get(c.row_id);
    if (row && !row.deleted) seeds.add(nodeKey(c.row_id, data.column.id));
  }
  const directs = new Set<string>(nameErrorCells(ctx));
  return {
    status: 200,
    body: {},
    historyKind: 'undo',
    historyTableId: data.table_id,
    seeds,
    directs,
    undo: null,
    newTableIds: [],
    touchedTargets: [{ kind: 'column', id: data.column.id, revision: data.column.revision + 1 }],
  };
}

// ---------------------------------------------------------------------------
// Tables, summaries, access
// ---------------------------------------------------------------------------

export async function opCreateTable(ctx: EditContext, name: unknown): Promise<EditOutcome> {
  validateTableName(ctx.preState, name, null);
  const tableId = newId();
  const position = ctx.preState.tables.length + 1;
  await ctx.client.query(
    "INSERT INTO doc_tables (id, document_id, name, kind, position, source_table_id, revision, owner_column_id, group_by, sum_columns) VALUES ($1, $2, $3, 'table', $4, NULL, 1, NULL, '[]'::jsonb, '[]'::jsonb)",
    [tableId, ctx.documentId, name as string, position],
  );
  const state = await DocState.load(ctx.client, ctx.documentId);
  const table = state.tableById(tableId)!;
  return {
    status: 201,
    body: {
      table: {
        id: table.id,
        name: table.name,
        kind: table.kind,
        revision: table.revision,
        owner_column_id: table.ownerColumnId,
        columns: [],
        rows: [],
      },
    },
    historyKind: 'table_add',
    historyTableId: tableId,
    seeds: new Set(),
    directs: new Set(),
    undo: null,
    newTableIds: [tableId],
    touchedTargets: [],
  };
}

export async function opRenameTable(ctx: EditContext, tableId: string, name: unknown, revision: unknown): Promise<EditOutcome> {
  const table = ctx.preState.tableById(tableId);
  if (!table) throw notFound();
  if (table.kind === 'summary') throw invalid({ table: COPY.summaryRename });
  const revisionNumber = asRevision(revision);
  if (revisionNumber === null) {
    throw invalid({ revision: COPY.sendTableRevision });
  }
  const current = await ctx.client.query<{ revision: number; name: string }>(
    'SELECT revision, name FROM doc_tables WHERE id = $1',
    [tableId],
  );
  if (current.rows[0]?.revision !== revisionNumber) {
    throw staleRevision({ current: { table: { id: tableId, name: current.rows[0]?.name ?? table.name, revision: current.rows[0]?.revision ?? table.revision } } });
  }
  validateTableName(ctx.preState, name, tableId);
  const rewrites = rewriteTableRename(ctx.preState, table.name, name as string);
  const touched: TouchedTarget[] = [{ kind: 'table', id: tableId, revision: table.revision + 1 }];
  for (const r of rewrites) {
    await ctx.client.query('UPDATE doc_columns SET formula = $1, revision = revision + 1 WHERE id = $2', [r.after, r.columnId]);
    const target = findColumnTable(ctx.preState, r.columnId);
    if (target) {
      const col = ctx.preState.columnOf(target, r.columnId)!;
      touched.push({ kind: 'column', id: r.columnId, revision: col.revision + 1 });
    }
  }
  await ctx.client.query('UPDATE doc_tables SET name = $1, revision = revision + 1 WHERE id = $2', [name as string, tableId]);
  const directs = new Set<string>(nameErrorCells(ctx));
  return {
    status: 200,
    body: { table: { id: tableId, name: name as string, revision: table.revision + 1 } },
    historyKind: 'table_rename',
    historyTableId: tableId,
    seeds: new Set(),
    directs,
    undo: {
      kind: 'table_rename',
      data: {
        table_id: tableId,
        before_name: table.name,
        after_name: name as string,
        rewrites: rewrites.map((r) => ({ column_id: r.columnId, before: r.before })),
        accept: [table.revision + 1],
        accept_columns: Object.fromEntries(rewrites.map((r) => {
          const target = findColumnTable(ctx.preState, r.columnId);
          return [r.columnId, [ctx.preState.columnOf(target ?? '', r.columnId)!.revision + 1]];
        })),
      },
    },
    newTableIds: [],
    touchedTargets: touched,
  };
}

export async function opCreateSummary(
  ctx: EditContext,
  body: { source_table_id: unknown; group_by: unknown; sum_columns: unknown },
): Promise<EditOutcome> {
  const fields: Record<string, string> = {};
  if (typeof body.source_table_id !== 'string') {
    throw invalid({ source_table_id: 'Choose a source table.' });
  }
  const source = ctx.preState.tableById(body.source_table_id);
  if (!source || source.kind === 'summary') {
    throw invalid({ source_table_id: 'Choose a source table.' });
  }
  if (!Array.isArray(body.group_by) || body.group_by.length < 1 || body.group_by.length > 3) {
    throw invalid({ group_by: 'Choose 1 to 3 columns.' });
  }
  const groupBy: string[] = [];
  const seenGroup = new Set<string>();
  for (const g of body.group_by) {
    if (typeof g !== 'string' || !ctx.preState.columnOf(source.id, g)) {
      throw invalid({ group_by: 'Choose 1 to 3 columns.' });
    }
    if (seenGroup.has(g)) throw invalid({ group_by: 'Choose distinct columns.' });
    seenGroup.add(g);
    groupBy.push(g);
  }
  if (!Array.isArray(body.sum_columns) || body.sum_columns.length > 5) {
    throw invalid({ sum_columns: 'Choose up to 5 columns.' });
  }
  const sumColumns: string[] = [];
  for (const s of body.sum_columns) {
    const col = typeof s === 'string' ? ctx.preState.columnOf(source.id, s) : undefined;
    if (!col || (col.type !== 'decimal' && col.type !== 'formula')) {
      throw invalid({ sum_columns: 'Choose Decimal or Formula columns.' });
    }
    sumColumns.push(s as string);
  }
  void fields;
  const summaryId = newId();
  const name = `${source.name} by ${groupBy
    .map((g) => ctx.preState.columnOf(source.id, g)!.name)
    .join(' and ')}`;
  const position = ctx.preState.tables.length + 1;
  await ctx.client.query(
    "INSERT INTO doc_tables (id, document_id, name, kind, position, source_table_id, revision, owner_column_id, group_by, sum_columns) VALUES ($1, $2, $3, 'summary', $4, $5, 1, NULL, $6::jsonb, $7::jsonb)",
    [summaryId, ctx.documentId, name, position, source.id, JSON.stringify(groupBy), JSON.stringify(sumColumns)],
  );
  const columnInserts: [string, string, number, string][] = [
    ...groupBy.map((g, i) => [
      newId(),
      ctx.preState.columnOf(source.id, g)!.name,
      i + 1,
      ctx.preState.columnOf(source.id, g)!.type,
    ] as [string, string, number, string]),
    [newId(), 'Count', groupBy.length + 1, 'decimal'],
    ...sumColumns.map(
      (s, i) =>
        [newId(), `Sum of ${ctx.preState.columnOf(source.id, s)!.name}`, groupBy.length + 2 + i, 'decimal'] as [string, string, number, string],
    ),
  ];
  for (const [id, cname, pos, type] of columnInserts) {
    await ctx.client.query(
      'INSERT INTO doc_columns (id, table_id, name, type, formula, target_table_id, position, revision) VALUES ($1, $2, $3, $4, NULL, NULL, $5, 1)',
      [id, summaryId, cname, type, pos],
    );
  }
  // every cell of every group row of the new summary is a direct cell
  const state = await DocState.load(ctx.client, ctx.documentId);
  const view = ctx.view;
  const ev = evaluateDoc(state, view);
  const directs = new Set<string>();
  for (const group of ev.groups.get(summaryId) ?? []) {
    for (const c of state.tableColumns(summaryId)) {
      directs.add(nodeKey(group.rowId, c.id));
    }
  }
  return {
    status: 201,
    body: {
      table: {
        id: summaryId,
        name,
        kind: 'summary',
        revision: 1,
        source_table_id: source.id,
        columns: apiColumns(state, summaryId).map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          formula: c.formula,
          target_table_id: c.target_table_id,
          position: c.position,
          revision: c.revision,
        })),
        rows: [],
      },
    },
    historyKind: 'summary_add',
    historyTableId: summaryId,
    seeds: new Set(),
    directs,
    undo: null,
    newTableIds: [summaryId],
    touchedTargets: [],
  };
}



export async function opSetAccess(
  ctx: EditContext,
  tableId: string,
  ownerColumnId: unknown,
): Promise<EditOutcome> {
  const table = ctx.preState.tableById(tableId);
  if (!table || table.kind === 'summary') {
    throw table ? invalid({ table: COPY.summaryNoEdit }) : notFound();
  }
  if (ownerColumnId !== null) {
    const column = typeof ownerColumnId === 'string' ? ctx.preState.columnOf(tableId, ownerColumnId) : undefined;
    if (!column || column.type !== 'text') {
      throw invalid({ owner_column_id: COPY.chooseTextColumn });
    }
  }
  await ctx.client.query('UPDATE doc_tables SET owner_column_id = $1 WHERE id = $2', [ownerColumnId as string | null, tableId]);
  return {
    status: 200,
    body: { table: { id: tableId, owner_column_id: ownerColumnId as string | null } },
    historyKind: 'access_update',
    historyTableId: tableId,
    seeds: new Set(),
    directs: new Set(),
    undo: null,
    newTableIds: [],
    touchedTargets: [],
  };
}

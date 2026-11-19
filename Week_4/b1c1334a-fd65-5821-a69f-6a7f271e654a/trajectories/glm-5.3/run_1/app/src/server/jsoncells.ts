/**
 * JSON cell, row and table reads: one place builds the API's view of a table,
 * from the same evaluator that recalculates.
 */
import { DocState, Column, Row, View } from './docstate.js';
import { Evaluation, nodeKey, ComputedCell } from './evaluator.js';
import { tableName, apiColumns, ApiColumn } from './names.js';

export interface JsonCell {
  value: unknown;
  display: string;
  kind: 'decimal' | 'text' | 'date' | 'bool' | 'reference' | 'error' | 'blank';
  revision: number | null;
}

export interface JsonRow {
  id: string;
  revision: number | null;
  cells: Record<string, JsonCell>;
}

export interface JsonColumn {
  id: string;
  name: string;
  type: 'text' | 'decimal' | 'date' | 'bool' | 'reference' | 'formula';
  formula: string | null;
  target_table_id: string | null;
  position: number;
  revision: number;
}

export const jsonColumn = (c: Column): JsonColumn => ({
  id: c.id,
  name: c.name,
  type: c.type,
  formula: c.formula,
  target_table_id: c.targetTableId,
  position: c.position,
  revision: c.revision,
});

/** A column's JSON from the API column list, with a summary's derived id and name. */
export function jsonApiColumn(c: ApiColumn): JsonColumn {
  return {
    id: c.id,
    name: c.name,
    type: c.type as JsonColumn['type'],
    formula: c.formula,
    target_table_id: c.target_table_id,
    position: c.position,
    revision: c.revision,
  };
}

/** The API cell for a data cell, read through the evaluation. */
export function jsonCell(
  state: DocState,
  column: Column,
  row: Row,
  ev: Evaluation,
): JsonCell {
  if (column.type === 'formula') {
    const computed = ev.cells.get(nodeKey(row.id, column.id));
    if (!computed) return { value: null, display: '', kind: 'blank', revision: null };
    return computedToJson(computed);
  }
  if (column.type === 'reference') {
    const cell = state.cell(row.id, column.id);
    if (!cell || cell.value === null) return { value: null, display: '', kind: 'blank', revision: cell?.revision ?? 1 };
    const computed = ev.cells.get(nodeKey(row.id, column.id));
    if (computed && computed.kind === 'error') {
      return { value: null, display: '#REF!', kind: 'error', revision: cell.revision };
    }
    return { value: cell.value, display: computed?.display ?? '', kind: 'reference', revision: cell.revision };
  }
  const cell = state.cell(row.id, column.id);
  const revision = cell?.revision ?? 1;
  if (!cell || cell.value === null) return { value: null, display: '', kind: 'blank', revision };
  switch (column.type) {
    case 'decimal':
      return { value: cell.value, display: cell.value, kind: 'decimal', revision };
    case 'date':
      return { value: cell.value, display: cell.value, kind: 'date', revision };
    case 'bool':
      return { value: cell.value === 'TRUE', display: cell.value, kind: 'bool', revision };
    default:
      return { value: cell.value, display: cell.value, kind: 'text', revision };
  }
}

export function computedToJson(computed: ComputedCell): JsonCell {
  switch (computed.kind) {
    case 'blank':
      return { value: null, display: '', kind: 'blank', revision: null };
    case 'error':
      return { value: computed.display, display: computed.display, kind: 'error', revision: null };
    case 'bool':
      return { value: computed.value === true || computed.display === 'TRUE', display: computed.display, kind: 'bool', revision: null };
    default:
      return { value: computed.value, display: computed.display, kind: computed.kind, revision: null };
  }
}

export function jsonRow(
  state: DocState,
  view: View,
  tableId: string,
  row: Row,
  ev: Evaluation,
): JsonRow {
  const cells: Record<string, JsonCell> = {};
  for (const col of state.tableColumns(tableId)) {
    cells[col.id] = jsonCell(state, col, row, ev);
  }
  return { id: row.id, revision: row.revision, cells };
}

/** The rows of a summary: one JSON row per group, in group order. */
export function summaryJsonRows(
  state: DocState,
  summaryId: string,
  ev: Evaluation,
): JsonRow[] {
  const groups = ev.groups.get(summaryId) ?? [];
  const summary = state.tableById(summaryId)!;
  const columns = apiColumns(state, summaryId);
  return groups.map((group) => {
    const cells: Record<string, JsonCell> = {};
    for (const col of columns) {
      const computed = group.cells.get(col.id);
      if (!computed) {
        cells[col.id] = { value: null, display: '', kind: 'blank', revision: null };
        continue;
      }
      // a reference group column keeps the source row id as its value
      const sourceCol = state.columnOf(summary.sourceTableId ?? '', col.id);
      if (sourceCol?.type === 'reference') {
        const part = group.key[summary.groupBy.indexOf(col.id)];
        if (part && part.startsWith('ref\u0000')) {
          cells[col.id] = {
            value: part.slice(4),
            display: computed.display,
            kind: 'reference',
            revision: null,
          };
          continue;
        }
        cells[col.id] = { value: null, display: computed.display, kind: computed.kind as JsonCell['kind'], revision: null };
        continue;
      }
      cells[col.id] = computedToJson(computed);
    }
    return { id: group.rowId, revision: null, cells };
  });
}

/** The API table read: columns plus the caller's visible rows. */
export function jsonTable(
  state: DocState,
  view: View,
  tableId: string,
  ev: Evaluation,
): { id: string; name: string; kind: string; revision: number; owner_column_id: string | null; columns: JsonColumn[]; rows: JsonRow[] } {
  const table = state.tableById(tableId)!;
  const columns = apiColumns(state, tableId).map(jsonApiColumn);
  let rows: JsonRow[];
  if (table.kind === 'summary') {
    rows = summaryJsonRows(state, tableId, ev);
  } else {
    rows = view.visibleRows(tableId, state).map((row) => jsonRow(state, view, tableId, row, ev));
  }
  return {
    id: table.id,
    name: tableName(state, table),
    kind: table.kind,
    revision: table.revision,
    owner_column_id: table.ownerColumnId,
    columns,
    rows,
  };
}

/** The display text of a row for status copy: first column, or `(blank)`. */
export function rowDisplay(state: DocState, tableId: string, rowId: string, ev: Evaluation): string {
  const table = state.tableById(tableId);
  if (!table) return '(blank)';
  if (table.kind === 'summary') {
    const groups = ev.groups.get(tableId) ?? [];
    const group = groups.find((g) => g.rowId === rowId);
    if (!group) return '(blank)';
    const first = apiColumns(state, tableId)[0];
    const computed = first ? group.cells.get(first.id) : undefined;
    return computed && computed.display !== '' ? computed.display : '(blank)';
  }
  const first = state.displayColumn(tableId);
  if (!first) return '(blank)';
  const row = state.rows.get(rowId);
  if (!row) return '(blank)';
  if (first.type === 'formula' || first.type === 'reference') {
    const computed = ev.cells.get(nodeKey(rowId, first.id));
    return computed && computed.display !== '' ? computed.display : '(blank)';
  }
  const cell = state.cell(rowId, first.id);
  return cell && cell.value !== null && cell.value !== '' ? cell.value : '(blank)';
}

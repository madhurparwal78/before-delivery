import type { ColumnJson, RowJson, TableJson } from '../shared/api.js';
import { cellJson, cellKey, type Snapshot } from './evaluate.js';
import type { ColumnData, RowData, TableData } from './model.js';

export function columnJson(column: ColumnData): ColumnJson {
  return {
    id: column.id,
    name: column.name,
    type: column.type,
    formula: column.formula,
    target_table_id: column.targetTableId,
    position: column.position,
    revision: column.revision,
  };
}

export function rowJson(
  snapshot: Snapshot,
  table: TableData,
  rowId: string,
  revision: number | null,
): RowJson {
  const cells: RowJson['cells'] = {};
  for (const column of table.columns) {
    const cell = snapshot.cells.get(cellKey(rowId, column.id));
    if (cell === undefined) continue;
    cells[column.id] = cellJson(cell);
  }
  return { id: rowId, revision, cells };
}

export function dataRowJson(snapshot: Snapshot, table: TableData, row: RowData): RowJson {
  return rowJson(snapshot, table, row.id, row.revision);
}

export function tableJson(snapshot: Snapshot, table: TableData): TableJson {
  const rows: RowJson[] =
    table.kind === 'summary'
      ? (snapshot.groups.get(table.id) ?? []).map((group) =>
          rowJson(snapshot, table, group.id, null),
        )
      : (snapshot.visible.get(table.id) ?? []).map((row) => dataRowJson(snapshot, table, row));
  return {
    id: table.id,
    name: table.name,
    kind: table.kind,
    revision: table.revision,
    owner_column_id: table.ownerColumnId,
    columns: table.columns.map(columnJson),
    rows,
  };
}

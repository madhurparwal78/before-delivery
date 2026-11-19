/**
 * Derived names: a summary's name, column ids and column names follow their
 * source table and columns at read time. One place derives them.
 */
import { DocState, Table } from './docstate.js';

export function tableName(state: DocState, table: Table): string {
  if (table.kind !== 'summary' || !table.sourceTableId) return table.name;
  const source = state.tableById(table.sourceTableId);
  if (!source) return table.name;
  const names = table.groupBy.map((g) => state.columnOf(source.id, g)?.name ?? g);
  return `${source.name} by ${names.join(' and ')}`;
}

export interface ApiColumn {
  id: string;
  name: string;
  type: string;
  formula: string | null;
  target_table_id: string | null;
  position: number;
  revision: number;
}

/**
 * The API's columns of one table. A summary's group columns carry their
 * source column ids; its Count and Sum columns carry `count` and
 * `sum:<source column id>`.
 */
export function apiColumns(state: DocState, tableId: string): ApiColumn[] {
  const table = state.tableById(tableId);
  if (!table) return [];
  if (table.kind !== 'summary') {
    return state.tableColumns(tableId).map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      formula: c.formula,
      target_table_id: c.targetTableId,
      position: c.position,
      revision: c.revision,
    }));
  }
  const stored = state.tableColumns(tableId);
  const source = table.sourceTableId ? state.tableById(table.sourceTableId) : undefined;
  const out: ApiColumn[] = [];
  for (const [j, sourceId] of table.groupBy.entries()) {
    const col = source ? state.columnOf(source.id, sourceId) : undefined;
    out.push({
      id: sourceId,
      name: col?.name ?? sourceId,
      type: col?.type ?? 'text',
      formula: null,
      target_table_id: null,
      position: j + 1,
      revision: stored[j]?.revision ?? 1,
    });
  }
  out.push({
    id: 'count',
    name: 'Count',
    type: 'decimal',
    formula: null,
    target_table_id: null,
    position: table.groupBy.length + 1,
    revision: stored[table.groupBy.length]?.revision ?? 1,
  });
  for (const [j, sourceId] of table.sumColumns.entries()) {
    const col = source ? state.columnOf(source.id, sourceId) : undefined;
    out.push({
      id: `sum:${sourceId}`,
      name: `Sum of ${col?.name ?? sourceId}`,
      type: 'decimal',
      formula: null,
      target_table_id: null,
      position: table.groupBy.length + 2 + j,
      revision: stored[table.groupBy.length + 1 + j]?.revision ?? 1,
    });
  }
  return out;
}

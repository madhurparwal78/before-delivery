import { PoolClient } from 'pg';
import { randomBytes } from 'node:crypto';
import type { Value } from './values.js';

export type ColumnType = 'text' | 'decimal' | 'date' | 'bool' | 'reference' | 'formula';

export interface Column {
  id: string;
  tableId: string;
  name: string;
  type: ColumnType;
  formula: string | null;
  targetTableId: string | null;
  position: number;
  revision: number;
}

export interface Table {
  id: string;
  documentId: string;
  name: string;
  kind: 'table' | 'summary';
  position: number;
  sourceTableId: string | null;
  revision: number;
  ownerColumnId: string | null;
  groupBy: string[];
  sumColumns: string[];
}

export interface Row {
  id: string;
  tableId: string;
  position: bigint;
  revision: number;
  deleted: boolean;
}

export interface CellRecord {
  rowId: string;
  columnId: string;
  value: string | null;
  revision: number;
}

export interface Person {
  id: string;
  email: string;
  displayName: string;
}

export const newId = (): string => randomBytes(12).toString('hex');

const cellKey = (rowId: string, columnId: string): string => `${rowId}\u0000${columnId}`;

export class DocState {
  tables: Table[] = [];
  /** columns per table, in position order (column ids repeat across tables) */
  tableColumnsMap = new Map<string, Column[]>();
  rows = new Map<string, Row>();
  cells = new Map<string, CellRecord>();
  /** visible, undeleted rows per table, in insertion order */
  tableRows = new Map<string, Row[]>();
  /** stable group row ids per summary: summary id -> (key json -> row id) */
  summaryGroups = new Map<string, Map<string, string>>();
  revision = 0;

  /** Group ids first seen in this request, for the edit path to persist. */
  newGroupIds: { summaryId: string; keyJson: string; rowId: string }[] = [];

  summaryGroupId(summaryId: string, keyJson: string): string {
    const map = this.summaryGroups.get(summaryId);
    const existing = map?.get(keyJson);
    if (existing) return existing;
    const id = newId();
    if (!map) {
      this.summaryGroups.set(summaryId, new Map([[keyJson, id]]));
    } else {
      map.set(keyJson, id);
    }
    this.newGroupIds.push({ summaryId, keyJson, rowId: id });
    return id;
  }

  static async load(client: PoolClient, documentId: string): Promise<DocState> {
    const state = new DocState();
    const doc = await client.query<{ id: string; revision: number }>(
      'SELECT id, revision FROM documents WHERE id = $1',
      [documentId],
    );
    if (doc.rows.length === 0) throw new Error('document missing');
    state.revision = doc.rows[0]!.revision;

    const tables = await client.query(
      `SELECT id, name, kind, position, source_table_id, revision, owner_column_id, group_by, sum_columns
       FROM doc_tables WHERE document_id = $1 ORDER BY position`,
      [documentId],
    );
    for (const t of tables.rows) {
      state.tables.push({
        id: t.id,
        documentId,
        name: t.name,
        kind: t.kind,
        position: t.position,
        sourceTableId: t.source_table_id,
        revision: t.revision,
        ownerColumnId: t.owner_column_id,
        groupBy: t.group_by ?? [],
        sumColumns: t.sum_columns ?? [],
      });
    }
    if (state.tables.length > 0) {
      const cols = await client.query(
        `SELECT id, table_id, name, type, formula, target_table_id, position, revision
         FROM doc_columns WHERE table_id = ANY($1) ORDER BY position`,
        [state.tables.map((t) => t.id)],
      );
      for (const c of cols.rows) {
        const column: Column = {
          id: c.id,
          tableId: c.table_id,
          name: c.name,
          type: c.type,
          formula: c.formula,
          targetTableId: c.target_table_id,
          position: c.position,
          revision: c.revision,
        };
        const list = state.tableColumnsMap.get(c.table_id) ?? [];
        list.push(column);
        state.tableColumnsMap.set(c.table_id, list);
      }
    }
    const rows = await client.query(
      `SELECT id, table_id, position, revision, deleted
       FROM doc_rows WHERE table_id = ANY($1) ORDER BY position`,
      [state.tables.map((t) => t.id)],
    );
    for (const r of rows.rows) {
      const row: Row = {
        id: r.id,
        tableId: r.table_id,
        position: BigInt(r.position),
        revision: r.revision,
        deleted: r.deleted,
      };
      state.rows.set(row.id, row);
    }
    if (state.tables.length > 0) {
      const allCells = await client.query(
        `SELECT c.row_id, c.column_id, c.value, c.revision
         FROM doc_cells c JOIN doc_rows r ON r.id = c.row_id
         WHERE r.table_id = ANY($1)`,
        [state.tables.map((t) => t.id)],
      );
      for (const c of allCells.rows) {
        const rec: CellRecord = {
          rowId: c.row_id,
          columnId: c.column_id,
          value: c.value,
          revision: c.revision,
        };
        state.cells.set(cellKey(rec.rowId, rec.columnId), rec);
      }
    }
    for (const row of state.rows.values()) {
      if (row.deleted) continue;
      const list = state.tableRows.get(row.tableId) ?? [];
      list.push(row);
      state.tableRows.set(row.tableId, list);
    }
    const groups = await client.query<{ summary_table_id: string; key_json: string; row_id: string }>(
      'SELECT summary_table_id, key_json, row_id FROM doc_summary_groups WHERE document_id = $1',
      [documentId],
    );
    for (const g of groups.rows) {
      const map = state.summaryGroups.get(g.summary_table_id) ?? new Map<string, string>();
      map.set(g.key_json, g.row_id);
      state.summaryGroups.set(g.summary_table_id, map);
    }
    return state;
  }

  tableById(id: string): Table | undefined {
    return this.tables.find((t) => t.id === id);
  }

  tableColumns(tableId: string): Column[] {
    return this.tableColumnsMap.get(tableId) ?? [];
  }

  columnOf(tableId: string, columnId: string): Column | undefined {
    return this.tableColumnsMap.get(tableId)?.find((c) => c.id === columnId);
  }

  /** The display column: the table's first column by position. */
  displayColumn(tableId: string): Column | undefined {
    return this.tableColumns(tableId)[0];
  }

  addColumn(column: Column): void {
    const list = this.tableColumnsMap.get(column.tableId) ?? [];
    list.push(column);
    this.tableColumnsMap.set(column.tableId, list);
  }

  removeColumn(tableId: string, columnId: string): void {
    const list = this.tableColumnsMap.get(tableId) ?? [];
    this.tableColumnsMap.set(tableId, list.filter((c) => c.id !== columnId));
  }

  cell(rowId: string, columnId: string): CellRecord | undefined {
    return this.cells.get(cellKey(rowId, columnId));
  }

  setCell(rowId: string, columnId: string, value: string | null, revision: number): void {
    this.cells.set(cellKey(rowId, columnId), { rowId, columnId, value, revision });
  }

  nextRowPosition(tableId: string): bigint {
    let max = 0n;
    for (const row of this.rows.values()) {
      if (row.tableId === tableId && row.position > max) max = row.position;
    }
    return max + 1n;
  }

  addRow(table: Table, rowId: string, position: bigint): Row {
    const row: Row = { id: rowId, tableId: table.id, position, revision: 1, deleted: false };
    this.rows.set(rowId, row);
    const list = this.tableRows.get(table.id) ?? [];
    list.push(row);
    this.tableRows.set(table.id, list);
    return row;
  }

  markDeleted(rowId: string): void {
    const row = this.rows.get(rowId);
    if (row) {
      row.deleted = true;
      const list = this.tableRows.get(row.tableId) ?? [];
      this.tableRows.set(row.tableId, list.filter((r) => r.id !== rowId));
    }
  }

  markRestored(rowId: string): void {
    const row = this.rows.get(rowId);
    if (row) {
      row.deleted = false;
      const list = this.tableRows.get(row.tableId) ?? [];
      if (!list.some((r) => r.id === rowId)) {
        list.push(row);
        list.sort((a, b) => (a.position < b.position ? -1 : 1));
        this.tableRows.set(row.tableId, list);
      }
    }
  }
}

/** A caller's view: which rows are visible in each table. */
export interface View {
  email: string | null;
  role: 'owner' | 'editor' | 'viewer';
  rowScope: 'all' | 'own';
  visibleRows(tableId: string, state: DocState): Row[];
}

export class AllRowsView implements View {
  email: string | null;
  role: 'owner' | 'editor' | 'viewer';
  rowScope: 'all' | 'own';
  constructor(role: 'owner' | 'editor' | 'viewer') {
    this.email = null;
    this.role = role;
    this.rowScope = 'all';
  }
  visibleRows(tableId: string, state: DocState): Row[] {
    return state.tableRows.get(tableId) ?? [];
  }
}

export class OwnRowsView implements View {
  email: string;
  role: 'owner' | 'editor' | 'viewer';
  rowScope: 'own';
  constructor(email: string, role: 'owner' | 'editor' | 'viewer') {
    this.email = email;
    this.role = role;
    this.rowScope = 'own';
  }
  visibleRows(tableId: string, state: DocState): Row[] {
    const table = state.tableById(tableId);
    if (!table || !table.ownerColumnId) return state.tableRows.get(tableId) ?? [];
    const ownerCol = table.ownerColumnId;
    return (state.tableRows.get(tableId) ?? []).filter((row) => {
      const cell = state.cell(row.id, ownerCol);
      if (!cell || cell.value === null) return false;
      return cell.value.trim().toLowerCase() === this.email.toLowerCase();
    });
  }
}

/** Stored cell value as a Value for evaluation. */
export function storedValue(state: DocState, column: Column, cell: CellRecord | undefined): Value {
  if (!cell || cell.value === null) {
    if (column.type === 'reference') return { kind: 'reference', value: null, rowId: null };
    return { kind: 'blank', value: null };
  }
  switch (column.type) {
    case 'text':
      return { kind: 'text', value: cell.value };
    case 'decimal':
      return { kind: 'decimal', value: cell.value };
    case 'date':
      return { kind: 'date', value: cell.value };
    case 'bool':
      return { kind: 'bool', value: cell.value };
    case 'reference':
      return { kind: 'reference', value: cell.value, rowId: cell.value };
    default:
      return { kind: 'blank', value: null };
  }
}

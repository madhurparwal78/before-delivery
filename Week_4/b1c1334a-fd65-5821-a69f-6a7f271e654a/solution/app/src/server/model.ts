// The stored shape of one document, as loaded into memory for a request.

export type Role = "owner" | "editor" | "viewer";
export type RowScope = "all" | "own";
export type ColumnType = "text" | "decimal" | "date" | "bool" | "reference" | "formula";
export type DataType = "text" | "decimal" | "date" | "bool";
export type CellKind = "decimal" | "text" | "date" | "bool" | "reference" | "error" | "blank";

// A data cell's stored value: text, decimal and date as their canonical text, a
// Reference as the target row id, a Bool as a boolean, and blank as null.
export type Stored = string | boolean | null;

// `writer` names the change that last set a record; undo and redo compare it to tell
// whether anyone else changed the record since.
export interface TableRec {
  id: string;
  name: string;
  kind: "table" | "summary";
  revision: number;
  ownerColumnId: string | null;
  sourceTableId: string | null;
  groupBy: string[];
  sumColumns: string[];
  seq: number;
  writer: string;
}

export interface ColumnRec {
  id: string;
  tableId: string;
  name: string;
  type: ColumnType;
  formula: string | null;
  targetTableId: string | null;
  position: number;
  revision: number;
  deleted: boolean;
  writer: string;
}

export interface RowRec {
  id: string;
  tableId: string;
  seq: number;
  revision: number;
  deleted: boolean;
  writer: string;
}

export interface CellRec {
  value: Stored;
  revision: number;
  writer: string;
}

export interface DocState {
  id: string;
  name: string;
  ownerId: string;
  revision: number;
  tables: TableRec[];
  columns: ColumnRec[];
  rows: RowRec[];
  cells: Map<string, CellRec>;
}

export interface Access {
  role: Role;
  rowScope: RowScope;
  email: string;
}

export const cellKey = (rowId: string, columnId: string) => `${rowId}|${columnId}`;

export function cloneState(state: DocState): DocState {
  return {
    ...state,
    tables: state.tables.map((t) => ({ ...t, groupBy: [...t.groupBy], sumColumns: [...t.sumColumns] })),
    columns: state.columns.map((c) => ({ ...c })),
    rows: state.rows.map((r) => ({ ...r })),
    cells: new Map([...state.cells].map(([k, v]) => [k, { ...v }])),
  };
}

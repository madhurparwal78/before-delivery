// The mutations an edit makes to a document's in-memory state. Revisions and writer
// tokens are kept here, so every edit, undo and redo raises them the same way.
import { randomBytes } from "node:crypto";
import type { Evaluation } from "./engine.js";
import { type Expr, parseStored, replaceSpans, type Span, walk } from "./formula.js";
import type { ColumnRec, DataType, DocState, RowRec, Stored } from "./model.js";
import { cellKey } from "./model.js";
import { cellOf } from "./store.js";
import { convertDisplay, display, storedValue } from "./values.js";

export const newId = (prefix: string) => `${prefix}${randomBytes(9).toString("base64url").replace(/[-_]/g, "x")}`;

// One edit's view of the state it is changing.
export class Mutation {
  private readonly bumpedRows = new Set<string>();

  constructor(
    readonly state: DocState,
    readonly writer: string,
  ) {}

  row(id: string): RowRec {
    return this.state.rows.find((r) => r.id === id)!;
  }

  column(id: string): ColumnRec {
    return this.state.columns.find((c) => c.id === id)!;
  }

  // A row's revision rises once per edit, whichever of its cells changed.
  bumpRow(rowId: string, writer = this.writer): void {
    const row = this.row(rowId);
    if (!this.bumpedRows.has(rowId)) {
      row.revision++;
      this.bumpedRows.add(rowId);
    }
    row.writer = writer;
  }

  setCell(rowId: string, columnId: string, value: Stored, writer = this.writer, rowWriter = writer): CellChange {
    const before = cellOf(this.state, rowId, columnId);
    const prevRowWriter = this.row(rowId).writer;
    this.state.cells.set(cellKey(rowId, columnId), { value, revision: before.revision + 1, writer });
    this.bumpRow(rowId, rowWriter);
    return { row: rowId, column: columnId, before: before.value, after: value, prevWriter: before.writer, prevRowWriter };
  }

  addRow(tableId: string, values: Record<string, Stored>): RowRec {
    const seq = Math.max(0, ...this.state.rows.filter((r) => r.tableId === tableId).map((r) => r.seq)) + 1;
    const row: RowRec = { id: newId("r"), tableId, seq, revision: 1, deleted: false, writer: this.writer };
    this.state.rows.push(row);
    for (const [columnId, value] of Object.entries(values)) {
      if (value !== null) this.state.cells.set(cellKey(row.id, columnId), { value, revision: 1, writer: this.writer });
    }
    return row;
  }

  // Deletes a row; every Reference to it turns #REF! and its revision rises.
  deleteRow(rowId: string, writer = this.writer): BrokenReference[] {
    const row = this.row(rowId);
    row.deleted = true;
    row.writer = writer;
    const broken: BrokenReference[] = [];
    for (const column of this.state.columns) {
      if (column.type !== "reference" || column.targetTableId !== row.tableId) continue;
      for (const other of this.state.rows) {
        if (other.tableId !== column.tableId) continue;
        const cell = this.state.cells.get(cellKey(other.id, column.id));
        if (cell?.value !== rowId) continue;
        const prevRowWriter = other.writer;
        broken.push({ row: other.id, column: column.id, prevWriter: cell.writer, prevRowWriter });
        cell.revision++;
        cell.writer = writer;
        this.bumpRow(other.id, writer);
      }
    }
    return broken;
  }

  // Brings a deleted row back under its id; References still broken by that deletion follow it.
  restoreRow(rowId: string, rowWriter: string, broken: BrokenReference[], restoreWriters: boolean): string[] {
    const row = this.row(rowId);
    row.deleted = false;
    row.writer = rowWriter;
    const repointed: string[] = [];
    for (const b of broken) {
      const cell = this.state.cells.get(cellKey(b.row, b.column));
      const other = this.row(b.row);
      if (!cell || cell.value !== rowId || other.deleted || this.column(b.column).deleted) continue;
      cell.revision++;
      cell.writer = restoreWriters ? b.prevWriter : this.writer;
      this.bumpRow(b.row, restoreWriters ? b.prevRowWriter : this.writer);
      repointed.push(cellKey(b.row, b.column));
    }
    return repointed;
  }

  // Converts every stored value of a data column to a new type, from its old display.
  convertColumn(column: ColumnRec, type: DataType, writer = this.writer): CellChange[] {
    const changes: CellChange[] = [];
    for (const row of this.state.rows) {
      if (row.tableId !== column.tableId) continue;
      const stored = this.state.cells.get(cellKey(row.id, column.id))?.value ?? null;
      if (stored === null || stored === "") continue;
      const shown = display(storedValue(column.type as DataType, stored));
      changes.push(this.setCell(row.id, column.id, convertDisplay(type, shown), writer));
    }
    column.type = type;
    return changes;
  }

  // Sets each rewritten formula to its text after (or, undoing, before) a rename; the
  // rewritten columns' cells are direct cells of the edit.
  rewriteFormulas(rewrites: FormulaRewrite[], undoing: boolean, writer: (r: FormulaRewrite) => string): Set<string> {
    const direct = new Set<string>();
    for (const r of rewrites) {
      const column = this.column(r.column);
      column.formula = undoing ? r.before : r.after;
      column.revision++;
      column.writer = writer(r);
      for (const row of this.state.rows.filter((x) => x.tableId === column.tableId)) direct.add(cellKey(row.id, column.id));
    }
    return direct;
  }

  nextPosition(tableId: string): number {
    return Math.max(-1, ...this.state.columns.filter((c) => c.tableId === tableId).map((c) => c.position)) + 1;
  }
}

export interface CellChange {
  row: string;
  column: string;
  before: Stored;
  after: Stored;
  prevWriter: string;
  prevRowWriter: string;
}

export interface BrokenReference {
  row: string;
  column: string;
  prevWriter: string;
  prevRowWriter: string;
}

export interface FormulaRewrite {
  column: string;
  before: string;
  after: string;
  prevWriter: string;
}

// The formula texts a column rename changes: `[Old]` in its own table, `[X].[Old]` where the
// link before targets its table, and `T.[Old]` aggregate arguments naming its table.
export function columnRenameRewrites(ev: Evaluation, renamed: ColumnRec, newName: string): FormulaRewrite[] {
  const table = ev.tables.get(renamed.tableId)!;
  return rewriteAll(ev, (expr, ownTable) => {
    const spans: Span[] = [];
    walk(expr, (node) => {
      if (node.t === "chain") {
        ev.resolveChain(ownTable, node.links.map((l) => l.name)).columns.forEach((col, i) => {
          if (col.id === renamed.id) spans.push(node.links[i]!.span);
        });
      } else if (node.t === "tablecol") {
        const t = ev.tableByName(node.table);
        if (t?.id === table.id && ev.columnByName(t.id, node.column.name)?.id === renamed.id) spans.push(node.column.span);
      }
    });
    return spans.map((span) => ({ span, name: newName }));
  });
}

// The formula texts a table rename changes: every `T` of `T.[Column]` and of `COUNT(T)`.
export function tableRenameRewrites(ev: Evaluation, tableId: string, newName: string): FormulaRewrite[] {
  const old = ev.tables.get(tableId)!.name.toLowerCase();
  return rewriteAll(ev, (expr) => {
    const edits: { span: Span; name: string }[] = [];
    walk(expr, (node) => {
      if ((node.t === "tablecol" || node.t === "table") && node.table.toLowerCase() === old) {
        edits.push({ span: node.tableSpan, name: newName });
      }
    });
    return edits;
  });
}

function rewriteAll(ev: Evaluation, find: (expr: Expr, ownTable: string) => { span: Span; name: string }[]): FormulaRewrite[] {
  const out: FormulaRewrite[] = [];
  for (const table of ev.orderedTables()) {
    for (const column of ev.columns(table.id)) {
      if (column.type !== "formula") continue;
      const edits = find(parseStored(column.formula!), table.id);
      const after = replaceSpans(column.formula!, edits);
      if (after !== column.formula) out.push({ column: column.id, before: column.formula!, after, prevWriter: column.writer });
    }
  }
  return out;
}

// Names a formula uses that resolve to nothing; when an edit makes one resolve,
// that formula's cells are direct cells of the edit.
export function unresolvedNames(ev: Evaluation): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const table of ev.orderedTables()) {
    for (const column of ev.columns(table.id)) {
      if (column.type !== "formula") continue;
      const missing = new Set<string>();
      walk(ev.expr(column), (node) => {
        if (node.t === "chain") {
          const resolved = ev.resolveChain(table.id, node.links.map((l) => l.name));
          if (resolved.missing) missing.add(`column:${resolved.missing}`);
        } else if (node.t === "tablecol" || node.t === "table") {
          const t = ev.tableByName(node.table);
          if (!t) missing.add(`table:${node.table.toLowerCase()}`);
          else if (node.t === "tablecol" && !ev.columnByName(t.id, node.column.name)) {
            missing.add(`column:${t.id}:${node.column.name.toLowerCase()}`);
          }
        }
      });
      out.set(column.id, missing);
    }
  }
  return out;
}

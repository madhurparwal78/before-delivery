// Personal undo and redo. An entry still applies only when every record it touched still
// carries the writer token its edit (or that person's own later undo or redo) left there.
import { may } from "./access.js";
import type { Db } from "./db.js";
import { ApiError } from "./http.js";
import type { ColumnType } from "./model.js";
import { cellKey } from "./model.js";
import { type BrokenReference, type CellChange, type FormulaRewrite, Mutation } from "./ops.js";
import { rowsNode } from "./engine.js";
import { CommittedRefusal, type EditContext, type EditSpec, type Outcome, type UndoKind, pushEntry, stacksOf } from "./edit.js";
import { cellOf } from "./store.js";

interface CellsPayload {
  tableId: string;
  type: Record<string, ColumnType>; // each written column's type at the time
  changes: CellChange[];
}

interface RowPayload {
  tableId: string;
  rowId: string;
  prevWriter: string;
  broken: BrokenReference[];
}

interface ColumnPayload {
  tableId: string;
  columnId: string;
  prevWriter: string;
}

interface ColumnUpdatePayload {
  tableId: string;
  columnId: string;
  prevWriter: string;
  before: { name: string; type: ColumnType; formula: string | null };
  after: { name: string; type: ColumnType; formula: string | null };
  rewrites: FormulaRewrite[];
  converted: CellChange[];
}

interface TableRenamePayload {
  tableId: string;
  prevWriter: string;
  before: string;
  after: string;
  rewrites: FormulaRewrite[];
}

interface Entry {
  id: string;
  kind: UndoKind;
  table_id: string;
  payload: unknown;
}

type Direction = "undo" | "redo";

export function undoSpec(direction: Direction): EditSpec {
  return {
    allowed: (c) => may(c.access, "write"),
    apply: async (c) => {
      const from = direction;
      const to = direction === "undo" ? "redo" : "undo";
      const { rows } = await c.db.query<Entry>(
        `SELECT id, kind, table_id, payload FROM undo_entries
         WHERE document_id = $1 AND account_id = $2 AND stack = $3 ORDER BY seq DESC LIMIT 1`,
        [c.doc.id, c.account.id, from],
      );
      const entry = rows[0];
      if (!entry) {
        const code = direction === "undo" ? "nothing_to_undo" : "nothing_to_redo";
        throw new CommittedRefusal(
          new ApiError(409, code, direction === "undo" ? "Nothing to undo." : "Nothing to redo.", {
            stacks: await stacksOf(c.db, c.doc.id, c.account.id),
          }),
        );
      }
      const applied = applyEntry(c, entry, direction);
      if (!applied) {
        await c.db.query("DELETE FROM undo_entries WHERE id = $1", [entry.id]);
        throw new CommittedRefusal(
          new ApiError(409, "undo_conflict", "This no longer applies because it changed since.", {
            stacks: await stacksOf(c.db, c.doc.id, c.account.id),
          }),
        );
      }
      return {
        ...applied,
        status: 200,
        kind: direction,
        tableId: entry.table_id,
        stackMove: (db: Db) => pushEntry(db, c.doc.id, c.account.id, to, { id: entry.id, kind: entry.kind, tableId: entry.table_id, payload: applied.payload }),
        body: () => ({ [direction === "undo" ? "undone" : "redone"]: { kind: entry.kind } }),
      };
    },
  };
}

type Applied = Pick<Outcome, "seeds" | "direct"> & { payload: unknown };

// Checks the entry against the current state and, when it still applies, applies it.
function applyEntry(c: EditContext, entry: Entry, direction: Direction): Applied | null {
  const undoing = direction === "undo";
  // The token a record must carry for this move, and the token it carries afterwards.
  const expect = (prevWriter: string) => (undoing ? entry.id : prevWriter);
  const leave = (prevWriter: string) => (undoing ? prevWriter : entry.id);
  const m = new Mutation(c.next, entry.id);
  const live = (rowId: string, columnId: string) => {
    const row = c.state.rows.find((r) => r.id === rowId);
    const column = c.state.columns.find((col) => col.id === columnId);
    return !!row && !row.deleted && !!column && !column.deleted;
  };
  const seeds = new Set<string>();
  const direct = new Set<string>();

  switch (entry.kind) {
    case "cell_write":
    case "cell_batch": {
      const p = entry.payload as CellsPayload;
      for (const ch of p.changes) {
        if (!live(ch.row, ch.column)) return null;
        if (c.state.columns.find((col) => col.id === ch.column)!.type !== p.type[ch.column]) return null;
        if (cellOf(c.state, ch.row, ch.column).writer !== expect(ch.prevWriter)) return null;
      }
      const firstRowWriter = new Map<string, string>();
      for (const ch of p.changes) if (!firstRowWriter.has(ch.row)) firstRowWriter.set(ch.row, ch.prevRowWriter);
      for (const ch of p.changes) {
        m.setCell(ch.row, ch.column, undoing ? ch.before : ch.after, leave(ch.prevWriter), leave(firstRowWriter.get(ch.row)!));
        seeds.add(cellKey(ch.row, ch.column));
      }
      return { seeds, direct, payload: p };
    }
    case "row_add":
    case "row_delete": {
      const p = entry.payload as RowPayload;
      const row = c.state.rows.find((r) => r.id === p.rowId);
      if (!row) return null;
      // Undoing an add, or redoing a delete, deletes the row; the other two restore it.
      const deleting = (entry.kind === "row_add") === undoing;
      if (row.writer !== expect(p.prevWriter) || row.deleted === deleting) return null;
      // A deleted row's cells all go; a restored row's data cells come back and its formulas recompute.
      for (const col of c.state.columns.filter((x) => x.tableId === p.tableId && (deleting || x.type !== "formula"))) {
        seeds.add(cellKey(p.rowId, col.id));
      }
      seeds.add(rowsNode(p.tableId));
      if (deleting) {
        const broken = m.deleteRow(p.rowId, leave(p.prevWriter));
        for (const b of broken) direct.add(cellKey(b.row, b.column));
        return { seeds, direct, payload: { ...p, broken } };
      }
      for (const key of m.restoreRow(p.rowId, leave(p.prevWriter), p.broken, undoing)) direct.add(key);
      return { seeds, direct, payload: p };
    }
    case "column_add":
    case "column_delete": {
      const p = entry.payload as ColumnPayload;
      const column = m.column(p.columnId);
      const deleting = (entry.kind === "column_add") === undoing;
      if (column.writer !== expect(p.prevWriter) || column.deleted === deleting) return null;
      if (deleting && columnProtected(c, p.tableId, p.columnId)) return null;
      if (!deleting && nameTaken(c, p.tableId, column.name, column.id)) return null;
      column.deleted = deleting;
      column.writer = leave(p.prevWriter);
      for (const row of c.next.rows.filter((r) => r.tableId === p.tableId)) seeds.add(cellKey(row.id, p.columnId));
      return { seeds, direct, payload: p };
    }
    case "column_update": {
      const p = entry.payload as ColumnUpdatePayload;
      const column = m.column(p.columnId);
      if (column.deleted || column.writer !== expect(p.prevWriter)) return null;
      for (const r of p.rewrites) {
        const rewritten = m.column(r.column);
        if (rewritten.deleted || rewritten.writer !== expect(r.prevWriter)) return null;
      }
      const target = undoing ? p.before : p.after;
      if (target.name !== column.name && nameTaken(c, p.tableId, target.name, column.id)) return null;
      if (target.type !== column.type) {
        // Every value in the column must still be the one the type change left.
        const listed = new Set(p.converted.map((ch) => ch.row));
        for (const row of c.state.rows.filter((r) => r.tableId === p.tableId)) {
          const cell = cellOf(c.state, row.id, p.columnId);
          if (cell.value !== null && !listed.has(row.id)) return null;
        }
        for (const ch of p.converted) if (cellOf(c.state, ch.row, ch.column).writer !== expect(ch.prevWriter)) return null;
        for (const ch of p.converted) {
          m.setCell(ch.row, ch.column, undoing ? ch.before : ch.after, leave(ch.prevWriter), leave(ch.prevRowWriter));
          direct.add(cellKey(ch.row, ch.column));
        }
      }
      const formulaChanged = target.formula !== column.formula;
      column.name = target.name;
      column.type = target.type;
      column.formula = target.formula;
      column.revision++;
      column.writer = leave(p.prevWriter);
      if (formulaChanged) for (const row of c.next.rows.filter((r) => r.tableId === p.tableId)) direct.add(cellKey(row.id, column.id));
      for (const key of m.rewriteFormulas(p.rewrites, undoing, (r) => leave(r.prevWriter))) direct.add(key);
      return { seeds, direct, payload: p };
    }
    case "table_rename": {
      const p = entry.payload as TableRenamePayload;
      const table = c.next.tables.find((t) => t.id === p.tableId)!;
      if (table.writer !== expect(p.prevWriter)) return null;
      for (const r of p.rewrites) {
        const rewritten = m.column(r.column);
        if (rewritten.deleted || rewritten.writer !== expect(r.prevWriter)) return null;
      }
      const name = undoing ? p.before : p.after;
      if (c.next.tables.some((t) => t.id !== table.id && t.kind === "table" && t.name.toLowerCase() === name.toLowerCase())) return null;
      table.name = name;
      table.revision++;
      table.writer = leave(p.prevWriter);
      for (const key of m.rewriteFormulas(p.rewrites, undoing, (r) => leave(r.prevWriter))) direct.add(key);
      return { seeds, direct, payload: p };
    }
  }
}

export function nameTaken(c: EditContext, tableId: string, name: string, except: string): boolean {
  return c.next.columns.some((x) => x.tableId === tableId && !x.deleted && x.id !== except && x.name.toLowerCase() === name.toLowerCase());
}

// A column used by a summary, or as its table's row owner, cannot be deleted.
export function columnProtected(c: EditContext, tableId: string, columnId: string): "column_in_summary" | "column_is_row_owner" | null {
  const inSummary = c.next.tables.some(
    (t) => t.kind === "summary" && t.sourceTableId === tableId && (t.groupBy.includes(columnId) || t.sumColumns.includes(columnId)),
  );
  if (inSummary) return "column_in_summary";
  return c.next.tables.find((t) => t.id === tableId)?.ownerColumnId === columnId ? "column_is_row_owner" : null;
}


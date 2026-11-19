// Documents, tables, columns, rows, cells, summaries and the formula preview.
import type { Account } from "./auth.js";
import { query, transaction } from "./db.js";
import { Evaluation } from "./engine.js";
import { may, isOwnEmail, ownRowsOnly } from "./access.js";
import { type EditContext, type EditSpec, type Outcome, documentAccess, isStale, stacksOf } from "./edit.js";
import { readFormula } from "./formula.js";
import { ApiError, type Reply, type Request, invalid, json, notFound } from "./http.js";
import { type Json, isObject, wholeNumber } from "./json.js";
import type { ColumnRec, ColumnType, DataType, RowRec, Stored, TableRec } from "./model.js";
import { cellKey } from "./model.js";
import { type CellChange, columnRenameRewrites, newId, tableRenameRewrites } from "./ops.js";
import { rowsNode } from "./engine.js";
import { cellJson, columnJson, rowJson, tableJson, tableSummaryJson } from "./serialize.js";
import { cellOf, loadState } from "./store.js";
import { columnProtected, nameTaken, undoSpec } from "./undo.js";
import { type ErrorValue, MESSAGES, TOOLTIPS, acceptValue } from "./values.js";

const NAME_MESSAGES = {
  document: "Use 1 to 80 characters without line breaks or control characters.",
  table: "Use 1 to 40 letters, digits or underscores, starting with a letter.",
  tableTaken: "A table with this name already exists.",
  column: "Use 1 to 60 characters without square brackets.",
  columnTaken: "A column with this name already exists.",
  summaryTable: "Summary tables are calculated and cannot be edited.",
  summaryRename: "Summary names follow their source table and columns.",
  typeLocked: "This column's type cannot be changed.",
  columnRevision: "Send the column's revision.",
  tableRevision: "Send the table's revision.",
  rowRevision: "Send the row's revision.",
  cellRevision: "Send the cell's revision.",
  pasteCount: "Send 1 to 500 cell writes.",
  pasteTwice: "Each cell can be written once per paste.",
  ownerColumn: "Choose a Text column.",
  rowId: "Choose a row in this table.",
} as const;

const COLUMN_TYPES: ColumnType[] = ["text", "decimal", "date", "bool", "reference", "formula"];
const DATA_TYPES: DataType[] = ["text", "decimal", "date", "bool"];
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

const body = (req: Request): { [key: string]: Json } => (isObject(req.body) ? req.body : {});

function documentNameError(name: Json | undefined): string | null {
  if (typeof name !== "string") return NAME_MESSAGES.document;
  const length = Array.from(name).length;
  return length < 1 || length > 80 || CONTROL.test(name) ? NAME_MESSAGES.document : null;
}

function tableNameError(c: EditContext, name: Json | undefined, except: string | null): string | null {
  if (typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name)) return NAME_MESSAGES.table;
  const taken = c.state.tables.some((t) => t.kind === "table" && t.id !== except && t.name.toLowerCase() === name.toLowerCase());
  return taken ? NAME_MESSAGES.tableTaken : null;
}

function columnNameError(c: EditContext, tableId: string, name: Json | undefined, except: string | null): string | null {
  if (typeof name !== "string") return NAME_MESSAGES.column;
  const length = Array.from(name).length;
  if (length < 1 || length > 60 || /[[\]]/.test(name)) return NAME_MESSAGES.column;
  return nameTaken(c, tableId, name, except ?? "") ? NAME_MESSAGES.columnTaken : null;
}

const fail = (fields: Record<string, string>) => {
  if (Object.keys(fields).length) throw invalid(fields);
};

const writer = (c: EditContext) => may(c.access, "write");
const owner = (c: EditContext) => may(c.access, "own");

// ---- reads ------------------------------------------------------------------------

export async function listDocuments(account: Account): Promise<Reply> {
  const rows = await query<{ id: string; name: string; role: string }>(
    `SELECT d.id, d.name, CASE WHEN d.owner_id = $1 THEN 'owner' ELSE s.role END AS role
     FROM documents d LEFT JOIN shares s ON s.document_id = d.id AND s.email = $2
     WHERE d.owner_id = $1 OR s.id IS NOT NULL ORDER BY d.name, d.created_at`,
    [account.id, account.email],
  );
  return json(200, { documents: rows });
}

export async function createDocument(req: Request, account: Account): Promise<Reply> {
  const name = body(req).name;
  const message = documentNameError(name);
  if (message) throw invalid({ name: message });
  const id = newId("d");
  await query("INSERT INTO documents (id, name, owner_id) VALUES ($1, $2, $3)", [id, name, account.id]);
  return json(201, { document: { id, name, role: "owner" } });
}

// A read at one point in the edit order, in the caller's view.
function readDocument<T>(account: Account, docId: string, work: (ev: Evaluation, stacks: () => Promise<{ undo_count: number; redo_count: number }>, revision: number) => Promise<T> | T) {
  return transaction(async (db) => {
    const { doc, access } = await documentAccess(db, docId, account, false);
    const ev = new Evaluation(await loadState(db, doc), access);
    return work(ev, () => stacksOf(db, docId, account.id), doc.revision);
  }, "REPEATABLE READ");
}

export function getDocument(account: Account, docId: string): Promise<Reply> {
  return readDocument(account, docId, async (ev, stacks, revision) => {
    const s = await stacks();
    return json(200, {
      document: {
        id: ev.state.id,
        name: ev.state.name,
        role: ev.access.role,
        row_scope: ev.access.rowScope,
        revision,
        undo_count: s.undo_count,
        redo_count: s.redo_count,
      },
      tables: ev.orderedTables().map((t) => tableSummaryJson(ev, t)),
    });
  });
}

export function getTable(account: Account, docId: string, tableId: string): Promise<Reply> {
  return readDocument(account, docId, async (ev, stacks, revision) => {
    const table = ev.tables.get(tableId);
    if (!table) throw notFound();
    return json(200, {
      table: tableJson(ev, table),
      access: { role: ev.access.role, row_scope: ev.access.rowScope },
      stacks: await stacks(),
      document_revision: revision,
    });
  });
}

export async function getHistory(account: Account, docId: string): Promise<Reply> {
  return transaction(async (db) => {
    await documentAccess(db, docId, account, false);
    const { rows } = await db.query(
      "SELECT revision, kind, actor_id, table_id FROM history WHERE document_id = $1 ORDER BY revision",
      [docId],
    );
    return json(200, { entries: rows });
  });
}

export function previewFormula(req: Request, account: Account, docId: string, tableId: string): Promise<Reply> {
  return readDocument(account, docId, (ev) => {
    const table = ev.tables.get(tableId);
    if (!table) throw notFound();
    const b = body(req);
    const row = typeof b.row_id === "string" ? ev.row(b.row_id) : undefined;
    if (table.kind !== "table" || !row || row.tableId !== tableId || !ev.isVisible(row)) throw invalid({ row_id: NAME_MESSAGES.rowId });
    const reading = readFormula(typeof b.formula === "string" ? b.formula : "");
    if (!reading.ok) return json(200, { display: null, kind: null, diagnosis: reading.diagnosis });
    const out = ev.preview(reading.expr, row, tableId);
    return json(200, { display: out.display, kind: out.kind, diagnosis: out.kind === "error" ? TOOLTIPS[out.display as ErrorValue] : null });
  });
}

// ---- locating ---------------------------------------------------------------------

function liveTable(c: EditContext, tableId: string): TableRec {
  const table = c.ev.tables.get(tableId);
  if (!table) throw notFound();
  return table;
}

function liveColumn(c: EditContext, table: TableRec, columnId: string): ColumnRec {
  const column = c.ev.column(columnId);
  if (!column || column.deleted || column.tableId !== table.id) throw notFound();
  return column;
}

function visibleRow(c: EditContext, table: TableRec, rowId: string): RowRec {
  const row = c.ev.row(rowId);
  if (!row || row.tableId !== table.id || !c.ev.isVisible(row)) throw notFound();
  return row;
}

function notSummary(table: TableRec, message: string = NAME_MESSAGES.summaryTable): void {
  if (table.kind === "summary") throw invalid({ table: message });
}

// ---- edits ------------------------------------------------------------------------

export const createTable = (req: Request): EditSpec => ({
  allowed: owner,
  apply: (c) => {
    const name = body(req).name;
    const message = tableNameError(c, name, null);
    fail(message ? { name: message } : {});
    const table: TableRec = {
      id: newId("t"), name: name as string, kind: "table", revision: 1, ownerColumnId: null, sourceTableId: null,
      groupBy: [], sumColumns: [], seq: Math.max(0, ...c.next.tables.map((t) => t.seq)) + 1, writer: c.changeId,
    };
    c.next.tables.push(table);
    return {
      status: 201, kind: "table_add", tableId: table.id, seeds: new Set(), direct: new Set(),
      body: (after) => ({ table: tableJson(after, table) }),
    };
  },
});

export const renameTable = (req: Request, tableId: string): EditSpec => ({
  locate: (c) => void liveTable(c, tableId),
  allowed: owner,
  apply: (c) => {
    const table = c.next.tables.find((t) => t.id === tableId)!;
    const b = body(req);
    const revision = wholeNumber(b.revision);
    if (isStale(revision, table.revision)) {
      throw new ApiError(409, "stale_revision", "Someone else renamed this table first.", {
        current: { table: { id: table.id, name: c.ev.tableName(table), revision: table.revision } },
      });
    }
    notSummary(table, NAME_MESSAGES.summaryRename);
    const fields: Record<string, string> = {};
    if (revision === null) fields.revision = NAME_MESSAGES.tableRevision;
    const message = tableNameError(c, b.name, table.id);
    if (message) fields.name = message;
    fail(fields);
    const name = b.name as string;
    const rewrites = tableRenameRewrites(c.ev, table.id, name);
    const payload = { tableId: table.id, prevWriter: table.writer, before: table.name, after: name, rewrites };
    table.name = name;
    table.revision++;
    table.writer = c.changeId;
    const direct = c.m.rewriteFormulas(rewrites, false, () => c.changeId);
    return {
      status: 200, kind: "table_rename", tableId: table.id, seeds: new Set(), direct,
      undo: { kind: "table_rename", tableId: table.id, payload },
      body: () => ({ table: { id: table.id, name: table.name, revision: table.revision } }),
    };
  },
});

// Reads `formula` for a Formula column; one leading equals sign is removed before storing.
function formulaField(value: Json | undefined): { text: string } | { message: string } {
  const reading = readFormula(typeof value === "string" ? value : "");
  return reading.ok ? { text: reading.text } : { message: reading.diagnosis };
}

export const addColumn = (req: Request, tableId: string): EditSpec => ({
  locate: (c) => void liveTable(c, tableId),
  allowed: owner,
  apply: (c) => {
    const table = liveTable(c, tableId);
    notSummary(table);
    const b = body(req);
    const fields: Record<string, string> = {};
    const nameMessage = columnNameError(c, tableId, b.name, null);
    if (nameMessage) fields.name = nameMessage;
    const type = b.type as ColumnType;
    if (!COLUMN_TYPES.includes(type)) fields.type = "Choose Text, Decimal, Date, Bool, Reference or Formula.";
    let target: string | null = null;
    if (type === "reference") {
      const t = typeof b.target_table_id === "string" ? c.ev.tables.get(b.target_table_id) : undefined;
      if (!t || t.kind !== "table") fields.target_table_id = "Choose the table this column links to.";
      else target = t.id;
    }
    let formula: string | null = null;
    if (type === "formula") {
      const f = formulaField(b.formula);
      if ("message" in f) fields.formula = f.message;
      else formula = f.text;
    } else if (b.formula !== undefined && b.formula !== null) fields.formula = "Only Formula columns have a formula.";
    fail(fields);
    const column: ColumnRec = {
      id: newId("c"), tableId, name: b.name as string, type, formula, targetTableId: target,
      position: c.m.nextPosition(tableId), revision: 1, deleted: false, writer: c.changeId,
    };
    c.next.columns.push(column);
    const keys = c.next.rows.filter((r) => r.tableId === tableId).map((r) => cellKey(r.id, column.id));
    return {
      status: 201, kind: "column_add", tableId,
      seeds: type === "formula" ? new Set() : new Set(keys),
      direct: type === "formula" ? new Set(keys) : new Set(),
      undo: { kind: "column_add", tableId, payload: { tableId, columnId: column.id, prevWriter: "" } },
      body: () => ({ column: columnJson(column) }),
    };
  },
});

export const updateColumn = (req: Request, tableId: string, columnId: string): EditSpec => ({
  locate: (c) => {
    const table = liveTable(c, tableId);
    if (table.kind === "table") liveColumn(c, table, columnId);
  },
  // An Editor may change a formula; a name or type change is the Owner's alone.
  allowed: (c) => may(c.access, body(req).name === undefined && body(req).type === undefined ? "write" : "own"),
  apply: (c) => {
    const table = liveTable(c, tableId);
    notSummary(table);
    const column = c.m.column(columnId);
    const b = body(req);
    const revision = wholeNumber(b.revision);
    if (isStale(revision, column.revision)) {
      throw new ApiError(409, "stale_revision", "Someone else changed this column first.", { current: { column: columnJson(column) } });
    }
    const fields: Record<string, string> = {};
    if (revision === null) fields.revision = NAME_MESSAGES.columnRevision;
    if (b.name !== undefined) {
      const message = columnNameError(c, tableId, b.name, column.id);
      if (message) fields.name = message;
    }
    const type = b.type as DataType | undefined;
    if (type !== undefined && type !== column.type) {
      if (!DATA_TYPES.includes(column.type as DataType) || !DATA_TYPES.includes(type)) fields.type = NAME_MESSAGES.typeLocked;
    }
    let formula = column.formula;
    if (b.formula !== undefined) {
      if (column.type !== "formula") fields.formula = "Only Formula columns have a formula.";
      else {
        const f = formulaField(b.formula);
        if ("message" in f) fields.formula = f.message;
        else formula = f.text;
      }
    }
    fail(fields);
    const before = { name: column.name, type: column.type, formula: column.formula };
    const prevWriter = column.writer;
    const name = (b.name as string | undefined) ?? column.name;
    const rewrites = name !== column.name ? columnRenameRewrites(c.ev, column, name) : [];
    const direct = c.m.rewriteFormulas(rewrites, false, () => c.changeId);
    let converted: CellChange[] = [];
    if (type !== undefined && type !== column.type) {
      converted = c.m.convertColumn(column, type);
      for (const ch of converted) direct.add(cellKey(ch.row, ch.column));
    }
    if (formula !== column.formula) {
      for (const row of c.next.rows.filter((r) => r.tableId === tableId)) direct.add(cellKey(row.id, column.id));
    }
    column.name = name;
    column.formula = formula;
    column.revision++;
    column.writer = c.changeId;
    const after = { name: column.name, type: column.type, formula: column.formula };
    return {
      status: 200, kind: "column_update", tableId, seeds: new Set(), direct,
      undo: { kind: "column_update", tableId, payload: { tableId, columnId, prevWriter, before, after, rewrites, converted } },
      body: () => ({ column: columnJson(column) }),
    };
  },
});

export const deleteColumn = (tableId: string, columnId: string): EditSpec => ({
  locate: (c) => {
    const table = liveTable(c, tableId);
    if (table.kind === "table") liveColumn(c, table, columnId);
  },
  allowed: owner,
  apply: (c) => {
    notSummary(liveTable(c, tableId));
    const protectedBy = columnProtected(c, tableId, columnId);
    if (protectedBy === "column_in_summary") throw new ApiError(409, protectedBy, "A summary uses this column.");
    if (protectedBy) throw new ApiError(409, protectedBy, "This column decides who sees each row.");
    const column = c.m.column(columnId);
    const prevWriter = column.writer;
    column.deleted = true;
    column.writer = c.changeId;
    return {
      status: 200, kind: "column_delete", tableId,
      seeds: new Set(c.next.rows.filter((r) => r.tableId === tableId).map((r) => cellKey(r.id, columnId))),
      direct: new Set(),
      undo: { kind: "column_delete", tableId, payload: { tableId, columnId, prevWriter } },
      body: () => ({}),
    };
  },
});

export const setAccess = (req: Request, tableId: string): EditSpec => ({
  locate: (c) => void liveTable(c, tableId),
  allowed: owner,
  apply: (c) => {
    notSummary(liveTable(c, tableId));
    const value = body(req).owner_column_id;
    const column = typeof value === "string" ? c.ev.column(value) : undefined;
    if (value !== null && (!column || column.deleted || column.tableId !== tableId || column.type !== "text")) {
      throw invalid({ owner_column_id: NAME_MESSAGES.ownerColumn });
    }
    const table = c.next.tables.find((t) => t.id === tableId)!;
    table.ownerColumnId = column?.id ?? null;
    table.writer = c.changeId;
    return {
      status: 200, kind: "access_update", tableId, seeds: new Set(), direct: new Set(),
      body: () => ({ table: { id: tableId, owner_column_id: table.ownerColumnId } }),
    };
  },
});

// Checks one written value against its column, the caller's view and the own-rows rule.
function checkValue(c: EditContext, table: TableRec, column: ColumnRec, value: Json | undefined): { stored: Stored } | { message: string } {
  if (column.type === "formula") return { message: MESSAGES.formulaCell };
  if (column.type === "reference") {
    if (value === null || value === undefined || value === "") return { stored: null };
    const target = typeof value === "string" ? c.ev.row(value) : undefined;
    if (!target || target.tableId !== column.targetTableId || !c.ev.isVisible(target)) {
      return { message: MESSAGES.reference(c.ev.tableName(c.ev.tables.get(column.targetTableId!)!)) };
    }
    return { stored: target.id };
  }
  const accepted = acceptValue(column.type as DataType, value);
  if (!accepted.ok) return { message: accepted.message };
  if (ownRowsOnly(c.access, table) && table.ownerColumnId === column.id && !isOwnEmail(c.access, accepted.stored)) {
    return { message: MESSAGES.ownRows };
  }
  return { stored: accepted.stored };
}

export const addRow = (req: Request, tableId: string): EditSpec => ({
  locate: (c) => void liveTable(c, tableId),
  allowed: writer,
  apply: (c) => {
    const table = liveTable(c, tableId);
    notSummary(table);
    const given = body(req).cells;
    if (given !== undefined && !isObject(given)) throw invalid({ cells: "Send the row's cells as an object of column ids." });
    const values: Record<string, Stored> = {};
    const fields: Record<string, string> = {};
    for (const [columnId, value] of Object.entries(given ?? {})) {
      const column = c.ev.column(columnId);
      if (!column || column.deleted || column.tableId !== tableId) {
        fields[columnId] = "Choose a column of this table.";
        continue;
      }
      const checked = checkValue(c, table, column, value);
      if ("message" in checked) fields[columnId] = checked.message;
      else values[columnId] = checked.stored;
    }
    fail(fields);
    if (ownRowsOnly(c.access, table)) values[table.ownerColumnId!] = c.access.email;
    const row = c.m.addRow(tableId, values);
    const seeds = new Set([rowsNode(tableId)]);
    for (const column of c.ev.columns(tableId)) if (column.type !== "formula") seeds.add(cellKey(row.id, column.id));
    return {
      status: 201, kind: "row_add", tableId, seeds, direct: new Set(),
      undo: { kind: "row_add", tableId, payload: { tableId, rowId: row.id, prevWriter: "", broken: [] } },
      body: (after) => ({ row: rowJson(after, after.row(row.id)!) }),
    };
  },
});

export const deleteRow = (req: Request, tableId: string, rowId: string): EditSpec => ({
  locate: (c) => {
    const table = liveTable(c, tableId);
    if (table.kind === "table") visibleRow(c, table, rowId);
  },
  allowed: writer,
  apply: (c) => {
    notSummary(liveTable(c, tableId));
    const row = c.m.row(rowId);
    const revision = wholeNumber(req.query.get("revision") ?? undefined);
    if (isStale(revision, row.revision)) {
      throw new ApiError(409, "stale_revision", "Someone else changed this row first.", { current: { row: rowJson(c.ev, row) } });
    }
    if (revision === null) throw invalid({ revision: NAME_MESSAGES.rowRevision });
    const prevWriter = row.writer;
    const broken = c.m.deleteRow(rowId);
    const seeds = new Set([rowsNode(tableId)]);
    for (const column of c.ev.columns(tableId)) seeds.add(cellKey(rowId, column.id));
    return {
      status: 200, kind: "row_delete", tableId, seeds,
      direct: new Set(broken.map((b) => cellKey(b.row, b.column))),
      undo: { kind: "row_delete", tableId, payload: { tableId, rowId, prevWriter, broken } },
      body: () => ({}),
    };
  },
});

function currentCell(c: EditContext, row: RowRec, column: ColumnRec) {
  const out = c.ev.out(row, column);
  return { value: out.value, display: out.display, revision: out.revision };
}

export const writeCell = (req: Request, tableId: string, rowId: string, columnId: string): EditSpec => ({
  locate: (c) => {
    const table = liveTable(c, tableId);
    if (table.kind === "table") {
      visibleRow(c, table, rowId);
      liveColumn(c, table, columnId);
    }
  },
  allowed: writer,
  apply: (c) => {
    const table = liveTable(c, tableId);
    notSummary(table);
    const row = c.ev.row(rowId)!;
    const column = c.ev.column(columnId)!;
    const b = body(req);
    if (column.type === "formula") throw invalid({ value: MESSAGES.formulaCell });
    const revision = wholeNumber(b.revision);
    const current = cellOf(c.state, rowId, columnId).revision;
    if (isStale(revision, current)) {
      throw new ApiError(409, "stale_revision", "Someone else changed this cell first.", { current: currentCell(c, row, column) });
    }
    const fields: Record<string, string> = {};
    if (revision === null) fields.revision = NAME_MESSAGES.cellRevision;
    const checked = checkValue(c, table, column, b.value);
    if ("message" in checked) fields.value = checked.message;
    fail(fields);
    const change = c.m.setCell(rowId, columnId, (checked as { stored: Stored }).stored);
    return {
      status: 200, kind: "cell_write", tableId, seeds: new Set([cellKey(rowId, columnId)]), direct: new Set(),
      undo: { kind: "cell_write", tableId, payload: { tableId, type: { [columnId]: column.type }, changes: [change] } },
      body: (after) => ({ cell: cellJson(after.out(after.row(rowId)!, after.column(columnId)!)) }),
    };
  },
});

interface PasteWrite {
  rowId: string;
  columnId: string;
  value: Json | undefined;
  revision: Json | undefined;
}

export const paste = (req: Request, tableId: string): EditSpec => {
  const writes = body(req).writes;
  const wellFormed: PasteWrite[] = Array.isArray(writes)
    ? writes.flatMap((w) =>
        isObject(w) && typeof w.row_id === "string" && typeof w.column_id === "string"
          ? [{ rowId: w.row_id, columnId: w.column_id, value: w.value, revision: w.revision }]
          : [],
      )
    : [];
  return {
    locate: (c) => {
      const table = liveTable(c, tableId);
      if (table.kind !== "table") return;
      for (const w of wellFormed) {
        visibleRow(c, table, w.rowId);
        liveColumn(c, table, w.columnId);
      }
    },
    allowed: writer,
    apply: (c) => {
      const table = liveTable(c, tableId);
      notSummary(table);
      const conflicts = [];
      if (Array.isArray(writes) && wellFormed.length === writes.length) {
        for (const w of wellFormed) {
          const column = c.ev.column(w.columnId)!;
          if (column.type === "formula") continue;
          if (isStale(wholeNumber(w.revision), cellOf(c.state, w.rowId, w.columnId).revision)) {
            conflicts.push({ row_id: w.rowId, column_id: w.columnId, current: currentCell(c, c.ev.row(w.rowId)!, column) });
          }
        }
      }
      if (conflicts.length) {
        throw new ApiError(409, "stale_revision", "Someone else changed these cells first.", { current: conflicts[0]!.current, conflicts });
      }
      if (!Array.isArray(writes) || writes.length < 1 || writes.length > 500 || wellFormed.length !== writes.length) {
        throw invalid({ writes: NAME_MESSAGES.pasteCount });
      }
      const seen = new Set(wellFormed.map((w) => cellKey(w.rowId, w.columnId)));
      if (seen.size !== wellFormed.length) throw invalid({ writes: NAME_MESSAGES.pasteTwice });
      const fields: Record<string, string> = {};
      const accepted: { w: PasteWrite; stored: Stored }[] = [];
      for (const w of wellFormed) {
        const key = `${w.rowId}:${w.columnId}`;
        const column = c.ev.column(w.columnId)!;
        const checked = checkValue(c, table, column, w.value);
        if ("message" in checked) fields[key] = checked.message;
        else if (wholeNumber(w.revision) === null) fields[key] = NAME_MESSAGES.cellRevision;
        else accepted.push({ w, stored: checked.stored });
      }
      fail(fields);
      const types: Record<string, ColumnType> = {};
      const changes = accepted.map(({ w, stored }) => {
        types[w.columnId] = c.ev.column(w.columnId)!.type;
        return c.m.setCell(w.rowId, w.columnId, stored);
      });
      return {
        status: 200, kind: "cell_batch", tableId,
        seeds: new Set(wellFormed.map((w) => cellKey(w.rowId, w.columnId))), direct: new Set(),
        undo: { kind: "cell_batch", tableId, payload: { tableId, type: types, changes } },
        body: (after) => ({
          cells: wellFormed.map((w) => ({
            row_id: w.rowId, column_id: w.columnId, cell: cellJson(after.out(after.row(w.rowId)!, after.column(w.columnId)!)),
          })),
        }),
      };
    },
  };
};

export const createSummary = (req: Request): EditSpec => ({
  allowed: owner,
  apply: (c) => {
    const b = body(req);
    const fields: Record<string, string> = {};
    const source = typeof b.source_table_id === "string" ? c.ev.tables.get(b.source_table_id) : undefined;
    if (!source || source.kind !== "table") fields.source_table_id = "Choose a table to summarise.";
    const ids = (v: Json | undefined) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null);
    const ofSource = (id: string) => {
      const col = c.ev.column(id);
      return col && !col.deleted && source && col.tableId === source.id ? col : null;
    };
    const groupBy = ids(b.group_by);
    if (!groupBy || groupBy.length < 1 || groupBy.length > 3 || new Set(groupBy).size !== groupBy.length || !groupBy.every(ofSource)) {
      fields.group_by = "Choose 1 to 3 different columns of the source table.";
    }
    const sums = ids(b.sum_columns ?? []);
    const summable = (id: string) => ["decimal", "formula"].includes(ofSource(id)?.type ?? "");
    if (!sums || sums.length > 5 || new Set(sums).size !== sums.length || !sums.every(summable)) {
      fields.sum_columns = "Choose up to 5 Decimal or Formula columns of the source table.";
    }
    fail(fields);
    const table: TableRec = {
      id: newId("s"), name: "", kind: "summary", revision: 1, ownerColumnId: null, sourceTableId: source!.id,
      groupBy: groupBy!, sumColumns: sums!, seq: Math.max(0, ...c.next.tables.map((t) => t.seq)) + 1, writer: c.changeId,
    };
    c.next.tables.push(table);
    return {
      status: 201, kind: "summary_add", tableId: table.id, seeds: new Set(), direct: new Set(),
      body: (after) => ({ table: tableJson(after, after.tables.get(table.id)!) }),
    } satisfies Outcome;
  },
});

export const undo = () => undoSpec("undo");
export const redo = () => undoSpec("redo");

// The one evaluator: every value, aggregate, summary group and count a person sees is
// computed here, from the stored state, inside their own request and in their own view.
import { createHash } from "node:crypto";
import { Dec } from "./decimal.js";
import { type Arg, type Expr, isTableArg, parseStored, walk } from "./formula.js";
import { isOwnEmail, ownRowsOnly } from "./access.js";
import { stronglyConnected } from "./graph.js";
import type { Access, CellKind, ColumnRec, DataType, DocState, RowRec, TableRec } from "./model.js";
import { cellKey } from "./model.js";
import { BLANK, type Value, dateInRange, display, err, storedValue } from "./values.js";

export interface CellOut {
  value: string | boolean | null;
  display: string;
  kind: CellKind;
  revision: number | null;
  textOrigin: boolean;
}

interface SummaryColumn {
  id: string;
  name: string;
  source: ColumnRec | null; // the group column; null for Count and the Sums
  sumOf: ColumnRec | null;
  position: number;
}

interface Group {
  id: string;
  firstSeq: number;
  rows: RowRec[];
}

interface Summary {
  columns: SummaryColumn[];
  groups: Group[];
}

// Columns are nodes of the dependency graph; a summary column's node is `<summary>|<id>`.
const summaryNode = (summaryId: string, columnId: string) => `${summaryId}|${columnId}`;
export const rowsNode = (tableId: string) => `rows|${tableId}`;

const lower = (s: string) => s.toLowerCase();

function compareText(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

export class Evaluation {
  readonly tables = new Map<string, TableRec>();
  private readonly liveColumns = new Map<string, ColumnRec[]>();
  private readonly columnsById = new Map<string, ColumnRec>();
  private readonly rowsByTable = new Map<string, RowRec[]>();
  private readonly rowsById = new Map<string, RowRec>();
  private readonly visibleCache = new Map<string, RowRec[]>();
  private readonly parsed = new Map<string, Expr>();
  private readonly memo = new Map<string, Value>();
  private readonly aggregateMemo = new Map<Arg | Expr, unknown>();
  private readonly summaries = new Map<string, Summary>();
  readonly circular = new Set<string>();

  constructor(
    readonly state: DocState,
    readonly access: Access,
  ) {
    for (const t of state.tables) this.tables.set(t.id, t);
    for (const c of state.columns) this.columnsById.set(c.id, c);
    for (const t of state.tables) {
      this.liveColumns.set(
        t.id,
        state.columns.filter((c) => c.tableId === t.id && !c.deleted).sort((a, b) => a.position - b.position),
      );
      this.rowsByTable.set(t.id, []);
    }
    for (const r of [...state.rows].sort((a, b) => a.seq - b.seq)) {
      this.rowsById.set(r.id, r);
      this.rowsByTable.get(r.tableId)?.push(r);
    }
    this.findCircular();
  }

  // ---- schema lookups -------------------------------------------------------------

  orderedTables(): TableRec[] {
    return [...this.state.tables].sort((a, b) => a.seq - b.seq);
  }

  columns(tableId: string): ColumnRec[] {
    return this.liveColumns.get(tableId) ?? [];
  }

  column(id: string): ColumnRec | undefined {
    return this.columnsById.get(id);
  }

  row(id: string): RowRec | undefined {
    return this.rowsById.get(id);
  }

  columnByName(tableId: string, name: string): ColumnRec | undefined {
    return this.columns(tableId).find((c) => lower(c.name) === lower(name));
  }

  tableByName(name: string): TableRec | undefined {
    return this.state.tables.find((t) => t.kind === "table" && lower(t.name) === lower(name));
  }

  displayColumn(tableId: string): ColumnRec | undefined {
    return this.columns(tableId)[0];
  }

  tableName(table: TableRec): string {
    if (table.kind === "table") return table.name;
    const source = this.tables.get(table.sourceTableId!)!;
    const names = table.groupBy.map((id) => this.columnsById.get(id)!.name);
    return `${source.name} by ${names.join(" and ")}`;
  }

  expr(column: ColumnRec): Expr {
    let e = this.parsed.get(column.id);
    if (!e) {
      e = parseStored(column.formula!);
      this.parsed.set(column.id, e);
    }
    return e;
  }

  // ---- row access -----------------------------------------------------------------

  // Rows the caller can see, in insertion order. A hidden row does not exist for them.
  visibleRows(tableId: string): RowRec[] {
    let rows = this.visibleCache.get(tableId);
    if (!rows) {
      const table = this.tables.get(tableId)!;
      const all = (this.rowsByTable.get(tableId) ?? []).filter((r) => !r.deleted);
      rows = ownRowsOnly(this.access, table)
        ? all.filter((r) => isOwnEmail(this.access, this.state.cells.get(cellKey(r.id, table.ownerColumnId!))?.value))
        : all;
      this.visibleCache.set(tableId, rows);
    }
    return rows;
  }

  isVisible(row: RowRec | undefined): row is RowRec {
    return !!row && !row.deleted && this.visibleRows(row.tableId).includes(row);
  }

  // ---- dependency graph and cycles ------------------------------------------------

  // Resolves `[A].[B].[C]` from a table: each link is read in the table the previous
  // Reference targets. `columns` is the resolved prefix; `missing` names the first link
  // that matches no column, as `<table id>:<name>`.
  resolveChain(tableId: string, names: string[]): { columns: ColumnRec[]; missing: string | null } {
    const columns: ColumnRec[] = [];
    let table: string | null = tableId;
    for (const name of names) {
      if (table === null) break;
      const column = this.columnByName(table, name);
      if (!column) return { columns, missing: `${table}:${name.toLowerCase()}` };
      columns.push(column);
      table = column.type === "reference" ? column.targetTableId : null;
    }
    return { columns, missing: null };
  }

  // The columns a formula names, resolved against the current schema.
  formulaDependencies(tableId: string, expr: Expr): string[] {
    const deps: string[] = [];
    walk(expr, (node) => {
      if (node.t === "chain") deps.push(...this.resolveChain(tableId, node.links.map((l) => l.name)).columns.map((c) => c.id));
      else if (node.t === "tablecol") {
        const t = this.tableByName(node.table);
        const col = t && this.columnByName(t.id, node.column.name);
        if (col) deps.push(col.id);
      }
    });
    return deps;
  }

  private findCircular(): void {
    const edges = new Map<string, string[]>();
    for (const table of this.state.tables) {
      if (table.kind === "summary") {
        const group = table.groupBy;
        for (const g of group) edges.set(summaryNode(table.id, g), [g]);
        edges.set(summaryNode(table.id, "count"), [...group]);
        for (const s of table.sumColumns) edges.set(summaryNode(table.id, `sum:${s}`), [s, ...group]);
        continue;
      }
      for (const col of this.columns(table.id)) {
        if (col.type === "formula") edges.set(col.id, this.formulaDependencies(table.id, this.expr(col)));
        if (col.type === "reference" && col.targetTableId) {
          const shown = this.displayColumn(col.targetTableId);
          edges.set(col.id, shown ? [shown.id] : []);
        }
      }
    }
    // A strongly connected component of two or more, or a self-loop, is a cycle.
    const onCycle = new Set<string>();
    for (const component of stronglyConnected([...edges.keys()], (v) => edges.get(v) ?? [])) {
      const v = component[0]!;
      if (component.length > 1 || (edges.get(v) ?? []).includes(v)) for (const c of component) onCycle.add(c);
    }
    // Every node that reaches a cycle shows #CIRC! as well.
    const reaches = new Map<string, boolean>();
    const reach = (v: string, path: Set<string>): boolean => {
      if (onCycle.has(v)) return true;
      const known = reaches.get(v);
      if (known !== undefined) return known;
      if (path.has(v)) return false;
      path.add(v);
      const result = (edges.get(v) ?? []).some((w) => reach(w, path));
      path.delete(v);
      reaches.set(v, result);
      return result;
    };
    for (const v of edges.keys()) if (reach(v, new Set())) this.circular.add(v);
  }

  // ---- cell values ----------------------------------------------------------------

  // The value a formula reads from a cell.
  value(row: RowRec, column: ColumnRec): Value {
    const key = cellKey(row.id, column.id);
    const cached = this.memo.get(key);
    if (cached) return cached;
    let result: Value;
    if (this.circular.has(column.id)) result = err("#CIRC!");
    else if (column.type === "formula") {
      result = finish(this.evaluate(this.expr(column), row, column.tableId));
    } else if (column.type === "reference") {
      const target = this.referenceTarget(row, column);
      if (target === "broken") result = err("#REF!");
      else if (target === null) result = BLANK;
      else {
        const shown = this.displayColumn(target.tableId);
        const v = shown ? this.value(target, shown) : BLANK;
        result = v.k === "err" || v.k === "blank" ? v : { k: "text", s: display(v) };
      }
    } else {
      result = storedValue(column.type as DataType, this.state.cells.get(key)?.value ?? null);
    }
    this.memo.set(key, result);
    return result;
  }

  // A Reference's target row: null for blank or hidden, "broken" for a deleted row.
  referenceTarget(row: RowRec, column: ColumnRec): RowRec | null | "broken" {
    const stored = this.state.cells.get(cellKey(row.id, column.id))?.value;
    if (typeof stored !== "string" || stored === "") return null;
    const target = this.rowsById.get(stored);
    if (!target || target.deleted) return "broken";
    return this.isVisible(target) ? target : null;
  }

  out(row: RowRec, column: ColumnRec): CellOut {
    const revision = column.type === "formula" ? null : (this.state.cells.get(cellKey(row.id, column.id))?.revision ?? 1);
    const v = this.value(row, column);
    if (column.type === "reference" && v.k === "text") {
      const target = this.referenceTarget(row, column) as RowRec;
      const shown = this.displayColumn(target.tableId);
      const origin = shown ? this.out(target, shown).textOrigin : false;
      return { value: target.id, display: v.s, kind: "reference", revision, textOrigin: origin };
    }
    return { ...valueOut(v), revision };
  }

  // An unsaved formula evaluated for one row, finished like a saved cell.
  preview(expr: Expr, row: RowRec, tableId: string): Omit<CellOut, "revision"> {
    if (this.formulaDependencies(tableId, expr).some((id) => this.circular.has(id))) return valueOut(err("#CIRC!"));
    return valueOut(finish(this.evaluate(expr, row, tableId)));
  }

  // ---- the formula language -------------------------------------------------------

  evaluate(expr: Expr, row: RowRec, tableId: string): Value {
    switch (expr.t) {
      case "num":
        return { k: "dec", d: expr.value };
      case "str":
        return { k: "text", s: expr.value };
      case "bool":
        return { k: "bool", b: expr.value };
      case "chain":
        return this.chain(expr.links.map((l) => l.name), row, tableId);
      case "neg": {
        const v = this.evaluate(expr.operand, row, tableId);
        if (v.k === "err") return v;
        if (v.k === "blank") return { k: "dec", d: Dec.zero };
        return v.k === "dec" ? { k: "dec", d: v.d.neg() } : err("#TYPE!");
      }
      case "bin": {
        const left = this.evaluate(expr.left, row, tableId);
        const right = this.evaluate(expr.right, row, tableId);
        if (left.k === "err") return left;
        if (right.k === "err") return right;
        return binary(expr.op, left, right);
      }
      case "call":
        return this.call(expr.name, expr.args, row, tableId);
    }
  }

  private chain(names: string[], start: RowRec, tableId: string): Value {
    let row = start;
    let table = tableId;
    for (let i = 0; i < names.length; i++) {
      const column = this.columnByName(table, names[i]!);
      if (!column) return err("#NAME?");
      if (i === names.length - 1) return this.value(row, column);
      if (column.type !== "reference" || !column.targetTableId) return err("#TYPE!");
      if (this.circular.has(column.id)) return err("#CIRC!");
      const target = this.referenceTarget(row, column);
      if (target === "broken") return err("#REF!");
      if (target === null) {
        // A blank Reference reads blank, unless a later name does not exist.
        const rest = names.slice(i + 1);
        return this.resolveChain(column.targetTableId, rest).columns.length === rest.length ? BLANK : err("#NAME?");
      }
      row = target;
      table = column.targetTableId;
    }
    return BLANK;
  }

  // Resolves a `T.[C]` argument to its table's visible rows and the column.
  private columnArg(arg: Arg): { rows: RowRec[]; column: ColumnRec } | Value {
    if (arg.t !== "tablecol") return err("#TYPE!");
    const table = this.tableByName(arg.table);
    if (!table) return err("#NAME?");
    const column = this.columnByName(table.id, arg.column.name);
    if (!column) return err("#NAME?");
    return { rows: this.visibleRows(table.id), column };
  }

  // The values of an aggregated column: the first error in insertion order wins.
  private columnValues(rows: RowRec[], column: ColumnRec): Value[] | Value {
    const values = rows.map((r) => this.value(r, column));
    return values.find((v) => v.k === "err") ?? values;
  }

  private aggregate(arg: Arg, fn: (values: Value[]) => Value): Value {
    const cached = this.aggregateMemo.get(arg) as Value | undefined;
    if (cached) return cached;
    const resolved = this.columnArg(arg);
    let result: Value;
    if ("k" in resolved) result = resolved;
    else {
      const values = this.columnValues(resolved.rows, resolved.column);
      result = Array.isArray(values) ? fn(values) : values;
    }
    this.aggregateMemo.set(arg, result);
    return result;
  }

  private call(name: string, args: Arg[], row: RowRec, tableId: string): Value {
    const arity: Record<string, number> = {
      SUM: 1, COUNT: 1, SUMBY: 2, COUNTBY: 1, MIN: 1, MAX: 1, AVERAGE: 1, ROUND: 2, IF: 3, IFERROR: 2,
    };
    const expected = arity[name];
    if (expected === undefined) return err("#NAME?");
    if (args.length !== expected) return err("#TYPE!");
    const plain = (i: number): Value => {
      const a = args[i]!;
      return isTableArg(a) ? err("#TYPE!") : this.evaluate(a, row, tableId);
    };
    switch (name) {
      case "SUM":
        return this.aggregate(args[0]!, (values) => sum(values));
      case "MIN":
      case "MAX":
        return this.aggregate(args[0]!, (values) => {
          let best: Dec | null = null;
          for (const v of values) {
            if (v.k === "blank") continue;
            if (v.k !== "dec") return err("#TYPE!");
            if (best === null || (name === "MIN" ? v.d.compare(best) < 0 : v.d.compare(best) > 0)) best = v.d;
          }
          return best === null ? BLANK : { k: "dec", d: best };
        });
      case "AVERAGE":
        return this.aggregate(args[0]!, (values) => {
          let total = Dec.zero;
          let count = 0;
          for (const v of values) {
            if (v.k === "blank") continue;
            if (v.k !== "dec") return err("#TYPE!");
            total = total.add(v.d);
            count++;
          }
          return count === 0 ? err("#DIV/0!") : { k: "dec", d: total.div(Dec.of(BigInt(count))) };
        });
      case "COUNT": {
        const a = args[0]!;
        if (a.t !== "table") return err("#TYPE!");
        const table = this.tableByName(a.table);
        return table ? { k: "dec", d: Dec.of(BigInt(this.visibleRows(table.id).length)) } : err("#NAME?");
      }
      case "SUMBY":
      case "COUNTBY":
        return this.byReference(name, args, row, tableId);
      case "ROUND": {
        const x = plain(0);
        if (x.k === "err") return x;
        const n = plain(1);
        if (n.k === "err") return n;
        if ((x.k !== "dec" && x.k !== "blank") || n.k !== "dec" || !n.d.isWhole()) return err("#TYPE!");
        const places = Number(n.d.coefficient);
        if (places < 0 || places > 4) return err("#TYPE!");
        return { k: "dec", d: (x.k === "dec" ? x.d : Dec.zero).round(places) };
      }
      case "IF": {
        const cond = plain(0);
        if (cond.k === "err") return cond;
        if (cond.k !== "bool" && cond.k !== "blank") return err("#TYPE!");
        return plain(cond.k === "bool" && cond.b ? 1 : 2);
      }
      default: {
        const x = plain(0);
        return x.k === "err" && x.e !== "#CIRC!" ? plain(1) : x;
      }
    }
  }

  // SUMBY and COUNTBY: the rows whose Reference points at the current row.
  private byReference(name: string, args: Arg[], row: RowRec, tableId: string): Value {
    const refArg = args[name === "SUMBY" ? 1 : 0]!;
    const ref = this.columnArg(refArg);
    if ("k" in ref) return ref;
    let sumColumn: ColumnRec | null = null;
    if (name === "SUMBY") {
      const summed = this.columnArg(args[0]!);
      if ("k" in summed) return summed;
      if (summed.column.tableId !== ref.column.tableId) return err("#TYPE!");
      sumColumn = summed.column;
    }
    if (ref.column.type !== "reference" || ref.column.targetTableId !== tableId) return err("#TYPE!");
    let index = this.aggregateMemo.get(refArg) as Map<string, RowRec[]> | undefined;
    if (!index) {
      index = new Map();
      for (const r of ref.rows) {
        const target = this.referenceTarget(r, ref.column);
        if (target && target !== "broken") index.set(target.id, [...(index.get(target.id) ?? []), r]);
      }
      this.aggregateMemo.set(refArg, index);
    }
    const matching = index.get(row.id) ?? [];
    if (sumColumn === null) return { k: "dec", d: Dec.of(BigInt(matching.length)) };
    const values = this.columnValues(matching, sumColumn);
    return Array.isArray(values) ? sum(values) : values;
  }

  // ---- summaries ------------------------------------------------------------------

  summary(table: TableRec): Summary {
    let s = this.summaries.get(table.id);
    if (s) return s;
    const groupColumns = table.groupBy.map((id) => this.columnsById.get(id)!);
    const sumColumns = table.sumColumns
      .map((id) => this.columnsById.get(id)!)
      .sort((a, b) => a.position - b.position);
    const columns: SummaryColumn[] = [
      ...groupColumns.map((c, i) => ({ id: c.id, name: c.name, source: c, sumOf: null, position: i })),
      { id: "count", name: "Count", source: null, sumOf: null, position: groupColumns.length },
      ...sumColumns.map((c, i) => ({
        id: `sum:${c.id}`, name: `Sum of ${c.name}`, source: null, sumOf: c, position: groupColumns.length + 1 + i,
      })),
    ];
    const groups = new Map<string, Group>();
    for (const r of this.visibleRows(table.sourceTableId!)) {
      const key = JSON.stringify(groupColumns.map((c) => this.groupKey(r, c)));
      let g = groups.get(key);
      if (!g) {
        const id = `g${createHash("sha256").update(`${table.id}\u0000${key}`).digest("hex").slice(0, 20)}`;
        g = { id, firstSeq: r.seq, rows: [] };
        groups.set(key, g);
      }
      g.rows.push(r);
    }
    s = { columns, groups: [...groups.values()] };
    this.summaries.set(table.id, s);
    return s;
  }

  private groupKey(row: RowRec, column: ColumnRec): string | null | [string] {
    if (column.type === "reference" && !this.circular.has(column.id)) {
      const target = this.referenceTarget(row, column);
      if (target === null) return null;
      return target === "broken" ? "#REF!" : [target.id];
    }
    const v = this.value(row, column);
    return v.k === "blank" ? null : display(v);
  }

  summaryOut(table: TableRec, group: Group, column: SummaryColumn): CellOut {
    const first = group.rows[0]!;
    const node = summaryNode(table.id, column.id);
    if (this.circular.has(node)) return { ...valueOut(err("#CIRC!")), revision: null };
    if (column.source) return { ...this.out(first, column.source), revision: null };
    if (!column.sumOf) return { ...valueOut({ k: "dec", d: Dec.of(BigInt(group.rows.length)) }), revision: null };
    const values = this.columnValues(group.rows, column.sumOf);
    return { ...valueOut(Array.isArray(values) ? sum(values) : values), revision: null };
  }

  // ---- inputs, for recalculation depth ---------------------------------------------

  // The cells a computed cell reads, as node keys (`row|column` or `rows|table`).
  inputs(tableId: string, rowId: string, columnId: string): string[] {
    const table = this.tables.get(tableId);
    if (!table) return [];
    if (table.kind === "summary") {
      const s = this.summary(table);
      const group = s.groups.find((g) => g.id === rowId);
      const column = s.columns.find((c) => c.id === columnId);
      if (!group || !column) return [];
      const read = [...table.groupBy, ...(column.sumOf ? [column.sumOf.id] : [])];
      return group.rows.flatMap((r) => read.map((c) => cellKey(r.id, c)));
    }
    const row = this.rowsById.get(rowId);
    const column = this.columnsById.get(columnId);
    if (!row || !column) return [];
    if (column.type === "reference") {
      const target = this.referenceTarget(row, column);
      const shown = target && target !== "broken" ? this.displayColumn(target.tableId) : undefined;
      return target && target !== "broken" && shown ? [cellKey(target.id, shown.id)] : [];
    }
    if (column.type !== "formula") return [];
    const found: string[] = [];
    walk(this.expr(column), (node) => {
      if (node.t === "chain") {
        let r: RowRec | null = row;
        let t: string | null = tableId;
        for (const link of node.links) {
          if (!r || t === null) break;
          const c = this.columnByName(t, link.name);
          if (!c) break;
          found.push(cellKey(r.id, c.id));
          if (c.type !== "reference") break;
          const target = this.referenceTarget(r, c);
          const next = target && target !== "broken" ? target : null;
          r = next;
          t = c.targetTableId;
        }
      } else if (node.t === "tablecol" || node.t === "table") {
        const t = this.tableByName(node.table);
        if (!t) return;
        found.push(rowsNode(t.id));
        const c = node.t === "tablecol" ? this.columnByName(t.id, node.column.name) : undefined;
        if (c) for (const r of this.visibleRows(t.id)) found.push(cellKey(r.id, c.id));
      }
    });
    return found;
  }
}

function valueOut(v: Value): Omit<CellOut, "revision"> {
  switch (v.k) {
    case "blank":
      return { value: null, display: "", kind: "blank", textOrigin: false };
    case "dec":
      return { value: v.d.display(), display: v.d.display(), kind: "decimal", textOrigin: false };
    case "text":
      return { value: v.s, display: v.s, kind: "text", textOrigin: true };
    case "date":
      return { value: display(v), display: display(v), kind: "date", textOrigin: false };
    case "bool":
      return { value: v.b, display: display(v), kind: "bool", textOrigin: false };
    case "err":
      return { value: v.e, display: v.e, kind: "error", textOrigin: false };
  }
}

// Only a cell's final Decimal result is rounded, half away from zero to 4 places.
function finish(v: Value): Value {
  return v.k === "dec" ? { k: "dec", d: v.d.round(4) } : v;
}

function sum(values: Value[]): Value {
  let total = Dec.zero;
  for (const v of values) {
    if (v.k === "blank") continue;
    if (v.k !== "dec") return err("#TYPE!");
    total = total.add(v.d);
  }
  return { k: "dec", d: total };
}

function binary(op: string, left: Value, right: Value): Value {
  if (op === "&") return { k: "text", s: display(left) + display(right) };
  if (["=", "<>", "<", ">", "<=", ">="].includes(op)) {
    const c = compareValues(left, right);
    if (c === null) return err("#TYPE!");
    const result = { "=": c === 0, "<>": c !== 0, "<": c < 0, ">": c > 0, "<=": c <= 0, ">=": c >= 0 }[op]!;
    return { k: "bool", b: result };
  }
  const asDec = (v: Value): Dec | null => (v.k === "dec" ? v.d : v.k === "blank" ? Dec.zero : null);
  if (left.k === "date" || right.k === "date") return dateArithmetic(op, left, right);
  const a = asDec(left);
  const b = asDec(right);
  if (a === null || b === null) return err("#TYPE!");
  switch (op) {
    case "+":
      return { k: "dec", d: a.add(b) };
    case "-":
      return { k: "dec", d: a.sub(b) };
    case "*":
      return { k: "dec", d: a.mul(b) };
    default:
      return b.isZero() ? err("#DIV/0!") : { k: "dec", d: a.div(b) };
  }
}

function dateArithmetic(op: string, left: Value, right: Value): Value {
  const whole = (v: Value): number | null =>
    v.k === "blank" ? 0 : v.k === "dec" && v.d.isWhole() ? Number(v.d.coefficient) : null;
  const shifted = (day: number, by: number | null): Value => {
    if (by === null) return err("#TYPE!");
    const next = day + by;
    return dateInRange(next) ? { k: "date", day: next } : err("#TYPE!");
  };
  if (op === "-" && left.k === "date" && right.k === "date") return { k: "dec", d: Dec.of(BigInt(left.day - right.day)) };
  if (op === "+" && left.k === "date" && right.k !== "date") return shifted(left.day, whole(right));
  if (op === "+" && right.k === "date" && left.k !== "date") return shifted(right.day, whole(left));
  if (op === "-" && left.k === "date" && right.k !== "date") {
    const by = whole(right);
    return shifted(left.day, by === null ? null : -by);
  }
  return err("#TYPE!");
}

// Same-type comparison after the blank rules; null when the pairing is not allowed.
function compareValues(left: Value, right: Value): number | null {
  if (left.k === "blank" && right.k === "blank") return 0;
  const blankAs = (other: Value): Value | "earliest" | null => {
    switch (other.k) {
      case "dec":
        return { k: "dec", d: Dec.zero };
      case "text":
        return { k: "text", s: "" };
      case "bool":
        return { k: "bool", b: false };
      case "date":
        return "earliest";
      default:
        return null;
    }
  };
  if (left.k === "blank" || right.k === "blank") {
    const other = left.k === "blank" ? right : left;
    const stand = blankAs(other);
    if (stand === null) return null;
    if (stand === "earliest") return left.k === "blank" ? -1 : 1;
    return left.k === "blank" ? compareValues(stand, right) : compareValues(left, stand);
  }
  if (left.k !== right.k) return null;
  switch (left.k) {
    case "dec":
      return left.d.compare((right as { d: Dec }).d);
    case "text":
      return compareText(left.s, (right as { s: string }).s);
    case "date":
      return Math.sign(left.day - (right as { day: number }).day);
    case "bool":
      return Number(left.b) - Number((right as { b: boolean }).b);
    default:
      return null;
  }
}


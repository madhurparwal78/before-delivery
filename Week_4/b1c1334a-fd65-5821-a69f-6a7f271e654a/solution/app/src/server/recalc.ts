// The recalculation list: which cells an edit changed in the caller's view, their
// dependency depth, the order they are listed in, and the counts that go with them.
import type { CellOut, Evaluation } from "./engine.js";
import { stronglyConnected } from "./graph.js";
import type { CellKind } from "./model.js";
import { cellKey } from "./model.js";

interface Seen {
  tableId: string;
  rowId: string;
  columnId: string;
  display: string;
  kind: CellKind;
  order: [number, number, number];
}

interface RecalcCell {
  table_id: string;
  row_id: string;
  column_id: string;
  old_display: string | null;
  new_display: string | null;
  new_kind: CellKind | null;
  depth: number;
}

interface Snapshot {
  cells: Map<string, Seen>;
  rowCounts: Map<string, number>;
  columnCounts: Map<string, number>;
}

// Every cell the caller can see, with the counts shown on the rail.
function snapshot(ev: Evaluation): Snapshot {
  const cells = new Map<string, Seen>();
  const rowCounts = new Map<string, number>();
  const columnCounts = new Map<string, number>();
  const put = (tableId: string, rowId: string, columnId: string, out: CellOut, order: [number, number, number]) =>
    cells.set(cellKey(rowId, columnId), { tableId, rowId, columnId, display: out.display, kind: out.kind, order });
  for (const table of ev.orderedTables()) {
    if (table.kind === "summary") {
      const s = ev.summary(table);
      rowCounts.set(table.id, s.groups.length);
      columnCounts.set(table.id, s.columns.length);
      for (const g of s.groups) for (const c of s.columns) put(table.id, g.id, c.id, ev.summaryOut(table, g, c), [table.seq, g.firstSeq, c.position]);
      continue;
    }
    const rows = ev.visibleRows(table.id);
    const columns = ev.columns(table.id);
    rowCounts.set(table.id, rows.length);
    columnCounts.set(table.id, columns.length);
    for (const r of rows) for (const c of columns) put(table.id, r.id, c.id, ev.out(r, c), [table.seq, r.seq, c.position]);
  }
  return { cells, rowCounts, columnCounts };
}

interface ListResult {
  cells: RecalcCell[];
  count: number;
  tables: number;
  sentence: string;
  row_counts: Record<string, number>;
  column_counts: Record<string, number>;
}

function sentence(count: number, tables: number): string {
  return `Recalculated ${count} ${count === 1 ? "cell" : "cells"} in ${tables} ${tables === 1 ? "table" : "tables"}.`;
}

// `seeds` are the cells (and `rows|<table>` row sets) the action wrote or removed outright;
// `direct` are the cells it changed by rule. Everything else that changed is affected.
export function recalculationList(
  before: Evaluation,
  after: Evaluation,
  seeds: Set<string>,
  direct: Set<string>,
): ListResult {
  const old = snapshot(before);
  const now = snapshot(after);
  const changed = new Map<string, { was?: Seen; is?: Seen }>();
  for (const key of new Set([...old.cells.keys(), ...now.cells.keys()])) {
    if (seeds.has(key)) continue;
    const was = old.cells.get(key);
    const is = now.cells.get(key);
    if (was && is && was.display === is.display && was.kind === is.kind) continue;
    changed.set(key, { was, is });
  }

  // Depth: direct cells are 1; an affected cell is one more than its deepest seed,
  // direct or changed input. The cells of one cycle share a depth.
  // An edit's own inputs come from the state after it; the state before adds only what the
  // edit removed outright (a deleted row or column), or everything for a cell that is gone.
  const inputs = new Map<string, string[]>();
  for (const [key, { was, is }] of changed) {
    const at = (is ?? was)!;
    const counted = (i: string) => i !== key && (seeds.has(i) || changed.has(i));
    const found = new Set(after.inputs(at.tableId, at.rowId, at.columnId).filter(counted));
    for (const i of before.inputs(at.tableId, at.rowId, at.columnId)) {
      if (counted(i) && (!is || seeds.has(i))) found.add(i);
    }
    inputs.set(key, [...found]);
  }
  const depth = new Map<string, number>();
  for (const component of stronglyConnected([...changed.keys()], (k) => inputs.get(k)!.filter((i) => changed.has(i)))) {
    const members = new Set(component);
    let d: number;
    if (component.some((k) => direct.has(k))) d = 1;
    else {
      let deepest = 0;
      for (const k of component)
        for (const i of inputs.get(k)!) if (!members.has(i)) deepest = Math.max(deepest, seeds.has(i) ? 0 : depth.get(i)!);
      d = deepest + 1;
    }
    for (const k of component) depth.set(k, d);
  }

  const cells: (RecalcCell & { order: [number, number, number] })[] = [];
  for (const [key, { was, is }] of changed) {
    const at = (is ?? was)!;
    cells.push({
      table_id: at.tableId,
      row_id: at.rowId,
      column_id: at.columnId,
      old_display: was ? was.display : null,
      new_display: is ? is.display : null,
      new_kind: is ? is.kind : null,
      depth: depth.get(key)!,
      order: at.order,
    });
  }
  cells.sort((a, b) => a.depth - b.depth || a.order[0] - b.order[0] || a.order[1] - b.order[1] || a.order[2] - b.order[2]);

  const counts = (o: Map<string, number>, n: Map<string, number>) => {
    const out: Record<string, number> = {};
    for (const [id, count] of n) if (o.get(id) !== count) out[id] = count;
    return out;
  };
  const tables = new Set(cells.map((c) => c.table_id)).size;
  return {
    cells: cells.map(({ order: _order, ...c }) => c),
    count: cells.length,
    tables,
    sentence: sentence(cells.length, tables),
    row_counts: counts(old.rowCounts, now.rowCounts),
    column_counts: counts(old.columnCounts, now.columnCounts),
  };
}

import type { AccessJson, RecalcCellJson, RecalcJson, StacksJson } from '../shared/api.js';
import { copy } from '../shared/copy.js';
import type { Snapshot } from './evaluate.js';

export type CellClasses = {
  /** Cells the action writes, creates or removes outright. Depth 0, never listed. */
  seeds: Set<string>;
  /** Cells the edit changes by rule rather than through a formula. Depth 1. */
  directs: Set<string>;
  /** Every changed cell of these columns is a direct cell. */
  directColumns: string[];
  /** Every changed cell of these tables is a direct cell. */
  directTables: string[];
  /** Tables always named in the counts, such as a newly created table. */
  includeTables: string[];
  /**
   * Set by edits that make a name exist, so a cell that was #NAME? because of
   * that name counts as a direct cell.
   */
  nameResolutionDirect?: boolean;
};

export function emptyClasses(): CellClasses {
  return {
    seeds: new Set(),
    directs: new Set(),
    directColumns: [],
    directTables: [],
    includeTables: [],
  };
}

type Position = { tableOrder: number; rowOrder: number; columnOrder: number };

function positions(snapshot: Snapshot): Map<string, Position> {
  const out = new Map<string, Position>();
  snapshot.doc.tables.forEach((table, tableOrder) => {
    const columnOrders = new Map(table.columns.map((column, index) => [column.id, index]));
    const rows =
      table.kind === 'summary'
        ? (snapshot.groups.get(table.id) ?? []).map((group) => group.id)
        : (snapshot.visible.get(table.id) ?? []).map((row) => row.id);
    rows.forEach((rowId, rowOrder) => {
      for (const column of table.columns) {
        out.set(`${rowId}|${column.id}`, {
          tableOrder,
          rowOrder,
          columnOrder: columnOrders.get(column.id) ?? 0,
        });
      }
    });
  });
  return out;
}

export function buildRecalc(
  before: Snapshot,
  after: Snapshot,
  classes: CellClasses,
  context: { stacks: StacksJson; access: AccessJson; documentRevision: number },
): RecalcJson {
  const keys = new Set<string>([...before.cells.keys(), ...after.cells.keys()]);
  const changed = new Set<string>();
  for (const key of keys) {
    const old = before.cells.get(key);
    const now = after.cells.get(key);
    if (old === undefined || now === undefined) {
      changed.add(key);
      continue;
    }
    if (old.display !== now.display || old.kind !== now.kind) changed.add(key);
  }

  const directColumns = new Set(classes.directColumns);
  const directTables = new Set(classes.directTables);
  for (const key of changed) {
    if (classes.seeds.has(key)) continue;
    const cell = after.cells.get(key) ?? before.cells.get(key);
    if (cell === undefined) continue;
    if (directColumns.has(cell.columnId) || directTables.has(cell.tableId)) {
      classes.directs.add(key);
      continue;
    }
    if (classes.nameResolutionDirect === true && before.cells.get(key)?.display === '#NAME?') {
      classes.directs.add(key);
    }
  }

  const counted = (key: string): boolean =>
    classes.seeds.has(key) || classes.directs.has(key) || changed.has(key);

  const depsOf = (key: string): string[] => after.deps.get(key) ?? before.deps.get(key) ?? [];

  const depthMemo = new Map<string, number>();
  const cycleMemo = new Map<number, number>();
  const componentMembers = new Map<number, string[]>();
  for (const [key, component] of after.component) {
    const list = componentMembers.get(component);
    if (list === undefined) componentMembers.set(component, [key]);
    else list.push(key);
  }

  const depthOf = (key: string, guard: Set<string>): number => {
    if (classes.seeds.has(key)) return 0;
    if (classes.directs.has(key)) return 1;
    const memo = depthMemo.get(key);
    if (memo !== undefined) return memo;
    if (guard.has(key)) return 1;
    const component = after.component.get(key);
    if (component !== undefined && after.cycleComponents.has(component)) {
      const depth = cycleDepth(component, guard);
      depthMemo.set(key, depth);
      return depth;
    }
    guard.add(key);
    let best = 0;
    for (const dep of depsOf(key)) {
      if (dep === key || !counted(dep)) continue;
      best = Math.max(best, depthOf(dep, guard));
    }
    guard.delete(key);
    const depth = best + 1;
    depthMemo.set(key, depth);
    return depth;
  };

  const cycleDepth = (component: number, guard: Set<string>): number => {
    const memo = cycleMemo.get(component);
    if (memo !== undefined) return memo;
    const members = componentMembers.get(component) ?? [];
    if (members.some((member) => classes.directs.has(member))) {
      cycleMemo.set(component, 1);
      return 1;
    }
    cycleMemo.set(component, 1);
    let best = 0;
    for (const member of members) {
      for (const dep of depsOf(member)) {
        if (after.component.get(dep) === component || !counted(dep)) continue;
        best = Math.max(best, depthOf(dep, guard));
      }
    }
    const depth = best + 1;
    cycleMemo.set(component, depth);
    return depth;
  };

  const afterPositions = positions(after);
  const beforePositions = positions(before);

  const cells: Array<RecalcCellJson & { position: Position }> = [];
  for (const key of changed) {
    if (classes.seeds.has(key)) continue;
    const old = before.cells.get(key);
    const now = after.cells.get(key);
    const reference = now ?? old;
    if (reference === undefined) continue;
    const position = afterPositions.get(key) ?? beforePositions.get(key);
    if (position === undefined) continue;
    cells.push({
      table_id: reference.tableId,
      row_id: reference.rowId,
      column_id: reference.columnId,
      old_display: old?.display ?? null,
      new_display: now?.display ?? null,
      new_kind: now?.kind ?? null,
      depth: depthOf(key, new Set()),
      position,
    });
  }

  cells.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    if (a.position.tableOrder !== b.position.tableOrder) {
      return a.position.tableOrder - b.position.tableOrder;
    }
    if (a.position.rowOrder !== b.position.rowOrder) {
      return a.position.rowOrder - b.position.rowOrder;
    }
    return a.position.columnOrder - b.position.columnOrder;
  });

  const list: RecalcCellJson[] = cells.map(({ position: _position, ...cell }) => cell);
  const tableIds = new Set(list.map((cell) => cell.table_id));

  const rowCounts: Record<string, number> = {};
  const columnCounts: Record<string, number> = {};
  const include = new Set(classes.includeTables);
  for (const table of after.doc.tables) {
    const beforeTable = before.doc.tables.find((candidate) => candidate.id === table.id);
    const beforeRows = beforeTable === undefined ? null : (before.rowCounts.get(table.id) ?? 0);
    const afterRows = after.rowCounts.get(table.id) ?? 0;
    if (include.has(table.id) || beforeRows !== afterRows) rowCounts[table.id] = afterRows;
    const beforeColumns = beforeTable === undefined ? null : beforeTable.columns.length;
    const afterColumns = table.columns.length;
    if (include.has(table.id) || beforeColumns !== afterColumns) {
      columnCounts[table.id] = afterColumns;
    }
  }

  return {
    cells: list,
    count: list.length,
    tables: tableIds.size,
    sentence: copy.recalcSentence(list.length, tableIds.size),
    row_counts: rowCounts,
    column_counts: columnCounts,
    stacks: context.stacks,
    access: context.access,
    document_revision: context.documentRevision,
  };
}

/** True when the applied list turns a cell into #CIRC! that was not #CIRC! before. */
export function hasNewCircular(recalc: RecalcJson): boolean {
  return recalc.cells.some(
    (cell) => cell.new_display === '#CIRC!' && cell.old_display !== '#CIRC!',
  );
}

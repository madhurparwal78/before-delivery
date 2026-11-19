/**
 * Recalculation: the ordered list of changed cells with dependency depths,
 * computed inside one caller's view. One place decides depths and order.
 */
import { DocState, View, Row } from './docstate.js';
import { Evaluation, Evaluator, nodeKey, GroupRow } from './evaluator.js';
import { apiColumns } from './names.js';

export interface ListedCell {
  table_id: string;
  row_id: string;
  column_id: string;
  old_display: string | null;
  new_display: string | null;
  new_kind: string | null;
  depth: number;
}

export interface RecalcResult {
  cells: ListedCell[];
  count: number;
  tables: number;
  sentence: string;
}

export interface RecalcInput {
  /** cells the edit writes, creates or removes outright: seeds, depth 0 */
  seeds: Set<string>;
  /** cells the edit changes by rule, not through a formula: depth 1 */
  directs: Set<string>;
}

interface CellSnapshot {
  tableId: string;
  rowId: string;
  columnId: string;
  kind: string;
  display: string;
  tableOrder: number;
  rowOrder: number;
  columnOrder: number;
}

/** One evaluation flattened: every computed cell with its ordering keys. */
function snapshot(state: DocState, view: View, ev: Evaluation): Map<string, CellSnapshot> {
  const out = new Map<string, CellSnapshot>();
  for (const table of state.tables) {
    const columns = apiColumns(state, table.id);
    if (table.kind !== 'summary') {
      for (const [ri, row] of view.visibleRows(table.id, state).entries()) {
        for (const col of columns) {
          if (col.type !== 'formula' && col.type !== 'reference') continue;
          const computed = ev.cells.get(nodeKey(row.id, col.id));
          if (!computed) continue;
          out.set(nodeKey(row.id, col.id), {
            tableId: table.id,
            rowId: row.id,
            columnId: col.id,
            kind: computed.kind,
            display: computed.display,
            tableOrder: table.position,
            rowOrder: ri,
            columnOrder: col.position,
          });
        }
      }
    } else {
      for (const [gi, group] of (ev.groups.get(table.id) ?? []).entries()) {
        for (const col of columns) {
          const computed = group.cells.get(col.id);
          if (!computed) continue;
          out.set(nodeKey(group.rowId, col.id), {
            tableId: table.id,
            rowId: group.rowId,
            columnId: col.id,
            kind: computed.kind,
            display: computed.display,
            tableOrder: table.position,
            rowOrder: gi,
            columnOrder: col.position,
          });
        }
      }
    }
  }
  return out;
}

/** The member source rows of one group row, in one evaluation's view. */
function membersOf(
  state: DocState,
  view: View,
  evaluator: Evaluator,
  summary: { groupBy: string[]; sourceTableId: string | null },
  key: string[],
): string[] {
  const source = state.tableById(summary.sourceTableId ?? '');
  if (!source) return [];
  const wanted = JSON.stringify(key);
  const out: string[] = [];
  for (const row of view.visibleRows(source.id, state)) {
    if (JSON.stringify(evaluator.groupKeyOf(row, summary)) === wanted) out.push(row.id);
  }
  return out;
}

/**
 * The recalculation for one edit: diff the pre and post evaluations in the
 * caller's view, assign depths from the dependency graph, and order the list.
 */
export function recalculate(
  statePre: DocState,
  statePost: DocState,
  view: View,
  input: RecalcInput,
): RecalcResult {
  const preEval = new Evaluator(statePre, view).run();
  const postEval = new Evaluator(statePost, view).run();
  const preSnap = snapshot(statePre, view, preEval);
  const postSnap = snapshot(statePost, view, postEval);

  // diff: changed display or kind, newly existing, or ceased to exist
  const changed = new Map<string, { after: CellSnapshot; before: CellSnapshot | null }>();
  for (const [key, after] of postSnap) {
    const before = preSnap.get(key);
    if (!before || before.kind !== after.kind || before.display !== after.display) {
      changed.set(key, { after, before: before ?? null });
    }
  }
  for (const [key, before] of preSnap) {
    if (!postSnap.has(key)) changed.set(key, { after: before, before });
  }
  for (const key of input.seeds) changed.delete(key);

  // dependency edges for depth: post structural edges, plus summary cells'
  // edges to their members' cells (pre and post memberships)
  const deps = new Map<string, Set<string>>();
  for (const [key, set] of postEval.deps) deps.set(key, new Set(set));
  addSummaryEdges(statePre, view, preEval, deps);
  addSummaryEdges(statePost, view, postEval, deps);

  // active universe: listed cells, seeds and directs
  const active = new Set<string>([...changed.keys(), ...input.seeds, ...input.directs]);

  // union-find over cycle comps so each cycle shares one depth
  const unitOf = new Map<string, string>();
  for (const key of active) unitOf.set(key, key);
  const find = (u: string): string => {
    let root = u;
    while (unitOf.get(root) !== root) root = unitOf.get(root)!;
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) unitOf.set(ra, rb);
  };
  for (const comp of postEval.cycles) {
    const inComp = comp.filter((k) => active.has(k));
    for (let i = 1; i < inComp.length; i++) union(inComp[0]!, inComp[i]!);
  }

  // condensation: edges between active units
  const unitEdges = new Map<string, Set<string>>();
  for (const key of active) {
    const u = find(key);
    for (const dep of deps.get(key) ?? []) {
      if (!active.has(dep)) continue;
      const du = find(dep);
      if (du === u) continue;
      const set = unitEdges.get(u) ?? new Set<string>();
      set.add(du);
      unitEdges.set(u, set);
    }
  }
  const unitMembers = new Map<string, Set<string>>();
  for (const key of active) {
    const u = find(key);
    const set = unitMembers.get(u) ?? new Set<string>();
    set.add(key);
    unitMembers.set(u, set);
  }

  // Kahn topological order over active units
  const indeg = new Map<string, number>();
  for (const u of unitMembers.keys()) indeg.set(u, 0);
  for (const [u, set] of unitEdges) indeg.set(u, set.size);
  const dependents = new Map<string, Set<string>>();
  for (const [u, set] of unitEdges) {
    for (const dep of set) {
      const list = dependents.get(dep) ?? new Set<string>();
      list.add(u);
      dependents.set(dep, list);
    }
  }
  const queue: string[] = [];
  for (const [u, d] of indeg) if (d === 0) queue.push(u);
  const depthOfUnit = new Map<string, number>();
  while (queue.length > 0) {
    const u = queue.shift()!;
    // depth of this unit
    const members = unitMembers.get(u)!;
    let depth = 1;
    let hasDirect = false;
    for (const k of members) if (input.directs.has(k)) hasDirect = true;
    if (hasDirect) {
      depth = 1;
    } else {
      let max = -1;
      for (const k of members) {
        for (const dep of deps.get(k) ?? []) {
          if (!active.has(dep)) continue;
          if (find(dep) === u) continue;
          const depDepth = depthOfUnit.get(find(dep));
          if (depDepth !== undefined) max = Math.max(max, depDepth);
        }
      }
      depth = Math.max(1, max + 1);
    }
    depthOfUnit.set(u, depth);
    for (const dependent of dependents.get(u) ?? []) {
      const d = indeg.get(dependent)! - 1;
      indeg.set(dependent, d);
      if (d === 0) queue.push(dependent);
    }
  }
  // any unit left unprocessed (should not happen) defaults to depth 1
  for (const u of unitMembers.keys()) if (!depthOfUnit.has(u)) depthOfUnit.set(u, 1);

  // order: depth, then table creation order, then row order, then column order
  const listed: ListedCell[] = [];
  for (const [key, cell] of changed) {
    const depth = depthOfUnit.get(find(key)) ?? 1;
    const after = postSnap.get(key);
    listed.push({
      table_id: cell.after.tableId,
      row_id: cell.after.rowId,
      column_id: cell.after.columnId,
      old_display: cell.before ? cell.before.display : null,
      new_display: after ? after.display : null,
      new_kind: after ? after.kind : null,
      depth,
    });
  }
  const orderKeys = new Map<string, { d: number; t: number; r: number; c: number }>();
  for (const [key, cell] of changed) {
    orderKeys.set(key, {
      d: depthOfUnit.get(find(key)) ?? 1,
      t: cell.after.tableOrder,
      r: cell.after.rowOrder,
      c: cell.after.columnOrder,
    });
  }
  listed.sort((a, b) => {
    const ra = orderKeys.get(nodeKey(a.row_id, a.column_id))!;
    const rb = orderKeys.get(nodeKey(b.row_id, b.column_id))!;
    return ra.d - rb.d || ra.t - rb.t || ra.r - rb.r || ra.c - rb.c;
  });

  const tables = new Set(listed.map((c) => c.table_id));
  const cellWord = listed.length === 1 ? 'cell' : 'cells';
  const tableWord = tables.size === 1 ? 'table' : 'tables';
  return {
    cells: listed,
    count: listed.length,
    tables: tables.size,
    sentence: `Recalculated ${listed.length} ${cellWord} in ${tables.size} ${tableWord}.`,
  };
}

/**
 * Summary cells depend on their members' group-by and sum cells. Membership
 * can change with the edit, so both pre and post memberships contribute.
 */
function addSummaryEdges(
  state: DocState,
  view: View,
  ev: Evaluation,
  deps: Map<string, Set<string>>,
): void {
  const evaluator = new Evaluator(state, view);
  for (const summary of state.tables) {
    if (summary.kind !== 'summary' || !summary.sourceTableId) continue;
    const groups: GroupRow[] = ev.groups.get(summary.id) ?? [];
    const columns = apiColumns(state, summary.id);
    for (const group of groups) {
      const members = membersOf(state, view, evaluator, summary, group.key);
      for (const col of columns) {
        const key = nodeKey(group.rowId, col.id);
        const set = deps.get(key) ?? new Set<string>();
        for (const member of members) {
          for (const gcol of summary.groupBy) set.add(nodeKey(member, gcol));
          if (col.id === 'count') continue;
          if (col.id.startsWith('sum:')) {
            set.add(nodeKey(member, col.id.slice(4)));
          } else {
            set.add(nodeKey(member, col.id));
          }
        }
        deps.set(key, set);
      }
    }
  }
}

/**
 * The evaluator: dependency graph, cycle detection, and evaluation of every
 * formula cell, reference display and summary group, inside one caller's view.
 * One place computes cells; nothing else re-implements it.
 */
import { readFormula, AstNode } from './formula.js';
import { DocState, Column, Row, View, storedValue } from './docstate.js';
import {
  Value,
  Kind,
  blank,
  bool,
  date,
  decimal,
  error,
  text,
  dateToDayNumber,
  dayNumberToDate,
  literalToDecimal,
  compareValues,
  joinText,
  ErrorString,
} from './values.js';
import { Decimal } from 'decimal.js';
import { roundTo4 } from '../shared/decimal.js';

export const nodeKey = (rowId: string, columnId: string): string => `${rowId}\u0000${columnId}`;

export interface ComputedCell {
  kind: Kind;
  /** JSON value: string or boolean, or null for blank/error-by-string */
  value: string | boolean | null;
  display: string;
}

export interface GroupRow {
  rowId: string;
  key: string[];
  cells: Map<string, ComputedCell>;
}

export interface Evaluation {
  /** every computed cell keyed by nodeKey: formula cells and reference displays */
  cells: Map<string, ComputedCell>;
  /** summary rows per summary table id, in group order */
  groups: Map<string, GroupRow[]>;
  /** structural dependency edges of every node, including data-cell keys */
  deps: Map<string, Set<string>>;
  /** cyclic strongly-connected components of the structural graph */
  cycles: string[][];
}

interface Node {
  key: string;
  deps: Set<string>;
  type: 'formula' | 'refdisplay';
  rowId: string;
  columnId: string;
  tableId: string;
  ast?: AstNode;
}

const roundFinal = (d: Decimal): string => roundTo4(d.toFixed(24));

const parseCache = new Map<string, AstNode | null>();
const parseFormula = (formula: string): AstNode | null => {
  if (!parseCache.has(formula)) parseCache.set(formula, readFormula(formula).ast);
  return parseCache.get(formula) ?? null;
};

/** Errors-first scan of aggregated values, then type, then the operation. */
function scanAggregate(values: Value[], op: (vals: string[]) => Value): Value {
  for (const v of values) {
    if (v.kind === 'error') return v;
  }
  const decimals: string[] = [];
  for (const v of values) {
    if (v.kind === 'blank') continue;
    if (v.kind !== 'decimal') return error('#TYPE!');
    decimals.push(v.value!);
  }
  return op(decimals);
}

export class Evaluator {
  readonly state: DocState;
  readonly view: View;
  private evalMap = new Map<string, ComputedCell>();
  private groups = new Map<string, GroupRow[]>();
  private nodeDeps = new Map<string, Set<string>>();
  private cycleComps: string[][] = [];

  constructor(state: DocState, view: View) {
    this.state = state;
    this.view = view;
  }

  run(): Evaluation {
    this.evaluateAll();
    this.computeGroups();
    return {
      cells: this.evalMap,
      groups: this.groups,
      deps: this.nodeDeps,
      cycles: this.cycleComps,
    };
  }

  findColumn(tableId: string, name: string): Column | undefined {
    const lower = name.toLowerCase();
    return this.state.tableColumns(tableId).find((c) => c.name.toLowerCase() === lower);
  }

  findTable(name: string) {
    const lower = name.toLowerCase();
    return this.state.tables.find((t) => t.name.toLowerCase() === lower);
  }

  // -- graph + evaluation in one pass (Tarjan over the node graph) ----------

  private nodeOf(cell: { rowId: string; columnId: string }): string {
    return nodeKey(cell.rowId, cell.columnId);
  }

  private evaluateAll(): void {
    const state = this.state;
    const view = this.view;
    const memo = this.evalMap;
    const nodes = new Map<string, Node>();

    // build nodes
    for (const table of state.tables) {
      if (table.kind === 'summary') continue;
      for (const column of state.tableColumns(table.id)) {
        if (column.type === 'formula') {
          const ast = column.formula ? parseFormula(column.formula) : null;
          if (!ast) continue;
          for (const row of view.visibleRows(table.id, state)) {
            const key = this.nodeOf({ rowId: row.id, columnId: column.id });
            const node: Node = {
              key,
              deps: new Set(),
              type: 'formula',
              rowId: row.id,
              columnId: column.id,
              tableId: table.id,
              ast,
            };
            this.collectDeps(ast, table.id, row, node);
            nodes.set(key, node);
          }
        } else if (column.type === 'reference' && column.targetTableId) {
          for (const row of view.visibleRows(table.id, state)) {
            const cell = state.cell(row.id, column.id);
            if (!cell || cell.value === null) continue;
            const target = state.rows.get(cell.value);
            if (!target) continue;
            const key = this.nodeOf({ rowId: row.id, columnId: column.id });
            const deps = new Set<string>();
            const disp = target.deleted ? undefined : state.displayColumn(target.tableId);
            if (disp && (disp.type === 'formula' || disp.type === 'reference')) {
              deps.add(this.nodeOf({ rowId: target.id, columnId: disp.id }));
            }
            nodes.set(key, {
              key,
              deps,
              type: 'refdisplay',
              rowId: row.id,
              columnId: column.id,
              tableId: table.id,
            });
          }
        }
      }
    }

    // Tarjan SCC over deps; deps are emitted before dependents
    const indices = new Map<string, number>();
    const lows = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const sccs: string[][] = [];
    const cyclicScc = new Set<number>();
    let counter = 0;
    const adj = (key: string): string[] => {
      const n = nodes.get(key);
      return n ? [...n.deps].filter((d) => nodes.has(d)) : [];
    };
    const connect = (v: string): void => {
      indices.set(v, counter);
      lows.set(v, counter);
      counter++;
      stack.push(v);
      onStack.add(v);
      for (const w of adj(v)) {
        if (!indices.has(w)) {
          connect(w);
          lows.set(v, Math.min(lows.get(v)!, lows.get(w)!));
        } else if (onStack.has(w)) {
          lows.set(v, Math.min(lows.get(v)!, indices.get(w)!));
        }
      }
      if (lows.get(v) === indices.get(v)) {
        const comp: string[] = [];
        for (;;) {
          const w = stack.pop()!;
          onStack.delete(w);
          comp.push(w);
          if (w === v) break;
        }
        const id = sccs.length;
        if (comp.length > 1 || adj(comp[0]!).includes(comp[0]!)) {
          cyclicScc.add(id);
          this.cycleComps.push(comp);
        }
        for (const k of comp) {
          memo.set(k, { kind: 'blank', value: null, display: '' }); // reserve
        }
        // mark reserve entries removed; used to claim keys
        for (const k of comp) memo.delete(k);
        sccs.push(comp);
      }
    };
    for (const key of nodes.keys()) if (!indices.has(key)) connect(key);

    // keep the structural edges for depth computation (data-cell keys included)
    for (const [key, node] of nodes) this.nodeDeps.set(key, new Set(node.deps));

    // evaluate in SCC order (deps first)
    for (const [sccId, comp] of sccs.entries()) {
      if (cyclicScc.has(sccId)) {
        for (const key of comp) {
          const node = nodes.get(key)!;
          if (node.type === 'formula') {
            memo.set(key, { kind: 'error', value: '#CIRC!', display: '#CIRC!' });
          }
        }
        for (const key of comp) {
          const node = nodes.get(key)!;
          if (node.type === 'refdisplay' && !memo.has(key)) {
            memo.set(key, this.resolveReferenceDisplay(node.rowId, node.columnId));
          }
        }
        continue;
      }
      for (const key of comp) {
        if (memo.has(key)) continue;
        const node = nodes.get(key)!;
        if (node.type === 'formula') {
          const value = evalFormula(this, node.ast!, node.tableId, node.rowId);
          memo.set(key, toComputed(value));
        } else {
          memo.set(key, this.resolveReferenceDisplay(node.rowId, node.columnId));
        }
      }
    }
  }

  private collectDeps(ast: AstNode, tableId: string, row: Row, node: Node): void {
    const state = this.state;
    const view = this.view;
    const add = (colId: string, rowId: string) => node.deps.add(nodeKey(rowId, colId));
    const walk = (n: AstNode): void => {
      switch (n.t) {
        case 'num':
        case 'str':
        case 'bool':
          return;
        case 'cell': {
          const col = this.findColumn(tableId, n.name);
          if (col) add(col.id, row.id);
          return;
        }
        case 'trav': {
          // [Ref].[C] or chained: follow the reference, then read the column
          const refCol = this.findColumn(tableId, n.ref);
          if (!refCol) return;
          add(refCol.id, row.id);
          if (refCol.type !== 'reference' || !refCol.targetTableId) return;
          const cell = state.cell(row.id, refCol.id);
          if (!cell || cell.value === null) return;
          const target = state.rows.get(cell.value);
          if (!target || target.deleted) return;
          if (!view.visibleRows(target.tableId, state).some((r) => r.id === target.id)) return;
          let currentRow: Row = target;
          let currentTable = refCol.targetTableId;
          for (let i = 0; i < n.chain.length; i++) {
            const col = this.findColumn(currentTable, n.chain[i]!);
            if (!col) return;
            add(col.id, currentRow.id);
            if (i === n.chain.length - 1) return;
            if (col.type !== 'reference' || !col.targetTableId) return;
            const nextCell = state.cell(currentRow.id, col.id);
            if (!nextCell || nextCell.value === null) return;
            const nextTarget = state.rows.get(nextCell.value);
            if (!nextTarget || nextTarget.deleted) return;
            if (!view.visibleRows(nextTarget.tableId, state).some((r) => r.id === nextTarget.id)) return;
            currentRow = nextTarget;
            currentTable = col.targetTableId;
          }
          return;
        }
        case 'tablecol': {
          const table = this.findTable(n.table);
          if (!table) return;
          const col = this.findColumn(table.id, n.column);
          if (!col) return;
          for (const r of view.visibleRows(table.id, state)) add(col.id, r.id);
          return;
        }
        case 'table': {
          // COUNT(T): depends on the table's visible row set
          const table = this.findTable(n.table);
          if (!table) return;
          const first = state.tableColumns(table.id)[0];
          if (first) for (const r of view.visibleRows(table.id, state)) add(first.id, r.id);
          return;
        }
        case 'call':
          for (const arg of n.args) walk(arg);
          return;
        case 'un':
          walk(n.operand);
          return;
        case 'bin':
          walk(n.left);
          walk(n.right);
          return;
      }
    };
    walk(ast);
    node.deps.delete(node.key);
  }

  /** The display of a reference cell: target display, #REF!, or blank. */
  private resolveReferenceDisplay(rowId: string, columnId: string): ComputedCell {
    const state = this.state;
    const view = this.view;
    const cell = state.cell(rowId, columnId);
    if (!cell || cell.value === null) return { kind: 'blank', value: null, display: '' };
    const target = state.rows.get(cell.value);
    if (!target || target.deleted) return { kind: 'error', value: '#REF!', display: '#REF!' };
    if (!view.visibleRows(target.tableId, state).some((r) => r.id === target.id)) {
      return { kind: 'blank', value: null, display: '' };
    }
    const disp = state.displayColumn(target.tableId);
    if (!disp) return { kind: 'text', value: '', display: '' };
    const computed = this.readCell(target.id, disp.id);
    return { kind: computed.kind, value: computed.value, display: computed.display };
  }

  /** Read one cell's computed value (memoised) for formula evaluation. */
  readCell(rowId: string, columnId: string): ComputedCell {
    const state = this.state;
    const row = state.rows.get(rowId);
    const column = row ? state.columnOf(row.tableId, columnId) : undefined;
    if (!column) return { kind: 'error', value: '#NAME?', display: '#NAME?' };
    if (column.type === 'formula') {
      const key = nodeKey(rowId, columnId);
      const hit = this.evalMap.get(key);
      if (hit) return hit;
      const ast = column.formula ? parseFormula(column.formula) : null;
      if (!ast) return { kind: 'error', value: '#NAME?', display: '#NAME?' };
      const row = state.rows.get(rowId);
      if (!row || row.deleted) return { kind: 'blank', value: null, display: '' };
      const computed = toComputed(evalFormula(this, ast, column.tableId, rowId));
      this.evalMap.set(key, computed);
      return computed;
    }
    if (column.type === 'reference') {
      const key = nodeKey(rowId, columnId);
      const hit = this.evalMap.get(key);
      if (hit) return hit;
      const computed = this.resolveReferenceDisplay(rowId, columnId);
      this.evalMap.set(key, computed);
      return computed;
    }
    const cell = state.cell(rowId, columnId);
    const v = storedValue(state, column, cell);
    if (v.kind === 'bool') return { kind: 'bool', value: v.value === 'TRUE', display: v.value! };
    if (v.kind === 'blank') return { kind: 'blank', value: null, display: '' };
    return { kind: v.kind, value: v.value, display: v.value! };
  }

  // -- summary groups --------------------------------------------------------

  groupKeyOf(row: Row, summary: { groupBy: string[]; sourceTableId: string | null }): string[] {
    const parts: string[] = [];
    for (const colId of summary.groupBy) {
      const col = this.state.columnOf(summary.sourceTableId ?? row.tableId, colId);
      if (col?.type === 'reference') {
        const cell = this.state.cell(row.id, colId);
        if (!cell || cell.value === null) {
          parts.push('blank');
          continue;
        }
        const target = this.state.rows.get(cell.value);
        if (!target || target.deleted) {
          parts.push('#REF!');
          continue;
        }
        parts.push(`ref\u0000${cell.value}`);
        continue;
      }
      const computed = this.readCell(row.id, colId);
      if (computed.kind === 'blank') parts.push('blank');
      else parts.push(`${computed.kind}\u0000${computed.display}`);
    }
    return parts;
  }

  private computeGroups(): void {
    const state = this.state;
    const view = this.view;
    for (const summary of state.tables) {
      if (summary.kind !== 'summary' || !summary.sourceTableId) continue;
      const source = state.tableById(summary.sourceTableId);
      if (!source) continue;
      const rows = view.visibleRows(source.id, state);
      const buckets = new Map<string, { rows: Row[]; key: string[] }>();
      const order: string[] = [];
      for (const row of rows) {
        const key = this.groupKeyOf(row, summary);
        const k = JSON.stringify(key);
        if (!buckets.has(k)) {
          buckets.set(k, { rows: [], key });
          order.push(k);
        }
        buckets.get(k)!.rows.push(row);
      }
      const groupRows: GroupRow[] = [];
      for (const k of order) {
        const bucket = buckets.get(k)!;
        const stableId = state.summaryGroupId(summary.id, k);
        const cells = new Map<string, ComputedCell>();
        const first = bucket.rows[0]!;
        for (const colId of summary.groupBy) {
          cells.set(colId, this.readCell(first.id, colId));
        }
        const countText = literalToDecimal(String(bucket.rows.length));
        cells.set('count', { kind: 'decimal', value: countText, display: countText });
        for (const sumColId of summary.sumColumns) {
          let sum: Value = blank();
          const values: Value[] = [];
          for (const member of bucket.rows) {
            const computed = this.readCell(member.id, sumColId);
            values.push(computedToValue(computed));
          }
          sum = scanAggregate(values, (decimals) => decimal(decSum(decimals)));
          cells.set(`sum:${sumColId}`, toComputed(sum));
        }
        groupRows.push({ rowId: stableId, key: bucket.key, cells });
      }
      this.groups.set(summary.id, groupRows);
    }
  }
}

function decSum(values: string[]): string {
  let acc = new Decimal(0);
  for (const v of values) acc = acc.plus(new Decimal(v));
  return roundFinal(acc);
}

// ---------------------------------------------------------------------------
// Value plumbing
// ---------------------------------------------------------------------------

export function toComputed(v: Value): ComputedCell {
  switch (v.kind) {
    case 'blank':
      return { kind: 'blank', value: null, display: '' };
    case 'error':
      return { kind: 'error', value: v.value!, display: v.value! };
    case 'bool':
      return { kind: 'bool', value: v.value === 'TRUE', display: v.value! };
    case 'decimal':
    case 'date':
    case 'text':
      return { kind: v.kind, value: v.value, display: v.value! };
    case 'reference':
      return { kind: 'text', value: v.value, display: v.value ?? '' };
  }
}

function computedToValue(c: ComputedCell): Value {
  switch (c.kind) {
    case 'blank':
      return blank();
    case 'error':
      return error(c.display as ErrorString);
    case 'bool':
      return bool(c.display === 'TRUE');
    case 'decimal':
      return decimal(c.display);
    case 'date':
      return date(c.display);
    case 'text':
      return text(c.display);
    default:
      return blank();
  }
}

const asDecimal = (v: Value): Decimal | null => {
  if (v.kind === 'blank') return new Decimal(0);
  if (v.kind === 'decimal') return new Decimal(v.value!);
  return null;
};

// ---------------------------------------------------------------------------
// Formula evaluation
// ---------------------------------------------------------------------------

interface EvalCtx {
  ev: Evaluator;
  tableId: string;
  rowId: string;
}

function evalFormula(ev: Evaluator, ast: AstNode, tableId: string, rowId: string): Value {
  return evalNode({ ev, tableId, rowId }, ast);
}

function evalNode(ctx: EvalCtx, n: AstNode): Value {
  switch (n.t) {
    case 'num':
      return decimal(literalToDecimal(n.text));
    case 'str':
      return text(n.text);
    case 'bool':
      return bool(n.value);
    case 'cell':
      return readCellAsValue(ctx, n.name);
    case 'trav':
      return evalTraversal(ctx, n.ref, n.chain);
    case 'tablecol':
    case 'table':
      // bare table names in value position are reading errors; unreachable
      return error('#NAME?');
    case 'call':
      return evalCall(ctx, n.name, n.args);
    case 'un':
      return evalUnary(ctx, n.operand);
    case 'bin':
      return evalBinary(ctx, n.op, n.left, n.right);
  }
}

function readCellAsValue(ctx: EvalCtx, name: string): Value {
  const col = ctx.ev.findColumn(ctx.tableId, name);
  if (!col) return error('#NAME?');
  const computed = ctx.ev.readCell(ctx.rowId, col.id);
  if (computed.kind === 'error') return error(computed.display as ErrorString);
  return computedToValue(computed);
}

function evalTraversal(ctx: EvalCtx, refName: string, chain: string[]): Value {
  const state = ctx.ev.state;
  const view = ctx.ev.view;
  const refCol = ctx.ev.findColumn(ctx.tableId, refName);
  if (!refCol) return error('#NAME?');
  const firstCell = state.cell(ctx.rowId, refCol.id);
  if (!firstCell || firstCell.value === null) return blank();
  const firstTarget = state.rows.get(firstCell.value);
  if (!firstTarget || firstTarget.deleted) return error('#REF!');
  if (!view.visibleRows(firstTarget.tableId, state).some((r) => r.id === firstTarget.id)) return blank();
  let currentRow: Row = firstTarget;
  let currentTable = refCol.targetTableId ?? firstTarget.tableId;
  for (let i = 0; i < chain.length; i++) {
    const col = ctx.ev.findColumn(currentTable, chain[i]!);
    if (!col) return error('#NAME?');
    if (i === chain.length - 1) {
      const computed = ctx.ev.readCell(currentRow.id, col.id);
      if (computed.kind === 'error') return error(computed.display as ErrorString);
      return computedToValue(computed);
    }
    const cell = state.cell(currentRow.id, col.id);
    if (!cell || cell.value === null) return blank();
    const target = state.rows.get(cell.value);
    if (!target || target.deleted) return error('#REF!');
    if (!view.visibleRows(target.tableId, state).some((r) => r.id === target.id)) return blank();
    currentRow = target;
    currentTable = col.targetTableId ?? target.tableId;
  }
  return blank();
}

function aggregateColumnValues(ctx: EvalCtx, tableId: string, columnId: string): Value[] {
  const rows = ctx.ev.view.visibleRows(tableId, ctx.ev.state);
  return rows.map((r) => computedToValue(ctx.ev.readCell(r.id, columnId)));
}

function evalCall(ctx: EvalCtx, name: string, args: AstNode[]): Value {
  const state = ctx.ev.state;
  const view = ctx.ev.view;
  switch (name) {
    case 'SUM': {
      if (args.length !== 1 || args[0].t !== 'tablecol') return error('#TYPE!');
      const table = ctx.ev.findTable(args[0].table);
      if (!table) return error('#NAME?');
      const col = ctx.ev.findColumn(table.id, args[0].column);
      if (!col) return error('#NAME?');
      const values = aggregateColumnValues(ctx, table.id, col.id);
      return scanAggregate(values, (ds) => decimal(decSum(ds)));
    }
    case 'COUNT': {
      if (args.length !== 1) return error('#TYPE!');
      const arg = args[0]!;
      if (arg.t === 'table') {
        const table = ctx.ev.findTable(arg.table);
        if (!table) return error('#NAME?');
        const n = view.visibleRows(table.id, state).length;
        return decimal(literalToDecimal(String(n)));
      }
      return error('#TYPE!');
    }
    case 'SUMBY':
    case 'COUNTBY': {
      const isSum = name === 'SUMBY';
      if (args.length !== 2 || args[0].t !== 'tablecol' || args[1].t !== 'tablecol') return error('#TYPE!');
      const table = ctx.ev.findTable(args[0].table);
      const refTable = ctx.ev.findTable(args[1].table);
      if (!table || !refTable) return error('#NAME?');
      const sumCol = ctx.ev.findColumn(table.id, args[0].column);
      const refCol = ctx.ev.findColumn(refTable.id, args[1].column);
      if (!sumCol || !refCol) return error('#NAME?');
      // R must be a Reference to the formula's own table
      if (refCol.type !== 'reference' || refCol.targetTableId !== ctx.tableId) return error('#TYPE!');
      const members: Row[] = [];
      for (const row of view.visibleRows(table.id, state)) {
        const cell = state.cell(row.id, refCol.id);
        if (cell && cell.value === ctx.rowId) members.push(row);
      }
      if (!isSum) return decimal(literalToDecimal(String(members.length)));
      const values = members.map((m) => computedToValue(ctx.ev.readCell(m.id, sumCol.id)));
      return scanAggregate(values, (ds) => decimal(decSum(ds)));
    }
    case 'MIN':
    case 'MAX': {
      if (args.length !== 1 || args[0].t !== 'tablecol') return error('#TYPE!');
      const table = ctx.ev.findTable(args[0].table);
      if (!table) return error('#NAME?');
      const col = ctx.ev.findColumn(table.id, args[0].column);
      if (!col) return error('#NAME?');
      const values = aggregateColumnValues(ctx, table.id, col.id);
      let firstError: Value | null = null;
      for (const v of values) {
        if (v.kind === 'error' && !firstError) firstError = v;
      }
      if (firstError) return firstError;
      let best: Decimal | null = null;
      for (const v of values) {
        if (v.kind === 'blank') continue;
        if (v.kind !== 'decimal') return error('#TYPE!');
        const d = new Decimal(v.value!);
        if (best === null) best = d;
        else if (name === 'MIN' ? d.lt(best) : d.gt(best)) best = d;
      }
      if (best === null) return blank();
      return decimal(decSum([best.toFixed(20)]));
    }
    case 'AVERAGE': {
      if (args.length !== 1 || args[0].t !== 'tablecol') return error('#TYPE!');
      const table = ctx.ev.findTable(args[0].table);
      if (!table) return error('#NAME?');
      const col = ctx.ev.findColumn(table.id, args[0].column);
      if (!col) return error('#NAME?');
      const values = aggregateColumnValues(ctx, table.id, col.id);
      let firstError: Value | null = null;
      for (const v of values) {
        if (v.kind === 'error' && !firstError) firstError = v;
      }
      if (firstError) return firstError;
      let sum = new Decimal(0);
      let count = 0;
      for (const v of values) {
        if (v.kind === 'blank') continue;
        if (v.kind !== 'decimal') return error('#TYPE!');
        sum = sum.plus(new Decimal(v.value!));
        count++;
      }
      if (count === 0) return error('#DIV/0!');
      const avg = sum.dividedBy(new Decimal(count)).toDecimalPlaces(20);
      return decimal(roundFinal(avg));
    }
    case 'ROUND': {
      if (args.length !== 2) return error('#TYPE!');
      const x = evalNode(ctx, args[0]!);
      if (x.kind === 'error') return x;
      const d = asDecimal(x);
      if (d === null) return error('#TYPE!');
      const n = evalNode(ctx, args[1]!);
      if (n.kind === 'error') return n;
      const nd = asDecimal(n);
      if (nd === null || !nd.isInteger() || nd.lt(0) || nd.gt(4)) return error('#TYPE!');
      const rounded = d.toDecimalPlaces(nd.toNumber(), Decimal.ROUND_HALF_UP);
      return decimal(roundFinal(rounded));
    }
    case 'IF': {
      if (args.length !== 3) return error('#TYPE!');
      const cond = evalNode(ctx, args[0]!);
      if (cond.kind === 'error') return cond;
      if (cond.kind === 'blank') return evalNode(ctx, args[2]!);
      if (cond.kind !== 'bool') return error('#TYPE!');
      return evalNode(ctx, cond.value === 'TRUE' ? args[1]! : args[2]!);
    }
    case 'IFERROR': {
      if (args.length !== 2) return error('#TYPE!');
      const x = evalNode(ctx, args[0]!);
      if (x.kind === 'error' && x.value !== '#CIRC!') return evalNode(ctx, args[1]!);
      return x;
    }
    default:
      return error('#NAME?');
  }
}

function evalUnary(ctx: EvalCtx, operand: AstNode): Value {
  const v = evalNode(ctx, operand);
  if (v.kind === 'error') return v;
  if (v.kind === 'date') return error('#TYPE!');
  const d = asDecimal(v);
  if (d === null) return error('#TYPE!');
  return decimal(roundFinal(d.neg()));
}

function evalBinary(ctx: EvalCtx, op: string, left: AstNode, right: AstNode): Value {
  if (op === '&') {
    const l = evalNode(ctx, left);
    const r = evalNode(ctx, right);
    if (l.kind === 'error') return l;
    if (r.kind === 'error') return r;
    return text(joinText(l) + joinText(r));
  }
  if (op === '=' || op === '<>' || op === '<' || op === '>' || op === '<=' || op === '>=') {
    const l = evalNode(ctx, left);
    const r = evalNode(ctx, right);
    return compareValues(l, r, op);
  }
  const l = evalNode(ctx, left);
  const r = evalNode(ctx, right);
  if (l.kind === 'error') return l;
  if (r.kind === 'error') return r;
  if (l.kind === 'date' || r.kind === 'date') {
    return evalDateArith(op, l, r);
  }
  const dl = asDecimal(l);
  const dr = asDecimal(r);
  if (dl === null || dr === null) return error('#TYPE!');
  switch (op) {
    case '+':
      return decimal(roundFinal(dl.plus(dr)));
    case '-':
      return decimal(roundFinal(dl.minus(dr)));
    case '*':
      return decimal(roundFinal(dl.times(dr)));
    case '/': {
      if (dr.isZero()) return error('#DIV/0!');
      return decimal(roundFinal(dl.dividedBy(dr).toDecimalPlaces(20)));
    }
    default:
      return error('#TYPE!');
  }
}

function evalDateArith(op: string, l: Value, r: Value): Value {
  if (op === '-' && l.kind === 'date' && r.kind === 'date') {
    const days = dateToDayNumber(l.value!) - dateToDayNumber(r.value!);
    return decimal(roundFinal(new Decimal(days)));
  }
  const dateSide = l.kind === 'date' ? l : r;
  const otherSide = dateSide === l ? r : l;
  if (dateSide.kind !== 'date') return error('#TYPE!');
  const d = asDecimal(otherSide);
  if (d === null || !d.isInteger()) return error('#TYPE!');
  if (op !== '+' && op !== '-') return error('#TYPE!');
  // Decimal - Date is invalid; Date + Decimal and Date - Decimal are fine
  if (op === '-' && r.kind === 'date' && l.kind !== 'date') return error('#TYPE!');
  if (op === '+' && l.kind === 'date' && r.kind === 'date') return error('#TYPE!');
  const days = dateToDayNumber(dateSide.value!);
  const delta = op === '+' ? days + d.toNumber() : days - d.toNumber();
  const out = dayNumberToDate(delta);
  if (!out) return error('#TYPE!');
  return date(out);
}

/** Evaluate a whole document in one view. */
export function evaluateDoc(state: DocState, view: View): Evaluation {
  return new Evaluator(state, view).run();
}

export interface PreviewResult {
  display: string | null;
  kind: string | null;
  diagnosis: string | null;
}

/** Evaluate an unsaved formula against one row in the caller's view. */
export function previewFormula(
  state: DocState,
  view: View,
  tableId: string,
  rowId: string,
  asSent: string,
  diagOf: (d: import('./formula.js').Diag) => string,
  tooltipOf: (errorDisplay: string) => string,
): PreviewResult {
  const read = readFormula(asSent);
  if (!read.ast) {
    return { display: null, kind: null, diagnosis: diagOf(read.diag!) };
  }
  const evaluator = new Evaluator(state, view);
  const value = evalNode({ ev: evaluator, tableId, rowId }, read.ast);
  const computed = toComputed(value);
  if (computed.kind === 'error') {
    return { display: computed.display, kind: 'error', diagnosis: tooltipOf(computed.display) };
  }
  return { display: computed.display, kind: computed.kind, diagnosis: null };
}

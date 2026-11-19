import { createHash } from 'node:crypto';
import type { CellJson, CellKind } from '../shared/api.js';
import {
  add,
  compare,
  parseDecimalText,
  div,
  formatDecimal,
  fromInt,
  isZero,
  mul,
  neg,
  round,
  sub,
  toWholeNumber,
  ZERO,
  DISPLAY_SCALE,
  type Dec,
} from './decimal.js';
import {
  columnByName,
  displayColumn,
  rowIsVisible,
  summarySumColumnId,
  SUMMARY_COUNT_COLUMN_ID,
  tableByName,
  type ColumnData,
  type DocData,
  type RowData,
  type TableData,
  type Viewer,
} from './model.js';
import { readFormula, type Argument, type Expr } from './formula/read.js';
import {
  BLANK,
  compareCodePoints,
  dateToDayNumber,
  dayNumberToDate,
  decValue,
  displayOf,
  errValue,
  jsonValueOf,
  kindOf,
  textOf,
  type Value,
} from './value.js';

export type EvalCell = {
  tableId: string;
  rowId: string;
  columnId: string;
  value: Value;
  display: string;
  kind: CellKind;
  jsonValue: CellJson['value'];
  revision: number | null;
};

export type GroupRow = { id: string; key: string; memberRowIds: string[] };

export type Snapshot = {
  doc: DocData;
  viewer: Viewer;
  visible: Map<string, RowData[]>;
  groups: Map<string, GroupRow[]>;
  cells: Map<string, EvalCell>;
  deps: Map<string, string[]>;
  component: Map<string, number>;
  cycleComponents: Set<number>;
  rowCounts: Map<string, number>;
};

export function cellKey(rowId: string, columnId: string): string {
  return `${rowId}|${columnId}`;
}

/** Group rows keep one id per key, so a key that returns takes its old id again. */
export function groupRowId(summaryTableId: string, key: string): string {
  const digest = createHash('sha256').update(`${summaryTableId}\u0000${key}`).digest('hex');
  return `g_${digest.slice(0, 24)}`;
}

const parseCache = new Map<string, Expr | null>();

function parsedFormula(text: string): Expr | null {
  const cached = parseCache.get(text);
  if (cached !== undefined) return cached;
  const read = readFormula(text);
  const expr = read.ok ? read.expr : null;
  if (parseCache.size > 2000) parseCache.clear();
  parseCache.set(text, expr);
  return expr;
}

function rawToValue(column: ColumnData, raw: string | null): Value {
  if (raw === null) return BLANK;
  switch (column.type) {
    case 'text':
      return { t: 'text', s: raw };
    case 'decimal': {
      const parsed = parseDecimalText(raw);
      return parsed === null ? errValue('#TYPE!') : { t: 'dec', d: parsed };
    }
    case 'date':
      return { t: 'date', s: raw };
    case 'bool':
      return { t: 'bool', b: raw === 'true' };
    case 'reference':
    case 'formula':
      return BLANK;
  }
}

/** Only a cell's final Decimal result is rounded to four places. */
function finalise(value: Value): Value {
  return value.t === 'dec' ? { t: 'dec', d: round(value.d, DISPLAY_SCALE) } : value;
}

type Member = { table: TableData; row: RowData };
type NodeInfo = { table: TableData; row: RowData; column: ColumnData };

class DocumentEvaluator {
  readonly visible = new Map<string, RowData[]>();
  readonly cells = new Map<string, EvalCell>();
  readonly deps = new Map<string, string[]>();
  readonly component = new Map<string, number>();
  readonly cycleComponents = new Set<number>();
  readonly groups = new Map<string, GroupRow[]>();
  readonly rowCounts = new Map<string, number>();
  private readonly memberOf = new Map<string, Member>();
  private readonly nodeInfo = new Map<string, NodeInfo>();

  constructor(
    private readonly doc: DocData,
    private readonly viewer: Viewer,
  ) {}

  run(): Snapshot {
    for (const table of this.doc.tables) {
      if (table.kind === 'summary') continue;
      const rows = table.rows.filter((row) => rowIsVisible(table, row, this.viewer));
      this.visible.set(table.id, rows);
      this.rowCounts.set(table.id, rows.length);
      for (const row of rows) this.memberOf.set(row.id, { table, row });
    }
    for (const table of this.doc.tables) {
      if (table.kind === 'summary') continue;
      for (const row of this.visible.get(table.id) ?? []) {
        for (const column of table.columns) {
          const key = cellKey(row.id, column.id);
          this.nodeInfo.set(key, { table, row, column });
          this.deps.set(key, this.collectCellDeps(table, row, column));
        }
      }
    }
    this.evaluateNodes();
    this.buildSummaries();
    return {
      doc: this.doc,
      viewer: this.viewer,
      visible: this.visible,
      groups: this.groups,
      cells: this.cells,
      deps: this.deps,
      component: this.component,
      cycleComponents: this.cycleComponents,
      rowCounts: this.rowCounts,
    };
  }

  private visibleRowsOf(table: TableData): RowData[] {
    return this.visible.get(table.id) ?? [];
  }

  private targetRow(column: ColumnData, row: RowData): Member | 'deleted' | 'none' {
    const raw = row.cells.get(column.id)?.raw ?? null;
    if (raw === null) return 'none';
    const indexed = this.doc.rowIndex.get(raw);
    if (indexed === undefined) return 'none';
    if (indexed.deleted) return 'deleted';
    const member = this.memberOf.get(raw);
    return member ?? 'none';
  }

  private collectCellDeps(table: TableData, row: RowData, column: ColumnData): string[] {
    const out = new Set<string>();
    if (column.type === 'reference') {
      const target = this.targetRow(column, row);
      if (target !== 'deleted' && target !== 'none') {
        const display = displayColumn(target.table);
        if (display !== undefined) out.add(cellKey(target.row.id, display.id));
      }
      return [...out];
    }
    if (column.type !== 'formula' || column.formula === null) return [];
    const expr = parsedFormula(column.formula);
    if (expr === null) return [];
    this.collectExprDeps(expr, table, row, out);
    return [...out];
  }

  private collectExprDeps(expr: Expr, table: TableData, row: RowData, out: Set<string>): void {
    switch (expr.k) {
      case 'number':
      case 'string':
      case 'bool':
        return;
      case 'unary':
        this.collectExprDeps(expr.expr, table, row, out);
        return;
      case 'binary':
        this.collectExprDeps(expr.left, table, row, out);
        this.collectExprDeps(expr.right, table, row, out);
        return;
      case 'field':
        this.collectPathDeps(expr.path, table, row, out);
        return;
      case 'call':
        for (const arg of expr.args) this.collectArgumentDeps(arg, table, row, out);
        return;
    }
  }

  private collectPathDeps(
    path: { name: string }[],
    table: TableData,
    row: RowData,
    out: Set<string>,
  ): void {
    const head = path[0];
    if (head === undefined) return;
    const column = columnByName(table, head.name);
    if (column === undefined) return;
    out.add(cellKey(row.id, column.id));
    if (path.length === 1 || column.type !== 'reference') return;
    const target = this.targetRow(column, row);
    if (target === 'deleted' || target === 'none') return;
    this.collectPathDeps(path.slice(1), target.table, target.row, out);
  }

  private collectArgumentDeps(
    arg: Argument,
    table: TableData,
    row: RowData,
    out: Set<string>,
  ): void {
    if (arg.k === 'expr') {
      this.collectExprDeps(arg.expr, table, row, out);
      return;
    }
    const target = tableByName(this.doc, arg.table.name);
    if (target === undefined || target.kind === 'summary') return;
    if (arg.k === 'table') {
      const display = displayColumn(target);
      if (display === undefined) return;
      for (const targetRow of this.visibleRowsOf(target)) {
        out.add(cellKey(targetRow.id, display.id));
      }
      return;
    }
    const column = columnByName(target, arg.column.name);
    if (column === undefined) return;
    for (const targetRow of this.visibleRowsOf(target)) {
      out.add(cellKey(targetRow.id, column.id));
    }
  }

  private evaluateNodes(): void {
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    let counter = 0;
    let componentCounter = 0;

    const visit = (root: string): void => {
      const frames: { node: string; i: number }[] = [{ node: root, i: 0 }];
      index.set(root, counter);
      low.set(root, counter);
      counter += 1;
      stack.push(root);
      onStack.add(root);
      while (frames.length > 0) {
        const frame = frames[frames.length - 1] as { node: string; i: number };
        const adjacency = this.deps.get(frame.node) ?? [];
        if (frame.i < adjacency.length) {
          const next = adjacency[frame.i] as string;
          frame.i += 1;
          if (!index.has(next)) {
            index.set(next, counter);
            low.set(next, counter);
            counter += 1;
            stack.push(next);
            onStack.add(next);
            frames.push({ node: next, i: 0 });
          } else if (onStack.has(next)) {
            low.set(frame.node, Math.min(low.get(frame.node) as number, index.get(next) as number));
          }
          continue;
        }
        frames.pop();
        if (low.get(frame.node) === index.get(frame.node)) {
          const members: string[] = [];
          for (;;) {
            const popped = stack.pop() as string;
            onStack.delete(popped);
            members.push(popped);
            if (popped === frame.node) break;
          }
          const componentId = componentCounter;
          componentCounter += 1;
          this.emitComponent(componentId, members);
        }
        const parent = frames[frames.length - 1];
        if (parent !== undefined) {
          low.set(parent.node, Math.min(low.get(parent.node) as number, low.get(frame.node) as number));
        }
      }
    };

    for (const node of this.deps.keys()) {
      if (!index.has(node)) visit(node);
    }
  }

  private emitComponent(componentId: number, members: string[]): void {
    const first = members[0] as string;
    const selfLoop = members.length === 1 && (this.deps.get(first) ?? []).includes(first);
    const isCycle = members.length > 1 || selfLoop;
    if (isCycle) this.cycleComponents.add(componentId);
    for (const node of members) {
      this.component.set(node, componentId);
      if (isCycle) {
        this.storeCell(node, errValue('#CIRC!'));
        continue;
      }
      const dependsOnCycle = (this.deps.get(node) ?? []).some((dep) => {
        const value = this.cells.get(dep)?.value;
        return value !== undefined && value.t === 'err' && value.e === '#CIRC!';
      });
      this.storeCell(node, dependsOnCycle ? errValue('#CIRC!') : this.evaluateCell(node));
    }
  }

  private storeCell(node: string, value: Value): void {
    const info = this.nodeInfo.get(node) as NodeInfo;
    const stored = info.row.cells.get(info.column.id);
    const isData = info.column.type !== 'formula';
    const final = finalise(value);
    this.cells.set(node, {
      tableId: info.table.id,
      rowId: info.row.id,
      columnId: info.column.id,
      value: final,
      display: displayOf(final),
      kind: kindOf(final),
      jsonValue: jsonValueOf(final),
      revision: isData ? (stored?.revision ?? 1) : null,
    });
  }

  private evaluateCell(node: string): Value {
    const info = this.nodeInfo.get(node) as NodeInfo;
    const { column, table, row } = info;
    if (column.type === 'reference') return this.referenceValue(column, row);
    if (column.type !== 'formula') {
      return rawToValue(column, row.cells.get(column.id)?.raw ?? null);
    }
    if (column.formula === null) return BLANK;
    const expr = parsedFormula(column.formula);
    if (expr === null) return errValue('#NAME?');
    return this.evaluateExpr(expr, table, row);
  }

  private referenceValue(column: ColumnData, row: RowData): Value {
    const target = this.targetRow(column, row);
    if (target === 'deleted') return errValue('#REF!');
    if (target === 'none') return BLANK;
    const display = displayColumn(target.table);
    if (display === undefined) return BLANK;
    const cell = this.cells.get(cellKey(target.row.id, display.id));
    if (cell === undefined) return BLANK;
    if (cell.value.t === 'err') return cell.value;
    if (cell.value.t === 'blank') return BLANK;
    return { t: 'text', s: cell.display };
  }

  private cellValue(rowId: string, columnId: string): Value {
    return this.cells.get(cellKey(rowId, columnId))?.value ?? BLANK;
  }

  private evaluateExpr(expr: Expr, table: TableData, row: RowData): Value {
    switch (expr.k) {
      case 'number':
        return decValue(expr.value);
      case 'string':
        return { t: 'text', s: expr.value };
      case 'bool':
        return { t: 'bool', b: expr.value };
      case 'field':
        return this.readPath(expr.path, table, row);
      case 'unary': {
        const inner = this.evaluateExpr(expr.expr, table, row);
        if (inner.t === 'err') return inner;
        if (inner.t === 'blank') return decValue(ZERO);
        if (inner.t !== 'dec') return errValue('#TYPE!');
        return decValue(neg(inner.d));
      }
      case 'binary':
        return this.evaluateBinary(expr, table, row);
      case 'call':
        return this.evaluateCall(expr, table, row);
    }
  }

  private readPath(path: { name: string }[], table: TableData, row: RowData): Value {
    const head = path[0];
    if (head === undefined) return BLANK;
    const column = columnByName(table, head.name);
    if (column === undefined) return errValue('#NAME?');
    const value = this.cellValue(row.id, column.id);
    if (path.length === 1) return value;
    if (column.type !== 'reference') return errValue('#TYPE!');
    if (value.t === 'err') return value;
    const target = this.targetRow(column, row);
    if (target === 'deleted') return errValue('#REF!');
    if (target === 'none') return BLANK;
    return this.readPath(path.slice(1), target.table, target.row);
  }

  private evaluateBinary(
    expr: Expr & { k: 'binary' },
    table: TableData,
    row: RowData,
  ): Value {
    const left = this.evaluateExpr(expr.left, table, row);
    if (left.t === 'err') return left;
    const right = this.evaluateExpr(expr.right, table, row);
    if (right.t === 'err') return right;
    switch (expr.op) {
      case '&':
        return { t: 'text', s: `${textOf(left)}${textOf(right)}` };
      case '+':
      case '-':
      case '*':
      case '/':
        return arithmetic(expr.op, left, right);
      case '=':
      case '<>':
      case '<':
      case '>':
      case '<=':
      case '>=':
        return comparison(expr.op, left, right);
    }
  }

  private evaluateCall(expr: Expr & { k: 'call' }, table: TableData, row: RowData): Value {
    const fn = expr.name.toLowerCase();
    const args = expr.args;
    switch (fn) {
      case 'if': {
        if (args.length !== 3) return errValue('#TYPE!');
        const condition = this.evaluateArgument(args[0] as Argument, table, row);
        if (condition.t === 'err') return condition;
        const chosen =
          condition.t === 'blank'
            ? false
            : condition.t === 'bool'
              ? condition.b
              : null;
        if (chosen === null) return errValue('#TYPE!');
        return this.evaluateArgument(args[chosen ? 1 : 2] as Argument, table, row);
      }
      case 'iferror': {
        if (args.length !== 2) return errValue('#TYPE!');
        const value = this.evaluateArgument(args[0] as Argument, table, row);
        if (value.t === 'err' && value.e !== '#CIRC!') {
          return this.evaluateArgument(args[1] as Argument, table, row);
        }
        return value;
      }
      case 'round': {
        if (args.length !== 2) return errValue('#TYPE!');
        const x = this.evaluateArgument(args[0] as Argument, table, row);
        if (x.t === 'err') return x;
        const places = this.evaluateArgument(args[1] as Argument, table, row);
        if (places.t === 'err') return places;
        if (x.t !== 'dec' && x.t !== 'blank') return errValue('#TYPE!');
        if (places.t !== 'dec') return errValue('#TYPE!');
        const whole = toWholeNumber(places.d);
        if (whole === null || whole < 0 || whole > DISPLAY_SCALE) return errValue('#TYPE!');
        return decValue(round(x.t === 'dec' ? x.d : ZERO, whole));
      }
      case 'sum':
      case 'min':
      case 'max':
      case 'average': {
        if (args.length !== 1) return errValue('#TYPE!');
        const column = this.resolveColumnArgument(args[0] as Argument);
        if (typeof column === 'string') return errValue(column);
        const values = this.visibleRowsOf(column.table).map((r) =>
          this.cellValue(r.id, column.column.id),
        );
        return aggregate(fn, values);
      }
      case 'count': {
        if (args.length !== 1) return errValue('#TYPE!');
        const arg = args[0] as Argument;
        if (arg.k !== 'table') return errValue('#TYPE!');
        const target = tableByName(this.doc, arg.table.name);
        if (target === undefined || target.kind === 'summary') return errValue('#NAME?');
        return decValue(fromInt(this.visibleRowsOf(target).length));
      }
      case 'countby':
      case 'sumby': {
        const refArgument = fn === 'countby' ? args[0] : args[1];
        const expected = fn === 'countby' ? 1 : 2;
        if (args.length !== expected) return errValue('#TYPE!');
        const reference = this.resolveColumnArgument(refArgument as Argument);
        if (typeof reference === 'string') return errValue(reference);
        if (
          reference.column.type !== 'reference' ||
          reference.column.targetTableId !== table.id
        ) {
          return errValue('#TYPE!');
        }
        const matching = this.visibleRowsOf(reference.table).filter(
          (r) => (r.cells.get(reference.column.id)?.raw ?? null) === row.id,
        );
        if (fn === 'countby') return decValue(fromInt(matching.length));
        const valueColumn = this.resolveColumnArgument(args[0] as Argument);
        if (typeof valueColumn === 'string') return errValue(valueColumn);
        const values = matching.map((r) => this.cellValue(r.id, valueColumn.column.id));
        return aggregate('sum', values);
      }
      default:
        return errValue('#NAME?');
    }
  }

  private evaluateArgument(arg: Argument, table: TableData, row: RowData): Value {
    if (arg.k === 'expr') return this.evaluateExpr(arg.expr, table, row);
    return errValue('#TYPE!');
  }

  private resolveColumnArgument(
    arg: Argument,
  ): { table: TableData; column: ColumnData } | '#TYPE!' | '#NAME?' {
    if (arg.k !== 'tableColumn') return '#TYPE!';
    const table = tableByName(this.doc, arg.table.name);
    if (table === undefined || table.kind === 'summary') return '#NAME?';
    const column = columnByName(table, arg.column.name);
    if (column === undefined) return '#NAME?';
    return { table, column };
  }

  private buildSummaries(): void {
    for (const summary of this.doc.tables) {
      if (summary.kind !== 'summary' || summary.summary === null) continue;
      const source = this.doc.tables.find((t) => t.id === summary.summary?.sourceTableId);
      if (source === undefined) continue;
      const order: string[] = [];
      const members = new Map<string, RowData[]>();
      for (const row of this.visibleRowsOf(source)) {
        const key = this.groupKey(source, summary.summary.groupBy, row);
        const existing = members.get(key);
        if (existing === undefined) {
          members.set(key, [row]);
          order.push(key);
        } else {
          existing.push(row);
        }
      }
      const groups: GroupRow[] = order.map((key) => ({
        id: groupRowId(summary.id, key),
        key,
        memberRowIds: (members.get(key) ?? []).map((row) => row.id),
      }));
      this.groups.set(summary.id, groups);
      this.rowCounts.set(summary.id, groups.length);
      for (const group of groups) {
        const rows = members.get(group.key) ?? [];
        const first = rows[0] as RowData;
        for (const column of summary.columns) {
          const node = cellKey(group.id, column.id);
          const dependencies = new Set<string>();
          for (const groupColumn of summary.summary.groupBy) {
            for (const row of rows) dependencies.add(cellKey(row.id, groupColumn));
          }
          let computed: Value;
          if (column.id === SUMMARY_COUNT_COLUMN_ID) {
            computed = decValue(fromInt(rows.length));
          } else if (column.id.startsWith('sum:')) {
            const sourceColumnId = column.id.slice('sum:'.length);
            for (const row of rows) dependencies.add(cellKey(row.id, sourceColumnId));
            computed = aggregate(
              'sum',
              rows.map((row) => this.cellValue(row.id, sourceColumnId)),
            );
          } else {
            computed = this.cellValue(first.id, column.id);
          }
          const value = finalise(computed);
          this.deps.set(node, [...dependencies]);
          this.cells.set(node, {
            tableId: summary.id,
            rowId: group.id,
            columnId: column.id,
            value,
            display: displayOf(value),
            kind: kindOf(value),
            jsonValue: jsonValueOf(value),
            revision: null,
          });
        }
      }
    }
  }

  preview(table: TableData, row: RowData, expr: Expr): Value {
    return finalise(this.evaluateExpr(expr, table, row));
  }

  /** A Reference keys on its target row id, every other type on its display. */
  private groupKey(source: TableData, groupBy: string[], row: RowData): string {
    return groupBy
      .map((columnId) => {
        const cell = this.cells.get(cellKey(row.id, columnId));
        if (cell === undefined || cell.value.t === 'blank') return 'b';
        const column = source.columns.find((c) => c.id === columnId);
        if (column?.type === 'reference' && cell.value.t !== 'err') {
          return `r:${row.cells.get(columnId)?.raw ?? ''}`;
        }
        return `v:${cell.display}`;
      })
      .join('\u0000');
  }
}

function arithmetic(op: '+' | '-' | '*' | '/', left: Value, right: Value): Value {
  const leftDate = left.t === 'date';
  const rightDate = right.t === 'date';
  if (op === '*' || op === '/') {
    if (leftDate || rightDate) return errValue('#TYPE!');
    const a = numberOperand(left);
    const b = numberOperand(right);
    if (a === null || b === null) return errValue('#TYPE!');
    if (op === '*') return decValue(mul(a, b));
    if (isZero(b)) return errValue('#DIV/0!');
    return decValue(div(a, b));
  }
  if (leftDate && rightDate) {
    if (op === '+') return errValue('#TYPE!');
    const a = dateToDayNumber((left as { s: string }).s);
    const b = dateToDayNumber((right as { s: string }).s);
    if (a === null || b === null) return errValue('#TYPE!');
    return decValue(fromInt(a - b));
  }
  if (leftDate || rightDate) {
    if (op === '-' && rightDate) return errValue('#TYPE!');
    const dateText = leftDate ? (left as { s: string }).s : (right as { s: string }).s;
    const other = numberOperand(leftDate ? right : left);
    if (other === null) return errValue('#TYPE!');
    const offset = toWholeNumber(other);
    if (offset === null) return errValue('#TYPE!');
    const days = dateToDayNumber(dateText);
    if (days === null) return errValue('#TYPE!');
    const result = dayNumberToDate(op === '+' ? days + offset : days - offset);
    if (result === null) return errValue('#TYPE!');
    return { t: 'date', s: result };
  }
  const a = numberOperand(left);
  const b = numberOperand(right);
  if (a === null || b === null) return errValue('#TYPE!');
  return decValue(op === '+' ? add(a, b) : sub(a, b));
}

function numberOperand(value: Value): Dec | null {
  if (value.t === 'blank') return ZERO;
  if (value.t === 'dec') return value.d;
  return null;
}

function comparison(
  op: '=' | '<>' | '<' | '>' | '<=' | '>=',
  left: Value,
  right: Value,
): Value {
  const ordering = compareValues(left, right);
  if (ordering === null) return errValue('#TYPE!');
  switch (op) {
    case '=':
      return { t: 'bool', b: ordering === 0 };
    case '<>':
      return { t: 'bool', b: ordering !== 0 };
    case '<':
      return { t: 'bool', b: ordering < 0 };
    case '>':
      return { t: 'bool', b: ordering > 0 };
    case '<=':
      return { t: 'bool', b: ordering <= 0 };
    case '>=':
      return { t: 'bool', b: ordering >= 0 };
  }
}

function compareValues(left: Value, right: Value): number | null {
  if (left.t === 'blank' && right.t === 'blank') return 0;
  const pair = (a: Value['t'], b: Value['t']): boolean =>
    (left.t === a && right.t === b) || (left.t === b && right.t === a);
  if (left.t === 'dec' && right.t === 'dec') return compare(left.d, right.d);
  if (pair('dec', 'blank')) {
    const a = left.t === 'dec' ? left.d : ZERO;
    const b = right.t === 'dec' ? right.d : ZERO;
    return compare(a, b);
  }
  if (left.t === 'text' && right.t === 'text') return compareCodePoints(left.s, right.s);
  if (pair('text', 'blank')) {
    const a = left.t === 'text' ? left.s : '';
    const b = right.t === 'text' ? right.s : '';
    return compareCodePoints(a, b);
  }
  if (left.t === 'bool' && right.t === 'bool') {
    return left.b === right.b ? 0 : left.b ? 1 : -1;
  }
  if (pair('bool', 'blank')) {
    const a = left.t === 'bool' ? left.b : false;
    const b = right.t === 'bool' ? right.b : false;
    return a === b ? 0 : a ? 1 : -1;
  }
  if (left.t === 'date' && right.t === 'date') {
    const a = dateToDayNumber(left.s);
    const b = dateToDayNumber(right.s);
    if (a === null || b === null) return null;
    return a === b ? 0 : a < b ? -1 : 1;
  }
  if (pair('date', 'blank')) return left.t === 'blank' ? -1 : 1;
  return null;
}

function aggregate(fn: 'sum' | 'min' | 'max' | 'average', values: Value[]): Value {
  for (const value of values) {
    if (value.t === 'err') return value;
  }
  const numbers: Dec[] = [];
  for (const value of values) {
    if (value.t === 'blank') {
      if (fn === 'sum') numbers.push(ZERO);
      continue;
    }
    if (value.t !== 'dec') return errValue('#TYPE!');
    numbers.push(value.d);
  }
  if (fn === 'sum') {
    return decValue(numbers.reduce((total, value) => add(total, value), ZERO));
  }
  if (fn === 'average') {
    if (numbers.length === 0) return errValue('#DIV/0!');
    const total = numbers.reduce((sum, value) => add(sum, value), ZERO);
    return decValue(div(total, fromInt(numbers.length)));
  }
  if (numbers.length === 0) return BLANK;
  let best = numbers[0] as Dec;
  for (const value of numbers) {
    const ordering = compare(value, best);
    if (fn === 'min' ? ordering < 0 : ordering > 0) best = value;
  }
  return decValue(best);
}

export function evaluateDocument(doc: DocData, viewer: Viewer): Snapshot {
  return new DocumentEvaluator(doc, viewer).run();
}

/** Evaluates an unsaved formula against one row, without saving anything. */
export function previewExpression(
  doc: DocData,
  viewer: Viewer,
  table: TableData,
  row: RowData,
  expr: Expr,
): Value {
  const evaluator = new DocumentEvaluator(doc, viewer);
  evaluator.run();
  return evaluator.preview(table, row, expr);
}

export function cellJson(cell: EvalCell): CellJson {
  return {
    value: cell.jsonValue,
    display: cell.display,
    kind: cell.kind,
    revision: cell.revision,
  };
}

export function decimalDisplay(value: Dec): string {
  return formatDecimal(value);
}

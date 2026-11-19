// Running a resolved formula. Row-level parts compile once per query into closures over a row index. Aggregate parts
// run over groups of rows (the marks, the level of a level-of-detail expression, or the rows of a total), one value per
// group, so a table calculation sees every mark at once.
import type { Cell, SetDef, TableCalc, TableCalcKind } from '../../../shared/model.ts';
import { aggregate } from '../aggregate.ts';
import type { Work } from '../work.ts';
import { BINARY_FUNCTIONS, negate, not, scalarFunction } from './functions.ts';
import type { RNode } from './resolved.ts';

export type RowFn = (row: number) => Cell;
export type LodNode = Extract<RNode, { k: 'lod' }>;
export type Rows = ArrayLike<number>;

/** Rows evaluated between two yields. */
export const CHUNK = 4096;

export interface EvalRuntime {
  compiled: Map<RNode, RowFn>;
  param(name: string): Cell;
  /** a set's membership per row; ready before any formula naming the set runs */
  setMember(set: SetDef): RowFn;
  /** a level-of-detail expression's value per source row; ready before any formula holding it runs */
  lodValues(node: LodNode): readonly Cell[];
}

/** Table calculations over the groups being evaluated, which must be the marks in mark order. */
export type TableCalcRunner = (kind: TableCalcKind, values: Cell[], using: TableCalc | null) => Cell[];

export function compileRow(node: RNode, rt: EvalRuntime): RowFn {
  const known = rt.compiled.get(node);
  if (known) return known;
  const fn = build(node, rt);
  rt.compiled.set(node, fn);
  return fn;
}

function build(node: RNode, rt: EvalRuntime): RowFn {
  switch (node.k) {
    case 'const': {
      const value = node.value;
      return () => value;
    }
    case 'field': {
      const values = node.field.values;
      return (row) => values[row] ?? null;
    }
    case 'param': {
      const value = rt.param(node.name);
      return () => value;
    }
    case 'set':
      return rt.setMember(node.set);
    case 'unary': {
      const arg = compileRow(node.arg, rt);
      const op = node.op === '-' ? negate : not;
      return (row) => op(arg(row));
    }
    case 'binary': {
      const f = BINARY_FUNCTIONS[node.op];
      const left = compileRow(node.left, rt);
      const right = compileRow(node.right, rt);
      return (row) => f(left(row), right(row));
    }
    case 'fn': {
      const f = scalarFunction(node.name, node.args.map((a) => a.type));
      const args = node.args.map((a) => compileRow(a, rt));
      return (row) => f(args.map((a) => a(row)));
    }
    case 'lod': {
      const values = rt.lodValues(node);
      return (row) => values[row] ?? null;
    }
    case 'agg':
    case 'tablecalc':
      throw new Error('an aggregate has no row value');
  }
}

function* aggregateGroups(node: Extract<RNode, { k: 'agg' }>, groups: readonly Rows[], rt: EvalRuntime): Work<Cell[]> {
  const arg = node.arg;
  const once = arg.k === 'field' ? arg.field.rightRows : null;
  const value = compileRow(arg, rt);
  const out: Cell[] = [];
  let done = 0;
  for (const rows of groups) {
    const values: Cell[] = [];
    const seen = once ? new Set<number>() : null;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] ?? 0;
      if (once && seen) {
        const right = once[row] ?? -1;
        if (right < 0 || seen.has(right)) continue;
        seen.add(right);
      }
      values.push(value(row));
      if (++done % CHUNK === 0) yield;
    }
    out.push(aggregate(node.fn, values, arg.type));
  }
  return out;
}

/** One value per group. `tableCalc` is null where there are no marks (a level of detail, a total). */
export function* evalGroups(
  node: RNode,
  groups: readonly Rows[],
  rt: EvalRuntime,
  tableCalc: TableCalcRunner | null,
): Work<Cell[]> {
  switch (node.k) {
    case 'agg':
      return yield* aggregateGroups(node, groups, rt);
    case 'tablecalc': {
      const inner = yield* evalGroups(node.arg, groups, rt, tableCalc);
      return tableCalc ? tableCalc(node.kind, inner, node.using) : inner.map(() => null);
    }
    case 'unary': {
      const op = node.op === '-' ? negate : not;
      return (yield* evalGroups(node.arg, groups, rt, tableCalc)).map(op);
    }
    case 'binary': {
      const f = BINARY_FUNCTIONS[node.op];
      const left = yield* evalGroups(node.left, groups, rt, tableCalc);
      const right = yield* evalGroups(node.right, groups, rt, tableCalc);
      return left.map((l, i) => f(l, right[i] ?? null));
    }
    case 'fn': {
      const f = scalarFunction(node.name, node.args.map((a) => a.type));
      const args: Cell[][] = [];
      for (const arg of node.args) args.push(yield* evalGroups(arg, groups, rt, tableCalc));
      return groups.map((_, i) => f(args.map((values) => values[i] ?? null)));
    }
    default: {
      const value = compileRow(node, rt);
      return groups.map((rows) => value(rows[0] ?? 0));
    }
  }
}

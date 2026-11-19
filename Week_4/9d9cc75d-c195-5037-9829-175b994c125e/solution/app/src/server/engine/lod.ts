// Level-of-detail expressions: AT computes at exactly its dimensions ({agg} at none), PLUS at the view's dimensions
// plus its own, MINUS at the view's dimensions minus its own. Each gives one value per source row at its level, from
// the rows passing the query steps before it.
import type { Cell } from '../../shared/model.ts';
import { CHUNK, compileRow, evalGroups, type EvalRuntime, type LodNode, type Rows } from './formula/evaluate.ts';
import { cellKey } from './values.ts';
import type { Work } from './work.ts';

/** A dimension a level groups by: its field name and each row's member key. */
export interface LevelDim {
  name: string;
  key: (row: number) => string;
}

function levelOf(node: LodNode, viewDims: readonly LevelDim[], rt: EvalRuntime): LevelDim[] {
  const own = node.dims.map((dim): LevelDim => {
    const value = compileRow(dim.node, rt);
    const type = dim.node.type;
    return { name: dim.name, key: (row) => cellKey(value(row), type) };
  });
  const names = new Set(node.dims.map((d) => d.name));
  switch (node.form) {
    case 'ALL':
    case 'AT':
      return own;
    case 'PLUS':
      return [...viewDims, ...own.filter((d) => !viewDims.some((v) => v.name === d.name))];
    case 'MINUS':
      return viewDims.filter((d) => !names.has(d.name));
  }
}

export function* computeLod(
  node: LodNode,
  rows: Rows,
  rowCount: number,
  viewDims: readonly LevelDim[],
  rt: EvalRuntime,
): Work<Cell[]> {
  const level = levelOf(node, viewDims, rt);
  const groups = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? 0;
    const key = level.map((d) => d.key(row)).join('\u0001');
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
    if ((i + 1) % CHUNK === 0) yield;
  }
  const members = [...groups.values()];
  const values = yield* evalGroups(node.body, members, rt, null);
  const out: Cell[] = new Array<Cell>(rowCount).fill(null);
  members.forEach((group, i) => {
    const value = values[i] ?? null;
    for (const row of group) out[row] = value;
  });
  return out;
}

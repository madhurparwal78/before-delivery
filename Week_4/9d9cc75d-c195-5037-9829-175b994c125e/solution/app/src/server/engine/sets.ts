// Sets: chosen members of one dimension, or its Top N members by a measure (computed at the top N step). A request
// may replace a set's members (a viewer's change set action). In a formula a set is true or false per row; on a shelf
// it shows `In` and `Out`.
import type { Cell, SetDef, ValueType } from '../../shared/model.ts';
import type { EvalRuntime, RowFn, Rows } from './formula/evaluate.ts';
import type { RNode } from './formula/resolved.ts';
import { topMembers } from './filters.ts';
import { cellKey } from './values.ts';
import type { Work } from './work.ts';

export const IN = 'In';
export const OUT = 'Out';

interface SetInputs {
  /** each row's member of the set's field */
  member: RowFn;
  type: ValueType | null;
  /** the members a request puts in the set instead */
  replaced: readonly Cell[] | undefined;
  /** for a Top N set: N, and the measure it ranks by */
  top: { n: number; by: RNode } | null;
  rows: Rows;
  rt: EvalRuntime;
}

/** Each row's membership. */
export function* setMembership(set: SetDef, inputs: SetInputs): Work<(row: number) => boolean> {
  const { member, type, top } = inputs;
  const keys =
    !inputs.replaced && top
      ? yield* topMembers(member, type, inputs.rows, top.n, top.by, inputs.rt)
      : new Set((inputs.replaced ?? set.members ?? []).map((m) => cellKey(m, type)));
  return (row) => {
    const value = member(row);
    return value !== null && keys.has(cellKey(value, type));
  };
}

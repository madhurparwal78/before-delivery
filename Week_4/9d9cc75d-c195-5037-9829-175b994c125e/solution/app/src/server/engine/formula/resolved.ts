// A checked formula: names resolved to fields, sets and parameters, calculations inlined where they are named (one
// shared subtree per calculation, so a level-of-detail expression is one object however often it is named), and a
// static type on every node.
import type { Agg, Cell, SetDef, TableCalc, TableCalcKind } from '../../../shared/model.ts';
import type { DatasetField } from '../contract.ts';
import type { BinaryOp, LodForm } from './ast.ts';
import type { StaticType } from './functions.ts';

/** `const` holds no row value, `row` gives one value per row, `agg` one value per group of rows. */
export type Level = 'const' | 'row' | 'agg';

interface Typed {
  type: StaticType;
}

/** A level-of-detail dimension: a field (or a row-level calculation, or a set) by its name. */
export interface LodDim {
  name: string;
  node: RNode;
}

export type RNode =
  | (Typed & { k: 'const'; value: Cell })
  | (Typed & { k: 'field'; field: DatasetField })
  | (Typed & { k: 'param'; name: string })
  | (Typed & { k: 'set'; set: SetDef })
  | (Typed & { k: 'unary'; op: '-' | 'NOT'; arg: RNode })
  | (Typed & { k: 'binary'; op: BinaryOp; left: RNode; right: RNode })
  | (Typed & { k: 'fn'; name: string; args: RNode[] })
  | (Typed & { k: 'agg'; fn: Agg; arg: RNode })
  /** `using` null: Table across, or what the measure pill says */
  | (Typed & { k: 'tablecalc'; kind: TableCalcKind; arg: RNode; using: TableCalc | null })
  | (Typed & { k: 'lod'; form: LodForm; dims: LodDim[]; body: RNode });

export interface Analysis {
  root: RNode;
  level: Level;
  hasLod: boolean;
  hasTableCalc: boolean;
}

export function children(node: RNode): RNode[] {
  switch (node.k) {
    case 'unary':
    case 'agg':
    case 'tablecalc':
      return [node.arg];
    case 'binary':
      return [node.left, node.right];
    case 'fn':
      return node.args;
    case 'lod':
      return [...node.dims.map((d) => d.node), node.body];
    default:
      return [];
  }
}

/** Every node once per path, calculations included where they are named. */
export function forEachNode(node: RNode, visit: (node: RNode) => void): void {
  const pending: RNode[] = [node];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    visit(next);
    pending.push(...children(next));
  }
}

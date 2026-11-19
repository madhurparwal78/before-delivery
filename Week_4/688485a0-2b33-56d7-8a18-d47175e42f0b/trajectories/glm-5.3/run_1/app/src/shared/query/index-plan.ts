import { JsonValue, compareValues } from "../values.js";
import { FilterPlan, FieldCondition, eq } from "./filter.js";

/**
 * Index choice and examined counts (DP-37): the single definition of the query
 * plan. A condition qualifies when it sits on the index's first key at the top
 * level of the filter or inside a top-level $and, and uses equality, $eq, $in
 * or a range operator.
 */

export interface IndexDef {
  name: string;
  keys: { path: string; dir: 1 | -1 }[];
  unique: boolean;
}

export interface Plan {
  kind: "index" | "full_scan";
  index: string | null;
  docsExamined: number;
  returned: number;
}

/** The qualifying operators of a filter on one path (DP-37). */
export function qualifyingConditions(plan: FilterPlan): Map<string, QualOp[]> {
  const byPath = new Map<string, QualOp[]>();
  const push = (path: string, op: QualOp): void => {
    const list = byPath.get(path);
    if (list) list.push(op);
    else byPath.set(path, [op]);
  };
  const addField = (c: FieldCondition): void => {
    for (const op of c.ops) {
      if (op.op === "$eq") push(c.path, { op: "$eq", value: op.value });
      else if (op.op === "$in") push(c.path, { op: "$in", values: op.values });
      else if (op.op === "$gt" || op.op === "$gte" || op.op === "$lt" || op.op === "$lte") {
        push(c.path, { op: op.op, value: op.value });
      }
    }
  };
  for (const c of plan.conditions) {
    if (c.kind === "field") {
      addField(c);
    } else if (c.op === "$and") {
      for (const sub of c.filters) {
        for (const sc of sub.conditions) {
          if (sc.kind === "field") addField(sc);
        }
      }
    }
  }
  return byPath;
}

export type QualOp =
  | { op: "$eq"; value: JsonValue }
  | { op: "$in"; values: JsonValue[] }
  | { op: "$gt" | "$gte" | "$lt" | "$lte"; value: JsonValue };

/** Does a first-key value meet the qualifying operators, arrays matching by any element, missing as null? */
export function valueQualifies(value: JsonValue, ops: QualOp[]): boolean {
  for (const op of ops) {
    if (op.op === "$eq") {
      if (!eq(value, op.value)) return false;
    } else if (op.op === "$in") {
      if (!op.values.some(x => eq(value, x))) return false;
    } else {
      const v = value;
      if (!sameClass(v, op.value)) return false;
      const cmp = compareValues(v, op.value);
      if (op.op === "$gt" && !(cmp > 0)) return false;
      if (op.op === "$gte" && !(cmp >= 0)) return false;
      if (op.op === "$lt" && !(cmp < 0)) return false;
      if (op.op === "$lte" && !(cmp <= 0)) return false;
    }
  }
  return true;
}

function sameClass(a: JsonValue, b: JsonValue): boolean {
  return classify(a) === classify(b);
}
function classify(v: JsonValue): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** Choose the plan: the index with the most leading keys constrained, ties by name (DP-37). */
export function choosePlan(
  filter: FilterPlan,
  indexes: IndexDef[],
  firstKeyValues: Map<string, JsonValue[]>,
): Plan {
  const byPath = qualifyingConditions(filter);
  let best: { index: IndexDef; constrained: number } | null = null;
  for (const idx of indexes) {
    let constrained = 0;
    for (const key of idx.keys) {
      if (byPath.has(key.path)) constrained++;
      else break;
    }
    if (constrained > 0) {
      if (best === null || constrained > best.constrained ||
        (constrained === best.constrained && idx.name < best.index.name)) {
        best = { index: idx, constrained };
      }
    }
  }
  if (best === null) {
    return { kind: "full_scan", index: null, docsExamined: -1, returned: -1 };
  }
  const firstPath = best.index.keys[0].path;
  const ops = byPath.get(firstPath) ?? [];
  let examined = 0;
  for (const value of firstKeyValues.get(firstPath) ?? []) {
    if (valueQualifies(value, ops)) examined++;
  }
  return { kind: "index", index: best.index.name, docsExamined: examined, returned: -1 };
}

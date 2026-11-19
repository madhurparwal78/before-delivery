import { createHash } from "node:crypto";
import type { JsonObject, JsonValue } from "../../shared/json.js";
import { fail } from "../errors.js";
import { compileFilter, isOperatorObject, type Predicate } from "./filter.js";
import { reach, splitPath } from "./path.js";
import { isPlainObject, keyText } from "./value.js";

/** Indexes: key definitions, the entries a document has under them, and the plan a filter gets. */

export interface IndexDefinition {
  name: string;
  keys: Record<string, 1 | -1>;
  unique: boolean;
}

export function defaultIndexName(keys: Record<string, 1 | -1>): string {
  return Object.entries(keys)
    .map(([path, direction]) => `${path}_${direction}`)
    .join("_");
}

export function parseIndexKeys(value: JsonValue | undefined): Record<string, 1 | -1> {
  if (!isPlainObject(value as JsonValue) || Object.keys(value as JsonObject).length === 0) return fail("invalid_index");
  const keys: Record<string, 1 | -1> = {};
  for (const [path, direction] of Object.entries(value as JsonObject)) {
    if ((direction !== 1 && direction !== -1) || path === "" || path.startsWith("$")) return fail("invalid_index");
    keys[path] = direction;
  }
  return keys;
}

function valuesUnderKey(doc: JsonObject, path: string): JsonValue[] {
  const seen = new Set<string>();
  const out: JsonValue[] = [];
  const add = (value: JsonValue): void => {
    const text = keyText(value);
    if (!seen.has(text)) {
      seen.add(text);
      out.push(value);
    }
  };
  for (const value of reach(doc, splitPath(path)).values) {
    if (Array.isArray(value)) (value.length > 0 ? value : [null]).forEach(add);
    else add(value);
  }
  if (out.length === 0) add(null);
  return out;
}

interface IndexEntry {
  hash: string;
  value: JsonValue;
}

/** One entry per key value (per tuple of key values for a compound index); an array field gives one per element. */
export function indexEntries(doc: JsonObject, definition: IndexDefinition): IndexEntry[] {
  const paths = Object.keys(definition.keys);
  let tuples: JsonValue[][] = [[]];
  for (const path of paths) {
    const options = valuesUnderKey(doc, path);
    tuples = tuples.flatMap((tuple) => options.map((option) => [...tuple, option]));
  }
  return tuples.map((tuple) => ({
    hash: createHash("sha256").update(`[${tuple.map(keyText).join(",")}]`).digest("hex"),
    value: paths.length === 1 ? (tuple[0] as JsonValue) : Object.fromEntries(paths.map((path, index) => [path, tuple[index] as JsonValue])),
  }));
}

const QUALIFYING = ["$eq", "$in", "$gt", "$gte", "$lt", "$lte"];

interface Condition {
  path: string;
  operators: JsonObject;
}

function qualifyingConditions(filter: JsonObject): Condition[] {
  const sources: JsonObject[] = [filter];
  const conjunction = filter["$and"];
  if (Array.isArray(conjunction)) sources.push(...conjunction.filter((part): part is JsonObject => isPlainObject(part)));
  const found: Condition[] = [];
  for (const source of sources) {
    for (const [path, condition] of Object.entries(source)) {
      if (path.startsWith("$")) continue;
      if (isOperatorObject(condition)) {
        const operators = Object.fromEntries(Object.entries(condition).filter(([name]) => QUALIFYING.includes(name)));
        if (Object.keys(operators).length > 0) found.push({ path, operators });
      } else {
        found.push({ path, operators: { $eq: condition } });
      }
    }
  }
  return found;
}

export interface QueryPlan {
  /** The index the filter uses, or null for a full scan. */
  index: string | null;
  /** Matches the documents whose first-key value meets the qualifying operators. */
  firstKey: Predicate | null;
}

export function choosePlan(filter: JsonObject, indexes: IndexDefinition[]): QueryPlan {
  const conditions = qualifyingConditions(filter);
  let best: { name: string; leading: number; first: string } | null = null;
  for (const index of indexes) {
    const paths = Object.keys(index.keys);
    let leading = 0;
    while (leading < paths.length && conditions.some((condition) => condition.path === paths[leading])) leading++;
    if (leading === 0) continue;
    const better = !best || leading > best.leading || (leading === best.leading && index.name < best.name);
    if (better) best = { name: index.name, leading, first: paths[0] as string };
  }
  if (!best) return { index: null, firstKey: null };
  const first = best.first;
  const predicates = conditions.filter((condition) => condition.path === first).map((condition) => compileFilter({ [first]: condition.operators }));
  return { index: best.name, firstKey: (doc) => predicates.every((predicate) => predicate(doc)) };
}

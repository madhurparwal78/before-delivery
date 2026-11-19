import type { JsonObject, JsonValue } from "../../shared/json.js";
import { fail } from "../errors.js";
import { expressionValue, splitPath } from "./path.js";
import { isPlainObject } from "./value.js";

/** Projection: include, exclude or drop `_id`; `$project` adds copies of other fields. */

interface PathTree {
  whole: boolean;
  children: Map<string, PathTree>;
}

function buildTree(paths: string[]): PathTree {
  const root: PathTree = { whole: false, children: new Map() };
  for (const path of paths) {
    let node = root;
    for (const segment of splitPath(path)) {
      let next = node.children.get(segment);
      if (!next) node.children.set(segment, (next = { whole: false, children: new Map() }));
      node = next;
    }
    node.whole = true;
  }
  return root;
}

function pick(value: JsonValue, tree: PathTree): JsonValue | undefined {
  if (tree.whole) return value;
  if (Array.isArray(value)) {
    return value.map((element) => pick(element, tree)).filter((element): element is JsonValue => element !== undefined);
  }
  if (!isPlainObject(value)) return undefined;
  const out: JsonObject = {};
  for (const [key, inner] of Object.entries(value)) {
    const sub = tree.children.get(key);
    if (!sub) continue;
    const picked = pick(inner, sub);
    if (picked !== undefined) out[key] = picked;
  }
  return out;
}

function omit(value: JsonValue, tree: PathTree): JsonValue {
  if (Array.isArray(value)) return value.map((element) => omit(element, tree));
  if (!isPlainObject(value)) return value;
  const out: JsonObject = {};
  for (const [key, inner] of Object.entries(value)) {
    const sub = tree.children.get(key);
    if (!sub) out[key] = inner;
    else if (!sub.whole) out[key] = omit(inner, sub);
  }
  return out;
}

export type Projection = (doc: JsonObject) => JsonObject;

const switchOf = (value: JsonValue): boolean | null =>
  value === 1 || value === true ? true : value === 0 || value === false ? false : null;

export function compileProjection(spec: JsonObject, allowCopies: boolean): Projection {
  const included: string[] = [];
  const excluded: string[] = [];
  const copies: [string, string][] = [];
  let idSwitch: boolean | null = null;
  for (const [path, value] of Object.entries(spec)) {
    if (typeof value === "string" && allowCopies && value.startsWith("$") && value.length > 1 && path !== "_id") {
      if (path.includes(".") || path.startsWith("$")) fail("invalid_projection");
      copies.push([path, value]);
      continue;
    }
    const on = switchOf(value);
    if (on === null) fail("invalid_projection");
    if (path === "_id") idSwitch = on;
    else (on ? included : excluded).push(path);
  }
  const inclusive = included.length > 0 || copies.length > 0 || (idSwitch === true && excluded.length === 0);
  if (inclusive && excluded.length > 0) fail("invalid_projection");
  if (Object.keys(spec).length === 0) return (doc) => doc;
  if (!inclusive) {
    const tree = buildTree([...excluded, ...(idSwitch === false ? ["_id"] : [])]);
    return (doc) => omit(doc, tree) as JsonObject;
  }
  const tree = buildTree(included);
  return (doc) => {
    const out: JsonObject = {};
    if (idSwitch !== false && doc["_id"] !== undefined) out["_id"] = doc["_id"];
    for (const [key, value] of Object.entries(doc)) {
      const sub = key === "_id" ? undefined : tree.children.get(key);
      if (!sub) continue;
      const picked = pick(value, sub);
      if (picked !== undefined) out[key] = picked;
    }
    for (const [name, expression] of copies) {
      const value = expressionValue(doc, expression);
      if (value !== undefined) out[name] = value;
    }
    return out;
  };
}

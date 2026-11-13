// Field types and values (Business rules A): inference, fit, flattening of nested events.
import { parseIsoInstant } from "../../shared/time";

export type FieldType = "number" | "date" | "boolean" | "text" | "keyword";
export const FIELD_TYPES: FieldType[] = ["number", "date", "boolean", "text", "keyword"];
export type Scalar = string | number | boolean;
export type Doc = { [key: string]: unknown };

export function isScalar(value: unknown): value is Scalar {
  return typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

export function isPlainObject(value: unknown): value is Doc {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The type a value would be inferred as: number, date, boolean, then text. */
export function inferType(value: Scalar): FieldType {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return parseIsoInstant(value) !== null ? "date" : "text";
}

export function fitsType(type: FieldType, value: Scalar): boolean {
  if (type === "text" || type === "keyword") return typeof value === "string";
  if (type === "date") return typeof value === "string" && parseIsoInstant(value) !== null;
  if (type === "number") return typeof value === "number";
  return typeof value === "boolean";
}

/** Every value of every dotted path; an array of objects contributes each object's values under the same path. */
export function flatten(doc: Doc): Map<string, Scalar[]> {
  const paths = new Map<string, Scalar[]>();
  const add = (path: string, value: unknown): void => {
    if (isScalar(value)) {
      const list = paths.get(path);
      if (list) list.push(value);
      else paths.set(path, [value]);
    } else if (Array.isArray(value)) {
      for (const item of value) add(path, item);
    } else if (isPlainObject(value)) {
      for (const [key, child] of Object.entries(value)) add(`${path}.${key}`, child);
    }
  };
  for (const [key, value] of Object.entries(doc)) add(key, value);
  return paths;
}

/** The flattened fields as the API shows them: a scalar stays a scalar, an array stays an array. */
export function displayFields(doc: Doc): Doc {
  const shown: Doc = {};
  const add = (path: string, value: unknown): void => {
    if (isScalar(value)) {
      shown[path] = value;
    } else if (Array.isArray(value)) {
      const objects = value.filter(isPlainObject);
      if (objects.length === value.length && objects.length > 0) {
        const merged = new Map<string, unknown[]>();
        for (const object of objects) {
          for (const [childPath, childValue] of Object.entries(displayFields(object))) {
            merged.set(childPath, [...(merged.get(childPath) ?? []), childValue]);
          }
        }
        for (const [childPath, values] of merged) shown[`${path}.${childPath}`] = values.flat();
      } else if (value.length > 0) {
        shown[path] = value;
      }
    } else if (isPlainObject(value)) {
      for (const [key, child] of Object.entries(value)) add(`${path}.${key}`, child);
    }
  };
  for (const [key, value] of Object.entries(doc)) add(key, value);
  return shown;
}


interface Leaves {
  paths: Map<string, Scalar[]>;
  /** Paths whose array mixes JSON types, in document order. */
  mixed: Set<string>;
}

const kindOf = (value: unknown): string => (Array.isArray(value) ? "array" : value === null ? "null" : typeof value);

/** Like `flatten`, but also notes arrays that mix types; `null` values are dropped. */
export function collectLeaves(doc: Doc): Leaves {
  const leaves: Leaves = { paths: new Map(), mixed: new Set() };
  const add = (path: string, value: unknown): void => {
    if (isScalar(value)) {
      leaves.paths.set(path, [...(leaves.paths.get(path) ?? []), value]);
    } else if (Array.isArray(value)) {
      const kinds = new Set(value.map(kindOf));
      if (kinds.size > 1 || kinds.has("array")) {
        leaves.mixed.add(path);
        if (!leaves.paths.has(path)) leaves.paths.set(path, []);
        return;
      }
      for (const item of value) add(path, item);
    } else if (isPlainObject(value)) {
      for (const [key, child] of Object.entries(value)) add(`${path}.${key}`, child);
    }
  };
  for (const [key, value] of Object.entries(doc)) add(key, value);
  return leaves;
}

import type { JsonObject, JsonValue } from "../../shared/json.js";
import { isPlainObject } from "./value.js";

/** What a dot path reaches in a document: every value on the way, arrays expanded. */
export interface Reach {
  values: JsonValue[];
  present: boolean;
}

export function splitPath(path: string): string[] {
  return path.split(".");
}

export function reach(root: JsonValue, segments: string[]): Reach {
  const values: JsonValue[] = [];
  const walk = (current: JsonValue, at: number): void => {
    if (at === segments.length) {
      values.push(current);
      return;
    }
    const segment = segments[at] as string;
    if (Array.isArray(current)) {
      if (/^\d+$/.test(segment)) {
        const element = current[Number(segment)];
        if (element !== undefined) walk(element, at + 1);
      } else {
        for (const element of current) if (isPlainObject(element) || Array.isArray(element)) walk(element, at);
      }
    } else if (isPlainObject(current) && Object.hasOwn(current, segment)) {
      walk(current[segment] as JsonValue, at + 1);
    }
  };
  walk(root, 0);
  return { values, present: values.length > 0 };
}

/** The value at a path that descends objects only; a path through an array is absent. */
export function objectPathValue(root: JsonObject, path: string): { found: boolean; value: JsonValue } {
  let current: JsonValue = root;
  for (const segment of splitPath(path)) {
    if (!isPlainObject(current) || !Object.hasOwn(current, segment)) return { found: false, value: null };
    current = current[segment] as JsonValue;
  }
  return { found: true, value: current };
}

/** `"$a.b"` expression value: arrays can be indexed by position, or mapped over by name. Missing gives undefined. */
export function expressionValue(root: JsonObject, expression: string): JsonValue | undefined {
  const { values, present } = reach(root, splitPath(expression.slice(1)));
  if (!present) return undefined;
  const [only] = values;
  return values.length === 1 && only !== undefined ? only : values;
}

/** Replace the value at an object path in a copy of the document (arrays and missing paths are left alone). */
export function withPathValue(root: JsonObject, path: string, value: JsonValue): JsonObject {
  const [head, ...rest] = splitPath(path);
  if (head === undefined) return root;
  const copy: JsonObject = { ...root };
  if (rest.length === 0) {
    copy[head] = value;
    return copy;
  }
  const inner = copy[head];
  copy[head] = isPlainObject(inner) ? withPathValue(inner, rest.join("."), value) : (inner as JsonValue);
  return copy;
}

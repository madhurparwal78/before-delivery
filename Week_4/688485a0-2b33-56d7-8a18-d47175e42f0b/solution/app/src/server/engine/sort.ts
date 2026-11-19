import type { JsonObject, JsonValue } from "../../shared/json.js";
import { fail } from "../errors.js";
import { reach, splitPath } from "./path.js";
import { compareValues } from "./value.js";

/** Sorting: keys in order, arrays by smallest (ascending) or largest (descending) element, ties by `_id`. */

function sortKeyValue(doc: JsonObject, segments: string[], direction: 1 | -1): JsonValue {
  const found: JsonValue[] = [];
  for (const value of reach(doc, segments).values) {
    if (Array.isArray(value)) found.push(...(value.length > 0 ? value : [null]));
    else found.push(value);
  }
  if (found.length === 0) return null;
  return found.reduce((best, value) => (compareValues(value, best) * direction < 0 ? value : best));
}

export function parseSort(sort: JsonObject | null): { segments: string[]; direction: 1 | -1 }[] {
  return Object.entries(sort ?? {}).map(([path, direction]) => {
    if (direction !== 1 && direction !== -1) return fail("invalid_query", { field: "sort" });
    return { segments: splitPath(path), direction };
  });
}

export function sortDocuments<T extends JsonObject>(docs: T[], sort: JsonObject | null): T[] {
  const keys = parseSort(sort);
  if (keys.length === 0) return docs;
  const decorated = docs.map((doc) => ({ doc, values: keys.map((key) => sortKeyValue(doc, key.segments, key.direction)) }));
  decorated.sort((a, b) => {
    for (const [index, key] of keys.entries()) {
      const order = compareValues(a.values[index], b.values[index]) * key.direction;
      if (order !== 0) return order;
    }
    return compareValues(a.doc["_id"], b.doc["_id"]);
  });
  return decorated.map((entry) => entry.doc);
}

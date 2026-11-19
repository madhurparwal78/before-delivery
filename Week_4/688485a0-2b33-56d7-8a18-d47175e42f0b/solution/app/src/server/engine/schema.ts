import type { JsonObject, JsonValue } from "../../shared/json.js";
import { byCodeUnit, typeOf } from "./value.js";

/** Schema summary: presence and type shares of every path in a sample of documents. */

type SchemaField = {
  path: string;
  present: number;
  types: { type: string; share: number }[];
};

const roundedPercent = (part: number, whole: number): number => Math.floor((200 * part + whole) / (2 * whole));

function collect(value: JsonValue, path: string, into: Map<string, Map<string, number>>): void {
  const type = typeOf(value);
  const counts = into.get(path) ?? new Map<string, number>();
  counts.set(type, (counts.get(type) ?? 0) + 1);
  into.set(path, counts);
  if (type !== "object") return;
  for (const [key, inner] of Object.entries(value as JsonObject)) collect(inner, `${path}.${key}`, into);
}

export function summariseSchema(sample: JsonObject[]): SchemaField[] {
  const perPath = new Map<string, Map<string, number>>();
  for (const doc of sample) {
    for (const [key, value] of Object.entries(doc)) collect(value, key, perPath);
  }
  return [...perPath.entries()]
    .sort(([a], [b]) => byCodeUnit(a, b))
    .map(([path, counts]) => {
      const having = [...counts.values()].reduce((sum, count) => sum + count, 0);
      const types = [...counts.entries()]
        .map(([type, count]) => ({ type, share: roundedPercent(count, having), count }))
        .sort((a, b) => b.share - a.share || byCodeUnit(a.type, b.type))
        .map(({ type, share }) => ({ type, share }));
      return { path, present: roundedPercent(having, sample.length), types };
    });
}

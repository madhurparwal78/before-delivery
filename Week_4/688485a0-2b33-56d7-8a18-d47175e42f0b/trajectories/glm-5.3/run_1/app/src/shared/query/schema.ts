import { JsonObj, JsonValue, typeName, isDateObject } from "../values.js";

/**
 * The schema summary (DP-46): paths descending into nested objects, arrays
 * reported as type array and not descended.
 */

export interface SchemaField {
  path: string;
  present: number;
  types: { type: string; share: number }[];
}

/** Percent rounded half up. */
export function percent(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.floor((part * 100) / whole + 0.5);
}

interface Counter { count: number; types: Map<string, number> }

/** Collects paths for one document, descending into objects only. */
function collect(v: JsonValue, prefix: string, out: Map<string, Counter>): void {
  if (typeof v !== "object" || v === null || isDateObject(v)) return;
  if (Array.isArray(v)) return; // arrays are a leaf type, not descended
  for (const k of Object.keys(v)) {
    const path = prefix ? prefix + "." + k : k;
    const value = v[k];
    let entry = out.get(path);
    if (!entry) {
      entry = { count: 0, types: new Map() };
      out.set(path, entry);
    }
    entry.count++;
    const t = typeName(value);
    entry.types.set(t, (entry.types.get(t) ?? 0) + 1);
    collect(value, path, out);
  }
}

export function schemaSummary(docs: JsonObj[]): { sampled: number; fields: SchemaField[] } {
  const byPath = new Map<string, Counter>();
  for (const doc of docs) collect(doc, "", byPath);
  const fields: SchemaField[] = [];
  const paths = [...byPath.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const path of paths) {
    const c = byPath.get(path) as Counter;
    const types = [...c.types.entries()]
      .map(([type, n]) => ({ type, share: percent(n, c.count) }))
      .sort((a, b) => b.share - a.share || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
    fields.push({ path, present: percent(c.count, docs.length), types });
  }
  return { sampled: docs.length, fields };
}

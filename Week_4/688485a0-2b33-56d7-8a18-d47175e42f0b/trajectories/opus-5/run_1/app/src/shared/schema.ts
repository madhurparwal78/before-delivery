import { percentHalfUp } from './numbers';
import { DocObject, DocValue, TypeName, valueType } from './values';

export interface SchemaField {
  path: string;
  present: number;
  types: Array<{ type: TypeName; share: number }>;
}

export interface SchemaSummary {
  sampled: number;
  fields: SchemaField[];
}

function collect(value: DocValue, prefix: string, seen: Map<string, TypeName>): void {
  const type = valueType(value);
  seen.set(prefix, type);
  if (type === 'object') {
    const object = value as DocObject;
    for (const key of Object.keys(object)) collect(object[key], `${prefix}.${key}`, seen);
  }
}

/** Presence and type shares over the sampled documents, as whole percents. */
export function computeSchema(docs: DocObject[]): SchemaSummary {
  const counts = new Map<string, { present: number; types: Map<TypeName, number> }>();
  for (const doc of docs) {
    const seen = new Map<string, TypeName>();
    for (const key of Object.keys(doc)) collect(doc[key], key, seen);
    for (const [path, type] of seen) {
      let entry = counts.get(path);
      if (!entry) {
        entry = { present: 0, types: new Map() };
        counts.set(path, entry);
      }
      entry.present += 1;
      entry.types.set(type, (entry.types.get(type) ?? 0) + 1);
    }
  }
  const fields: SchemaField[] = Array.from(counts.entries()).map(([path, entry]) => {
    const types = Array.from(entry.types.entries())
      .map(([type, count]) => ({ type, share: percentHalfUp(count, entry.present) }))
      .sort((left, right) => (right.share - left.share) || (left.type < right.type ? -1 : 1));
    return { path, present: percentHalfUp(entry.present, docs.length), types };
  });
  fields.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return { sampled: docs.length, fields };
}

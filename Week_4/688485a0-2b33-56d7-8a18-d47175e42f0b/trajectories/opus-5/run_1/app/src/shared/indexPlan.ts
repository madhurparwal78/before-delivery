import { canonicalKeyText } from './compare';
import { matchFilter } from './filter';
import { valuesAtPath } from './paths';
import { DocObject, DocValue, isPlainObject } from './values';

export interface IndexDefinition {
  name: string;
  keys: Array<{ path: string; direction: 1 | -1 }>;
  unique: boolean;
}

export interface QueryPlan {
  kind: 'index' | 'full_scan';
  index: string | null;
  docs_examined: number;
}

const RANGE_OPERATORS = new Set(['$eq', '$in', '$gt', '$gte', '$lt', '$lte']);

export function defaultIndexName(keys: Array<{ path: string; direction: 1 | -1 }>): string {
  return keys.map((key) => `${key.path}_${key.direction}`).join('_');
}

/** The values a document contributes to an index key: missing as null, arrays by element. */
export function indexValues(doc: DocObject, path: string): DocValue[] {
  const found = valuesAtPath(doc, path);
  if (found.length === 0) return [null];
  const out: DocValue[] = [];
  for (const value of found) {
    if (Array.isArray(value)) {
      if (value.length === 0) out.push(null);
      else for (const element of value) out.push(element);
    } else {
      out.push(value);
    }
  }
  return out;
}

/** The distinct key tuples a document contributes to an index, in order. */
export function indexKeyTuples(doc: DocObject, keys: Array<{ path: string; direction: 1 | -1 }>): DocValue[][] {
  let tuples: DocValue[][] = [[]];
  for (const key of keys) {
    const values = indexValues(doc, key.path);
    const next: DocValue[][] = [];
    for (const tuple of tuples) {
      for (const value of values) next.push([...tuple, value]);
    }
    tuples = next;
  }
  const seen = new Set<string>();
  const out: DocValue[][] = [];
  for (const tuple of tuples) {
    const text = canonicalKeyText(tuple);
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(tuple);
  }
  return out;
}

/** The conditions an index may use: top level of the filter or inside a top-level `$and`. */
function qualifyingConditions(filter: DocObject): Map<string, DocObject> {
  const byPath = new Map<string, DocObject>();
  const visit = (current: DocObject): void => {
    for (const key of Object.keys(current)) {
      const value = current[key];
      if (key === '$and') {
        for (const member of value as DocObject[]) visit(member);
        continue;
      }
      if (key.startsWith('$')) continue;
      const operators: DocObject = {};
      if (isPlainObject(value) && Object.keys(value).some((name) => name.startsWith('$'))) {
        for (const name of Object.keys(value)) {
          if (RANGE_OPERATORS.has(name)) operators[name] = value[name];
        }
      } else {
        operators['$eq'] = value;
      }
      if (Object.keys(operators).length === 0) continue;
      const existing = byPath.get(key);
      if (existing) Object.assign(existing, operators);
      else byPath.set(key, operators);
    }
  };
  visit(filter);
  return byPath;
}

/** Picks an index or a full scan and counts the examined documents. */
export function planQuery(filter: DocObject, indexes: IndexDefinition[], docs: DocObject[]): QueryPlan {
  const conditions = qualifyingConditions(filter);
  let best: { index: IndexDefinition; leading: number } | null = null;
  for (const index of indexes) {
    let leading = 0;
    for (const key of index.keys) {
      if (!conditions.has(key.path)) break;
      leading += 1;
    }
    if (leading === 0) continue;
    if (
      !best ||
      leading > best.leading ||
      (leading === best.leading && index.name < best.index.name)
    ) {
      best = { index, leading };
    }
  }
  if (!best) return { kind: 'full_scan', index: null, docs_examined: docs.length };
  const firstKey = best.index.keys[0];
  const condition = conditions.get(firstKey.path) as DocObject;
  const probe: DocObject = { value: condition };
  let examined = 0;
  for (const doc of docs) {
    const values = indexValues(doc, firstKey.path);
    if (values.some((value) => matchFilter(probe, { value }))) examined += 1;
  }
  return { kind: 'index', index: best.index.name, docs_examined: examined };
}

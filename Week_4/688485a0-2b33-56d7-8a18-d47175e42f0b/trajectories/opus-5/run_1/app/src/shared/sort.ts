import { compareValues, maxValue, minValue } from './compare';
import { invalidQuery } from './errors';
import { valuesAtPath } from './paths';
import { DocObject, DocValue, isPlainObject } from './values';

export interface SortKey {
  path: string;
  direction: 1 | -1;
}

/** Checks a sort, throwing `invalid_query` with field `sort`. */
export function validateSort(sort: DocValue): SortKey[] {
  if (sort === null) return [];
  if (!isPlainObject(sort)) throw invalidQuery('sort');
  const keys: SortKey[] = [];
  for (const path of Object.keys(sort)) {
    const direction = sort[path];
    if (direction !== 1 && direction !== -1) throw invalidQuery('sort');
    keys.push({ path, direction });
  }
  return keys;
}

/** The value a sort key uses: missing as null, arrays by their smallest or largest element. */
export function sortKeyValue(doc: DocObject, key: SortKey): DocValue {
  const values = valuesAtPath(doc, key.path);
  if (values.length === 0) return null;
  const reduced = values.map((value) => {
    if (!Array.isArray(value)) return value;
    if (value.length === 0) return null;
    return key.direction === 1 ? minValue(value) : maxValue(value);
  });
  return key.direction === 1 ? minValue(reduced) : maxValue(reduced);
}

function documentId(doc: DocObject): string {
  const id = doc['_id'];
  return typeof id === 'string' ? id : '';
}

/** Sorts documents by the keys in order, breaking ties by `_id` ascending. */
export function sortDocuments(docs: DocObject[], keys: SortKey[]): DocObject[] {
  const out = docs.slice();
  out.sort((left, right) => {
    for (const key of keys) {
      const order = compareValues(sortKeyValue(left, key), sortKeyValue(right, key));
      if (order !== 0) return key.direction === 1 ? order : -order;
    }
    const leftId = documentId(left);
    const rightId = documentId(right);
    return leftId === rightId ? 0 : leftId < rightId ? -1 : 1;
  });
  return out;
}

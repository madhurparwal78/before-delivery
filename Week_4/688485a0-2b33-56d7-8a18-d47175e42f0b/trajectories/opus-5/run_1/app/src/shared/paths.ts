import { DocObject, DocValue, isPlainObject } from './values';

/** The values a dot path reaches, descending into objects and through arrays of objects. */
export function valuesAtPath(doc: DocObject, path: string): DocValue[] {
  const segments = path.split('.');
  let current: DocValue[] = [doc];
  for (const segment of segments) {
    const next: DocValue[] = [];
    for (const value of current) {
      if (Array.isArray(value)) {
        const index = /^\d+$/.test(segment) ? Number(segment) : -1;
        if (index >= 0 && index < value.length) next.push(value[index]);
        for (const element of value) {
          if (isPlainObject(element) && Object.prototype.hasOwnProperty.call(element, segment)) {
            next.push(element[segment]);
          }
        }
      } else if (isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, segment)) {
        next.push(value[segment]);
      }
    }
    current = next;
    if (current.length === 0) return [];
  }
  return current;
}

/** The values a condition is matched against: the path's values and, one level down, array elements. */
export function matchCandidates(doc: DocObject, path: string): DocValue[] {
  const direct = valuesAtPath(doc, path);
  const candidates: DocValue[] = [];
  for (const value of direct) {
    candidates.push(value);
    if (Array.isArray(value)) {
      for (const element of value) candidates.push(element);
    }
  }
  return candidates;
}

/** Whether a path reaches any value at all, null included. */
export function pathExists(doc: DocObject, path: string): boolean {
  return valuesAtPath(doc, path).length > 0;
}

/** Whether a path reaches a value without passing through an array, for the validator. */
export function pathPresentWithoutArrays(doc: DocObject, path: string): boolean {
  const segments = path.split('.');
  let current: DocValue = doc;
  for (const segment of segments) {
    if (!isPlainObject(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return false;
    current = current[segment];
  }
  return true;
}

/** The value a path reaches without passing through an array, for the validator. */
export function valueWithoutArrays(doc: DocObject, path: string): DocValue | undefined {
  const segments = path.split('.');
  let current: DocValue = doc;
  for (const segment of segments) {
    if (!isPlainObject(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

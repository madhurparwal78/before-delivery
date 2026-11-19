import { compactJson } from './json';
import { DocDate, DocValue, isPlainObject } from './values';

/** The one type order: null < numbers < strings < objects < arrays < booleans < dates. */
function typeRank(value: DocValue): number {
  if (value === null) return 0;
  if (typeof value === 'number') return 1;
  if (typeof value === 'string') return 2;
  if (value instanceof DocDate) return 6;
  if (Array.isArray(value)) return 4;
  if (typeof value === 'boolean') return 5;
  return 3;
}

/** The one comparison order, used by sort, $min, $max, $group output and index ranges. */
export function compareValues(a: DocValue, b: DocValue): number {
  const rankA = typeRank(a);
  const rankB = typeRank(b);
  if (rankA !== rankB) return rankA < rankB ? -1 : 1;
  switch (rankA) {
    case 0:
      return 0;
    case 1: {
      const left = a as number;
      const right = b as number;
      return left === right ? 0 : left < right ? -1 : 1;
    }
    case 2: {
      const left = a as string;
      const right = b as string;
      return left === right ? 0 : left < right ? -1 : 1;
    }
    case 5: {
      const left = a as boolean;
      const right = b as boolean;
      return left === right ? 0 : left ? 1 : -1;
    }
    case 6: {
      const left = (a as DocDate).ms;
      const right = (b as DocDate).ms;
      return left === right ? 0 : left < right ? -1 : 1;
    }
    default: {
      const left = compactJson(a);
      const right = compactJson(b);
      return left === right ? 0 : left < right ? -1 : 1;
    }
  }
}

/** Filter equality: numbers by value, objects and arrays by compact text, dates by instant. */
export function valuesEqual(a: DocValue, b: DocValue): boolean {
  if (a instanceof DocDate || b instanceof DocDate) {
    return a instanceof DocDate && b instanceof DocDate && a.ms === b.ms;
  }
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (Array.isArray(a) || Array.isArray(b) || isPlainObject(a) || isPlainObject(b)) {
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    return compactJson(a) === compactJson(b);
  }
  return a === b;
}

/** One text per distinct value under filter equality: for group keys and unique index keys. */
export function canonicalKeyText(value: DocValue): string {
  if (value instanceof DocDate) return `D${value.ms}`;
  if (Array.isArray(value)) return `[${value.map(canonicalKeyText).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .map((key) => `${JSON.stringify(key)}:${canonicalKeyText(value[key])}`)
      .join(',')}}`;
  }
  return compactJson(value);
}

export function minValue(values: DocValue[]): DocValue {
  return values.reduce((best, value) => (compareValues(value, best) < 0 ? value : best));
}

export function maxValue(values: DocValue[]): DocValue {
  return values.reduce((best, value) => (compareValues(value, best) > 0 ? value : best));
}

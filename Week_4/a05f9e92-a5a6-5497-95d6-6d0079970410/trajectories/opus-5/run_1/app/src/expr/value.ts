/** Values the interpreter works with. Nothing here is ever executable. */

/** A date or time field's value, so a string compared with it reads as an instant. */
export class TimeValue {
  constructor(readonly ms: number) {}
}

export type Value = null | boolean | number | string | TimeValue | readonly Value[];

export const unknownPath = Symbol('unknown path');

export type Lookup = Value | typeof unknownPath;

export function isList(v: Value): v is readonly Value[] {
  return Array.isArray(v);
}

/** Reads a string as an ISO instant, for comparison with a date or time field. */
export function asInstant(v: Value): number | null {
  if (v instanceof TimeValue) return v.ms;
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

export function isEmptyValue(v: Value): boolean {
  if (v === null) return true;
  if (typeof v === 'string') return v.length === 0;
  if (isList(v)) return v.length === 0;
  return false;
}

export function sameValue(a: Value, b: Value): boolean {
  if (a instanceof TimeValue || b instanceof TimeValue) {
    const x = asInstant(a);
    const y = asInstant(b);
    return x !== null && y !== null && x === y;
  }
  if (a === null || b === null) return a === null && b === null;
  if (isList(a) && isList(b)) return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  if (isList(a) || isList(b)) return false;
  if (typeof a !== typeof b) return false;
  return a === b;
}

export function valueToText(v: Value): string {
  if (v === null) return '';
  if (v instanceof TimeValue) return new Date(v.ms).toISOString();
  if (isList(v)) return v.map(valueToText).join(', ');
  return String(v);
}

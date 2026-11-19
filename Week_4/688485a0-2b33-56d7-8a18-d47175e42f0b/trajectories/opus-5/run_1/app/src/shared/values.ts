/** Document values: string, number, boolean, null, object, array and date. */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{3})?Z$/;

export class DocDate {
  readonly ms: number;
  readonly withMillis: boolean;

  constructor(ms: number, withMillis: boolean) {
    this.ms = ms;
    this.withMillis = withMillis;
  }

  /** The exact `$date` text: milliseconds are kept only when they were stored. */
  text(): string {
    const iso = new Date(this.ms).toISOString();
    return this.withMillis ? iso.slice(0, 23) + 'Z' : iso.slice(0, 19) + 'Z';
  }
}

export type DocValue = string | number | boolean | null | DocDate | DocValue[] | DocObject;
export interface DocObject {
  [key: string]: DocValue;
}

export function parseDateText(text: string): DocDate | null {
  const m = DATE_RE.exec(text);
  if (!m) return null;
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) return null;
  const iso = new Date(ms).toISOString();
  const normalized = m[7] ? iso.slice(0, 23) + 'Z' : iso.slice(0, 19) + 'Z';
  if (normalized !== text) return null;
  return new DocDate(ms, m[7] !== undefined);
}

/** A `{"$date":"..."}` wrapper, when the value is exactly that. */
export function asDateWrapper(value: unknown): DocDate | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== '$date') return null;
  const inner = (value as Record<string, unknown>)['$date'];
  if (typeof inner !== 'string') return null;
  return parseDateText(inner);
}

export function isPlainObject(value: DocValue): value is DocObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof DocDate);
}

export type TypeName = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' | 'date';

export function valueType(value: DocValue): TypeName {
  if (value === null) return 'null';
  if (value instanceof DocDate) return 'date';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'object';
  }
}

/** Turns parsed JSON into document values, converting `{"$date":"..."}` wrappers. */
export function fromJson(value: unknown): DocValue {
  const date = asDateWrapper(value);
  if (date) return date;
  if (Array.isArray(value)) return value.map(fromJson);
  if (value !== null && typeof value === 'object') {
    const out: DocObject = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) out[key] = fromJson(inner);
    return out;
  }
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' || value === null) {
    return value;
  }
  return null;
}

/** Turns document values back into plain JSON-ready values. */
export function toJson(value: DocValue): unknown {
  if (value instanceof DocDate) return { $date: value.text() };
  if (Array.isArray(value)) return value.map(toJson);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) out[key] = toJson(value[key]);
    return out;
  }
  return value;
}

export function cloneValue(value: DocValue): DocValue {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isPlainObject(value)) {
    const out: DocObject = {};
    for (const key of Object.keys(value)) out[key] = cloneValue(value[key]);
    return out;
  }
  return value;
}

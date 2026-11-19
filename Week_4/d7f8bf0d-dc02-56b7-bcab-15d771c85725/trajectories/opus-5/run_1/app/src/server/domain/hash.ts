import { createHash, randomUUID } from 'node:crypto';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** JSON with object keys sorted, no whitespace and non-ASCII characters left unescaped. */
export function canonicalJson(value: unknown): string {
  return serialise(value as Json);
}

function serialise(value: Json): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(serialise).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const parts = keys
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${serialise(value[key] as Json)}`);
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

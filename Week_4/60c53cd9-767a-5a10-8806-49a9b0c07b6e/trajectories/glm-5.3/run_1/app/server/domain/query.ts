import { decode } from 'node:querystring';

export type QueryValue = string | string[];
export type QueryBag = Record<string, QueryValue | undefined>;

export function parseQuery(search: string): QueryBag {
  const out: QueryBag = {};
  if (!search || search === '?') return out;
  const pairs = search.startsWith('?') ? search.slice(1) : search;
  for (const part of pairs.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const rawKey = eq === -1 ? part : part.slice(0, eq);
    const rawVal = eq === -1 ? '' : part.slice(eq + 1);
    let key: string;
    let value: string;
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      value = decodeURIComponent(rawVal.replace(/\+/g, ' '));
    } catch {
      key = rawKey;
      value = rawVal;
    }
    const existing = out[key];
    if (existing === undefined) out[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else out[key] = [existing, value];
  }
  return out;
}

export function queryValues(bag: QueryBag, key: string): string[] {
  const v = bag[key];
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export function queryFirst(bag: QueryBag, key: string): string | undefined {
  const v = bag[key];
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

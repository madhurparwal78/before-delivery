import { type Db, one } from './db.js';
import { invalid, isMissing, labelFor, notFound } from './errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

export type Body = Record<string, unknown>;

/** A string field: required, trimmed, within bounds. */
export function text(body: Body, key: string, opts: { max?: number; label?: string; keepWhitespace?: boolean } = {}): string {
  const label = opts.label ?? labelFor(key);
  const raw = body[key];
  if (isMissing(raw)) throw invalid(key, label, true);
  if (typeof raw !== 'string') throw invalid(key, label);
  const value = opts.keepWhitespace ? raw : raw.trim();
  if (opts.max !== undefined && [...value].length > opts.max) throw invalid(key, label);
  return value;
}

/** A whole number field within bounds. */
export function whole(body: Body, key: string, min: number, max: number, label = labelFor(key)): number {
  const raw = body[key];
  if (raw === undefined || raw === null) throw invalid(key, label, true);
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) throw invalid(key, label);
  return raw;
}

export function oneOf<T extends string>(body: Body, key: string, allowed: readonly T[], label = labelFor(key)): T {
  const raw = body[key];
  if (isMissing(raw)) throw invalid(key, label, true);
  if (typeof raw !== 'string' || !allowed.includes(raw as T)) throw invalid(key, label);
  return raw as T;
}

/** A referenced id in a request body: absent is left to validation; present but unknown is 404. */
export async function ref<T>(body: Body, key: string, load: (id: string) => Promise<T | undefined>): Promise<T | undefined> {
  const value = body[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (!isId(value)) throw notFound();
  const found = await load(value);
  if (!found) throw notFound();
  return found;
}

export async function loadIn<T>(db: Db, sql: string, id: string, clinicId: string): Promise<T> {
  if (!isId(id)) throw notFound();
  const row = await one<T>(db, sql, [id, clinicId]);
  if (!row) throw notFound();
  return row;
}


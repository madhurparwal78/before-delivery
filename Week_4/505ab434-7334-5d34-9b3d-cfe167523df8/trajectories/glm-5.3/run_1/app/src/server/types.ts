import type { PoolClient } from 'pg';

export type Session = { id: string; email: string; displayName: string; role: string; organisationId: string | null };

export type DbRow = Record<string, unknown>;

export function rowToValue<T>(row: DbRow | undefined, key: string): T {
  if (!row) throw new Error(`missing row for ${key}`);
  return row[key] as T;
}

export type Tx = PoolClient;

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

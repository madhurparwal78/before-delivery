import { query } from '../db/pool';
import { filterFingerprint, mintCursor, readCursor, readLimit } from '../domain/cursor';
import type { Ctx } from './types';

/**
 * Every collection answers one shape, pages newest first by opaque cursor, and
 * binds each cursor to the filter that produced it.
 */

export interface Page<T> {
  readonly items: readonly T[];
  readonly next_cursor: string | null;
  readonly total: number;
}

/**
 * A list's order: its ordering instant, where it has one, and its tie-break id
 * expression, which must yield text that sorts the way the ids compare.
 */
export interface ListOrder {
  readonly at: string | null;
  readonly id: string;
}

export interface CursorClause {
  readonly where: string;
  readonly values: readonly unknown[];
  readonly limit: number;
  readonly filter: string;
}

export function pageClause(
  ctx: Ctx,
  filter: Readonly<Record<string, string | null | undefined>>,
  order: ListOrder,
  firstPlaceholder: number,
): CursorClause {
  const fingerprint = filterFingerprint(filter);
  const limit = readLimit(ctx.query.get('limit'));
  const cursor = ctx.query.get('cursor');
  if (cursor === null || cursor === '') {
    return { where: '', values: [], limit, filter: fingerprint };
  }
  const position = readCursor(cursor, fingerprint);
  if (order.at === null) {
    return {
      where: ` AND ${order.id} < $${firstPlaceholder}`,
      values: [position.id],
      limit,
      filter: fingerprint,
    };
  }
  return {
    where: ` AND (${order.at}, ${order.id}) < ($${firstPlaceholder}::timestamptz, $${firstPlaceholder + 1})`,
    values: [position.at, position.id],
    limit,
    filter: fingerprint,
  };
}

export interface PagedQuery<Row> {
  readonly sql: string;
  readonly values: readonly unknown[];
  readonly countSql: string;
  readonly countValues: readonly unknown[];
  readonly position: (row: Row) => { at: string; id: string };
}

export async function answerPage<Row, Item>(
  clause: CursorClause,
  select: PagedQuery<Row>,
  shape: (row: Row) => Item | Promise<Item>,
): Promise<Page<Item>> {
  const rows = await query<Row & Record<string, unknown>>(select.sql, select.values);
  const counted = await query<{ n: string }>(select.countSql, select.countValues);
  const page = rows.slice(0, clause.limit);
  const items: Item[] = [];
  for (const row of page) items.push(await shape(row as Row));
  const last = page[page.length - 1];
  const more = rows.length > clause.limit;
  return {
    items,
    next_cursor: more && last !== undefined ? mintCursor(clause.filter, select.position(last as Row)) : null,
    total: Number(counted[0]?.n ?? '0'),
  };
}

/**
 * Ids that end in a number compare by that number, and integer ids compare
 * numerically. Both are padded so one keyset comparison serves every list.
 */
export function numericIdSql(column: string): string {
  return `lpad(coalesce(code_number(${column}), 0)::text, 18, '0')`;
}

export function integerIdSql(column: string): string {
  return `lpad(${column}::text, 18, '0')`;
}

export function padNumber(value: number | string): string {
  const match = /(\d+)$/.exec(String(value));
  return (match ? (match[1] as string) : '0').padStart(18, '0');
}

/** A whole-set page for the collections the endpoint table orders by code. */
export async function answerWholeList<Row, Item>(
  sql: string,
  values: readonly unknown[],
  shape: (row: Row) => Item | Promise<Item>,
): Promise<Page<Item>> {
  const rows = await query<Row & Record<string, unknown>>(sql, values);
  const items: Item[] = [];
  for (const row of rows) items.push(await shape(row as Row));
  return { items, next_cursor: null, total: items.length };
}

import { validation } from './errors.js';
import type { FeedSort } from '../shared/types.js';

export const PAGE_SIZE = 25;

export const FEED_SORTS: readonly FeedSort[] = ['hot', 'new', 'top'];

export function parseFeedSort(raw: string | null): FeedSort {
  if (raw === null) return 'hot';
  if ((FEED_SORTS as readonly string[]).includes(raw)) return raw as FeedSort;
  throw validation({ sort: 'This sort is not valid' });
}

export interface FeedPosition { key: string; id: string }

/** The opaque feed cursor: base64url (no padding) of `<sort>|<sort key>|<id>` for the last row. */
export function encodeFeedCursor(sort: FeedSort, key: string, id: string): string {
  return Buffer.from(`${sort}|${key}|${id}`).toString('base64url');
}

export function decodeFeedCursor(sort: FeedSort, cursor: string | null): FeedPosition | null {
  if (cursor === null) return null;
  const invalid = validation({ cursor: 'This cursor is not valid' });
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalid;
  const parts = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const [cursorSort, key, id] = parts;
  if (parts.length !== 3 || cursorSort !== sort || !key || !id || !/^\d+$/.test(id)) throw invalid;
  const keyValid =
    sort === 'top' ? /^-?\d+$/.test(key)
    : sort === 'hot' ? Number.isFinite(Number(key))
    : !Number.isNaN(Date.parse(key));
  if (!keyValid) throw invalid;
  return { key, id };
}

/** Cursors for lists that page by one numeric id (mod log). */
export const encodeIdCursor = (id: string): string => Buffer.from(id).toString('base64url');

export function decodeIdCursor(cursor: string | null): string | null {
  if (cursor === null) return null;
  const id = /^[A-Za-z0-9_-]+$/.test(cursor) ? Buffer.from(cursor, 'base64url').toString('utf8') : '';
  if (!/^\d+$/.test(id)) throw validation({ cursor: 'This cursor is not valid' });
  return id;
}

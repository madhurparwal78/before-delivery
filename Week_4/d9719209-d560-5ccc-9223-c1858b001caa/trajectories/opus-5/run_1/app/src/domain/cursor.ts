import { copy } from '../shared/copy.js';
import { errors } from '../core/errors.js';

export type FeedSort = 'hot' | 'new' | 'top';

export interface Cursor {
  sort: FeedSort;
  key: string;
  id: string;
}

export function encodeCursor(sort: FeedSort, key: string, id: string): string {
  return Buffer.from(`${sort}|${key}|${id}`, 'utf8').toString('base64url');
}

/** A cursor whose sort differs from the request, or that does not decode, is refused. */
export function decodeCursor(raw: string | null, sort: FeedSort): Cursor | null {
  if (raw === null || raw === '') return null;
  const invalid = () => errors.validation(copy.validation.cursor, { cursor: copy.validation.cursor });
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw invalid();
  }
  const parts = decoded.split('|');
  if (parts.length !== 3) throw invalid();
  const [cursorSort, key, id] = parts;
  if (cursorSort !== sort) throw invalid();
  if (!/^\d+$/.test(id) || key === '') throw invalid();
  return { sort, key, id };
}

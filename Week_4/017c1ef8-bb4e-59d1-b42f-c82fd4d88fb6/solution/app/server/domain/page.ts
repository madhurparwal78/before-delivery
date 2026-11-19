import { validation } from '../errors.js';

export interface Page<T> {
  total: number;
  results: T[];
  next_cursor: string | null;
}

export const SEARCH_PAGE_SIZE = 20;

/** Cursors are opaque: a JSON payload in base64url. An unreadable cursor is the published 422. */
export function encodeCursor(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor<T>(cursor: string): T {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    throw validation({ cursor: 'This cursor is not valid.' });
  }
}

/** A keyset cursor over (time, id): the last entry of a page. */
export function encodeKeyset(at: Date, id: string): string {
  return encodeCursor([at.toISOString(), id]);
}

export function decodeKeyset(cursor: string): { at: Date; id: string } {
  const payload = decodeCursor<unknown>(cursor);
  if (!Array.isArray(payload) || typeof payload[0] !== 'string' || typeof payload[1] !== 'string') {
    throw validation({ cursor: 'This cursor is not valid.' });
  }
  const at = new Date(payload[0]);
  if (Number.isNaN(at.getTime())) throw validation({ cursor: 'This cursor is not valid.' });
  return { at, id: payload[1] };
}

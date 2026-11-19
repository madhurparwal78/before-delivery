import { PAGE_DEFAULT_LIMIT, PAGE_MAX_LIMIT } from '../shared/terms';
import { ApiError } from './errors';

export interface CursorRef {
  /** the sort value (ISO instant) of the last returned item */
  s: string;
  /** the item id used for tie-breaking */
  i: string;
}

/**
 * Cursors are opaque base64url JSON. They carry the sort instant and id of the
 * last returned item so paging never repeats or skips items while messages are
 * added or deleted elsewhere (DP-20).
 */
export function encodeCursor(ref: CursorRef): string {
  return Buffer.from(JSON.stringify(ref), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string | undefined): CursorRef | null {
  if (raw === undefined || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const ref = parsed as Record<string, unknown>;
  if (typeof ref.s !== 'string' || typeof ref.i !== 'string') return null;
  if (Number.isNaN(Date.parse(ref.s)) || !/^[0-9a-f-]{36}$/.test(ref.i)) return null;
  return { s: ref.s, i: ref.i };
}

export function parsePaging(query: Record<string, string | undefined>): { limit: number; cursor: CursorRef | null } {
  const limitRaw = query.limit;
  let limit = PAGE_DEFAULT_LIMIT;
  if (limitRaw !== undefined && limitRaw !== '') {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n < 1) {
      throw new ApiError('validation', undefined, { limit: 'Use a whole number of 1 or more.' });
    }
    limit = Math.min(n, PAGE_MAX_LIMIT);
  }
  let cursor: CursorRef | null = null;
  if (query.before !== undefined && query.before !== '') {
    cursor = decodeCursor(query.before);
    if (!cursor) throw new ApiError('validation', undefined, { before: 'That page link is no longer valid.' });
  }
  return { limit, cursor };
}

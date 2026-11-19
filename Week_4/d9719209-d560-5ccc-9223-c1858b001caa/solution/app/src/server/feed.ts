import type { Db } from './db.js';
import { one } from './db.js';
import { PAGE_SIZE, decodeFeedCursor, encodeFeedCursor, parseFeedSort } from './cursor.js';
import { loadPosts } from './views.js';
import type { SessionUser } from './accounts.js';
import type { FeedSort, PostView } from '../shared/types.js';

const ORDER: Record<FeedSort, string> = {
  hot: 'p.hot_rank DESC, p.id DESC',
  new: 'p.created_at DESC, p.id DESC',
  top: 'p.score DESC, p.id DESC',
};

const AFTER: Record<FeedSort, (key: string, id: string) => string> = {
  hot: (key, id) => `(p.hot_rank, p.id) < (${key}::float8, ${id}::bigint)`,
  new: (key, id) => `(p.created_at, p.id) < (${key}::timestamptz, ${id}::bigint)`,
  top: (key, id) => `(p.score, p.id) < (${key}::int, ${id}::bigint)`,
};

/** The sort key of a row as it is written into a cursor. */
const CURSOR_KEY = `CASE $2 WHEN 'hot' THEN hot_rank::text
  WHEN 'new' THEN to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE score::text END`;

export interface FeedPage { items: PostView[]; nextCursor: string | null }

/**
 * One page of published posts in a published sort order, ties broken by id descending, behind an opaque cursor.
 * `where` restricts the feed and may use $4 and up for `params`.
 */
export async function feedPage(
  db: Db, viewer: SessionUser | null, sortParam: string | null, cursorParam: string | null, where: string, params: unknown[],
): Promise<FeedPage> {
  const sort: FeedSort = parseFeedSort(sortParam);
  const position = decodeFeedCursor(sort, cursorParam);
  const filters = ["p.state = 'published'", `(${where})`];
  const values = [...params];
  if (position) {
    const first = 4 + values.length;
    filters.push(AFTER[sort](`$${first}`, `$${first + 1}`));
    values.push(position.key, position.id);
  }
  const found = await loadPosts(db, viewer, filters.join(' AND '), values, `ORDER BY ${ORDER[sort]} LIMIT ${PAGE_SIZE + 1}`);
  const items = found.slice(0, PAGE_SIZE);
  const last = items[PAGE_SIZE - 1];
  if (found.length <= PAGE_SIZE || !last) return { items, nextCursor: null };
  const row = await one<{ key: string }>(db, `SELECT ${CURSOR_KEY} AS key FROM posts WHERE id = $1`, [last.id, sort]);
  return { items, nextCursor: encodeFeedCursor(sort, (row as { key: string }).key, last.id) };
}

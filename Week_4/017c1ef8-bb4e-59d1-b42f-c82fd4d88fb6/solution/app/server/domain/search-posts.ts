import { oneRow, rows, type Db } from '../db.js';
import { decodeKeyset, encodeKeyset, SEARCH_PAGE_SIZE, type Page } from './page.js';
import { postObjects, type PostObject } from './posts.js';
import { escapeRegex } from './text.js';
import { memberVisibleTo } from './visibility.js';

/**
 * Posts whose text has a word starting with every word of the query, newest first. An empty query matches nothing.
 * Blocked members, private non-connections and deleted posts never appear.
 */
export async function searchPosts(db: Db, viewerId: string, query: string, cursor: string | null): Promise<Page<PostObject>> {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return { total: 0, results: [], next_cursor: null };
  const patterns = words.map((word) => `\\m${escapeRegex(word)}`);
  const matching = `FROM posts p JOIN members m ON m.id = p.author_id
                     WHERE ${memberVisibleTo('$1', 'm')}
                       AND NOT EXISTS (SELECT 1 FROM unnest($2::text[]) AS pattern WHERE lower(p.text) !~ pattern)`;
  const { total } = await oneRow<{ total: number }>(db, `SELECT count(*) AS total ${matching}`, [viewerId, patterns]);
  const before = cursor ? decodeKeyset(cursor) : null;
  const found = await rows<{ id: string; created_at: Date }>(
    db,
    `SELECT p.id, p.created_at ${matching}
        AND ($3::timestamptz IS NULL OR (p.created_at, p.id) < ($3::timestamptz, $4::text))
      ORDER BY p.created_at DESC, p.id DESC LIMIT $5`,
    [viewerId, patterns, before?.at ?? null, before?.id ?? null, SEARCH_PAGE_SIZE + 1],
  );
  const page = found.slice(0, SEARCH_PAGE_SIZE);
  const objects = await postObjects(db, viewerId, page.map((post) => post.id));
  const last = page[page.length - 1];
  return {
    total,
    results: page.flatMap((post) => objects.get(post.id) ?? []),
    next_cursor: found.length > SEARCH_PAGE_SIZE && last ? encodeKeyset(last.created_at, last.id) : null,
  };
}

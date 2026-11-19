import { now, weekStart } from '../clock.js';
import { config } from '../config.js';
import { oneRow, rows, type Db } from '../db.js';
import { decodeKeyset, encodeKeyset } from './page.js';
import { postObjects, type PostObject } from './posts.js';
import { memberVisibleTo } from './visibility.js';

interface HashtagPage {
  posts: PostObject[];
  next_cursor: string | null;
  stats: { posts: number; members: number };
}

/** The posts carrying a hashtag (ignoring case), newest first, with the post and member counts the page states. */
export async function hashtagPage(db: Db, viewerId: string, tag: string, cursor: string | null): Promise<HashtagPage> {
  const lower = tag.toLowerCase();
  const since = weekStart(now());
  const carrying = `FROM post_hashtags h JOIN posts p ON p.id = h.post_id JOIN members m ON m.id = p.author_id
                     WHERE h.tag = $2 AND ${memberVisibleTo('$1', 'm')}`;
  const stats = await oneRow<{ posts: number; members: number }>(
    db,
    `SELECT count(*) AS posts, count(DISTINCT p.author_id) FILTER (WHERE p.created_at > $3) AS members ${carrying}`,
    [viewerId, lower, since],
  );
  const before = cursor ? decodeKeyset(cursor) : null;
  const size = config.feedPageSize;
  const found = await rows<{ id: string; created_at: Date }>(
    db,
    `SELECT p.id, p.created_at ${carrying}
        AND ($3::timestamptz IS NULL OR (p.created_at, p.id) < ($3::timestamptz, $4::text))
      ORDER BY p.created_at DESC, p.id DESC LIMIT $5`,
    [viewerId, lower, before?.at ?? null, before?.id ?? null, size + 1],
  );
  const page = found.slice(0, size);
  const objects = await postObjects(db, viewerId, page.map((post) => post.id));
  const last = page[page.length - 1];
  return {
    posts: page.flatMap((post) => objects.get(post.id) ?? []),
    next_cursor: found.length > size && last ? encodeKeyset(last.created_at, last.id) : null,
    stats,
  };
}

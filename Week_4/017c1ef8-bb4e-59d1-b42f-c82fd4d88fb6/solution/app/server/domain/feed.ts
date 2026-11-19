import { config } from '../config.js';
import { rows, type Db } from '../db.js';
import { decodeKeyset, encodeKeyset } from './page.js';
import { postObjects, type PostObject } from './posts.js';
import { connectedWith, memberVisibleTo } from './visibility.js';

interface FeedEntry {
  entry_id: string;
  kind: 'post' | 'repost';
  created_at: Date;
  post: PostObject;
  reposter: { id: string; name: string; handle: string } | null;
}

interface FeedPage {
  entries: FeedEntry[];
  next_cursor: string | null;
  top_cursor: string;
}

interface EntryRow {
  entry_id: string;
  kind: 'post' | 'repost';
  created_at: Date;
  post_id: string;
  reposter_id: string | null;
  reposter_name: string | null;
  reposter_handle: string | null;
}

interface Keyset {
  at: Date;
  id: string;
}

/** The top cursor of an empty feed: before every entry. */
const BEFORE_EVERYTHING = encodeKeyset(new Date(0), '');

/** True for the viewer, their connections, and the members and the job posters of companies they follow. */
const eligible = (member: string): string =>
  `(${member} = $1 OR ${connectedWith('$1', member)}
     OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.target_id = ${member})
     OR EXISTS (SELECT 1 FROM jobs j JOIN follows f ON f.target_id = j.company_id AND f.follower_id = $1 WHERE j.poster_id = ${member}))`;

/**
 * The viewer's entries, newest first, one entry per original post (the newest of the post and its plain reposts),
 * older than `before` or newer than `after` when given.
 */
async function entryRows(db: Db, viewerId: string, limit: number, before?: Keyset, after?: Keyset): Promise<EntryRow[]> {
  const params: unknown[] = [viewerId, limit];
  const bounds: string[] = [];
  if (before) {
    params.push(before.at, before.id);
    bounds.push(`AND (r.created_at, r.entry_id) < ($${params.length - 1}::timestamptz, $${params.length}::text)`);
  }
  if (after) {
    params.push(after.at, after.id);
    bounds.push(`AND (r.created_at, r.entry_id) > ($${params.length - 1}::timestamptz, $${params.length}::text)`);
  }
  return rows<EntryRow>(
    db,
    `WITH entries AS (
       SELECT p.id AS entry_id, 'post' AS kind, p.created_at, p.id AS post_id, NULL::text AS reposter_id
         FROM posts p JOIN members am ON am.id = p.author_id
        WHERE ${eligible('p.author_id')} AND ${memberVisibleTo('$1', 'am')}
       UNION ALL
       SELECT rp.id, 'repost', rp.created_at, rp.post_id, rp.member_id
         FROM reposts rp JOIN posts p ON p.id = rp.post_id
         JOIN members am ON am.id = p.author_id JOIN members rm ON rm.id = rp.member_id
        WHERE ${eligible('rp.member_id')} AND ${memberVisibleTo('$1', 'am')} AND ${memberVisibleTo('$1', 'rm')}
     ), ranked AS (
       SELECT e.*, row_number() OVER (PARTITION BY e.post_id ORDER BY e.created_at DESC, e.entry_id DESC) AS rank FROM entries e
     )
     SELECT r.entry_id, r.kind, r.created_at, r.post_id, r.reposter_id, rm.name AS reposter_name, rm.handle AS reposter_handle
       FROM ranked r LEFT JOIN members rm ON rm.id = r.reposter_id
      WHERE r.rank = 1 ${bounds.join(' ')}
      ORDER BY r.created_at DESC, r.entry_id DESC
      LIMIT $2`,
    params,
  );
}

async function entriesOf(db: Db, viewerId: string, found: EntryRow[]): Promise<FeedEntry[]> {
  const posts = await postObjects(db, viewerId, found.map((entry) => entry.post_id));
  return found.flatMap((entry) => {
    const post = posts.get(entry.post_id);
    if (!post) return [];
    const reposter = entry.reposter_id && entry.reposter_name && entry.reposter_handle ? { id: entry.reposter_id, name: entry.reposter_name, handle: entry.reposter_handle } : null;
    return [{ entry_id: entry.entry_id, kind: entry.kind, created_at: entry.created_at, post, reposter }];
  });
}

const cursorOf = (entry: EntryRow): string => encodeKeyset(entry.created_at, entry.entry_id);

/** One page of the home feed, stable under arrivals and deletions: the cursor is the last entry's time and id. */
export async function feedPage(db: Db, viewerId: string, cursor: string | null): Promise<FeedPage> {
  const size = config.feedPageSize;
  const found = await entryRows(db, viewerId, size + 1, cursor ? decodeKeyset(cursor) : undefined);
  const page = found.slice(0, size);
  const top = cursor ? (await entryRows(db, viewerId, 1))[0] : page[0];
  const last = page[page.length - 1];
  return {
    entries: await entriesOf(db, viewerId, page),
    next_cursor: found.length > size && last ? cursorOf(last) : null,
    top_cursor: top ? cursorOf(top) : BEFORE_EVERYTHING,
  };
}


/** Entries that arrived after a top cursor, newest first, at most 50. */
export async function entriesNewerThan(db: Db, viewerId: string, topCursor: string): Promise<{ entries: FeedEntry[]; top_cursor: string }> {
  const found = await entryRows(db, viewerId, config.newerEntriesLimit, undefined, decodeKeyset(topCursor));
  const newest = found[0];
  return { entries: await entriesOf(db, viewerId, found), top_cursor: newest ? cursorOf(newest) : topCursor };
}

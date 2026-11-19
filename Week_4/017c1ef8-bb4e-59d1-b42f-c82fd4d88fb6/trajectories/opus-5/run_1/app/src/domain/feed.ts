import { query } from '../server/db';
import { blockedWith, degreeBetween } from './graph';
import { firstDegreeSet } from './members';
import { POST_COLUMNS, postObject, type PostRow } from './posts';

export type FeedEntry = {
  entry_id: string;
  kind: 'post' | 'repost';
  created_at: string;
  post: Record<string, unknown>;
  reposter: { id: string; name: string; handle: string } | null;
};

type RawEntry = {
  entryId: string;
  kind: 'post' | 'repost';
  createdAt: Date;
  post: PostRow;
  reposterId: string | null;
};

export function encodeCursor(createdAt: string, entryId: string): string {
  return Buffer.from(`${createdAt}|${entryId}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; entryId: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const split = raw.lastIndexOf('|');
    if (split === -1) return null;
    const createdAt = new Date(raw.slice(0, split));
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, entryId: raw.slice(split + 1) };
  } catch {
    return null;
  }
}

function newer(a: { createdAt: Date; entryId: string }, b: { createdAt: Date; entryId: string }): number {
  const byTime = b.createdAt.getTime() - a.createdAt.getTime();
  if (byTime !== 0) return byTime;
  return a.entryId < b.entryId ? 1 : a.entryId > b.entryId ? -1 : 0;
}

/** The viewer, their connections, and the members and companies they follow. */
async function feedAuthors(viewerId: string): Promise<Set<string>> {
  const authors = new Set<string>([viewerId]);
  for (const id of await firstDegreeSet(viewerId)) authors.add(id);
  const follows = await query<{ target_id: string }>(
    'SELECT target_id FROM follows WHERE follower_id = $1',
    [viewerId],
  );
  const targets = follows.map((row) => row.target_id);
  if (targets.length > 0) {
    const members = await query<{ id: string }>('SELECT id FROM members WHERE id = ANY($1)', [
      targets,
    ]);
    for (const row of members) authors.add(row.id);
    const posters = await query<{ poster_id: string }>(
      'SELECT DISTINCT poster_id FROM jobs WHERE company_id = ANY($1)',
      [targets],
    );
    for (const row of posters) authors.add(row.poster_id);
  }
  return authors;
}

async function rawEntries(viewerId: string): Promise<RawEntry[]> {
  const authors = [...(await feedAuthors(viewerId))];
  const excluded = await blockedWith(viewerId);
  const visibleAuthors = authors.filter((id) => !excluded.has(id));

  const posts = await query<PostRow>(
    `SELECT ${POST_COLUMNS} FROM posts WHERE author_id = ANY($1) AND deleted_at IS NULL`,
    [visibleAuthors],
  );
  const reposts = await query<{ id: string; member_id: string; post_id: string; created_at: Date }>(
    `SELECT id, member_id, post_id, created_at FROM reposts WHERE member_id = ANY($1)`,
    [visibleAuthors],
  );

  const privateBlocked = new Set<string>();
  const authorIds = new Set(posts.map((post) => post.author_id));
  for (const repost of reposts) {
    const row = await query<{ author_id: string }>(
      'SELECT author_id FROM posts WHERE id = $1 AND deleted_at IS NULL',
      [repost.post_id],
    );
    if (row[0]) authorIds.add(row[0].author_id);
  }
  if (authorIds.size > 0) {
    const privates = await query<{ id: string }>(
      `SELECT id FROM members WHERE id = ANY($1) AND visibility = 'private'`,
      [[...authorIds]],
    );
    for (const row of privates) {
      if (row.id === viewerId) continue;
      if ((await degreeBetween(viewerId, row.id)) !== '1') privateBlocked.add(row.id);
    }
  }

  const entries: RawEntry[] = [];
  for (const post of posts) {
    if (privateBlocked.has(post.author_id)) continue;
    entries.push({
      entryId: post.id,
      kind: 'post',
      createdAt: post.created_at,
      post,
      reposterId: null,
    });
  }
  for (const repost of reposts) {
    const original = await query<PostRow>(
      `SELECT ${POST_COLUMNS} FROM posts WHERE id = $1 AND deleted_at IS NULL`,
      [repost.post_id],
    );
    const post = original[0];
    if (!post) continue;
    if (excluded.has(post.author_id) || privateBlocked.has(post.author_id)) continue;
    entries.push({
      entryId: repost.id,
      kind: 'repost',
      createdAt: repost.created_at,
      post,
      reposterId: repost.member_id,
    });
  }

  /* One entry per original post: the newest eligible of the post and its plain reposts. */
  const byOriginal = new Map<string, RawEntry>();
  for (const entry of entries) {
    const key = entry.post.id;
    const held = byOriginal.get(key);
    if (!held || newer(entry, held) < 0) byOriginal.set(key, entry);
  }
  const deduped = [...byOriginal.values()];
  deduped.sort(newer);
  return deduped;
}

async function toEntries(viewerId: string, raw: RawEntry[]): Promise<FeedEntry[]> {
  const out: FeedEntry[] = [];
  for (const entry of raw) {
    let reposter: { id: string; name: string; handle: string } | null = null;
    if (entry.reposterId) {
      const rows = await query<{ id: string; name: string; handle: string }>(
        'SELECT id, name, handle FROM members WHERE id = $1',
        [entry.reposterId],
      );
      reposter = rows[0] ?? null;
    }
    out.push({
      entry_id: entry.entryId,
      kind: entry.kind,
      created_at: entry.createdAt.toISOString(),
      post: await postObject(viewerId, entry.post),
      reposter,
    });
  }
  return out;
}

export async function feedPage(
  viewerId: string,
  pageSize: number,
  cursor: { createdAt: Date; entryId: string } | null,
): Promise<{ entries: FeedEntry[]; next_cursor: string | null; top_cursor: string }> {
  const raw = await rawEntries(viewerId);
  const top = raw[0];
  const topCursor = top ? encodeCursor(top.createdAt.toISOString(), top.entryId) : encodeCursor(new Date(0).toISOString(), '');
  const after = cursor ? raw.filter((entry) => newer(entry, cursor) > 0) : raw;
  const page = after.slice(0, pageSize);
  const last = page[page.length - 1];
  const hasMore = after.length > page.length;
  return {
    entries: await toEntries(viewerId, page),
    next_cursor: hasMore && last ? encodeCursor(last.createdAt.toISOString(), last.entryId) : null,
    top_cursor: topCursor,
  };
}

export async function feedNewerThan(
  viewerId: string,
  cursor: { createdAt: Date; entryId: string },
): Promise<{ entries: FeedEntry[]; top_cursor: string }> {
  const raw = await rawEntries(viewerId);
  const top = raw[0];
  const topCursor = top
    ? encodeCursor(top.createdAt.toISOString(), top.entryId)
    : encodeCursor(cursor.createdAt.toISOString(), cursor.entryId);
  const fresh = raw.filter((entry) => newer(entry, cursor) < 0).slice(0, 50);
  return { entries: await toEntries(viewerId, fresh), top_cursor: topCursor };
}

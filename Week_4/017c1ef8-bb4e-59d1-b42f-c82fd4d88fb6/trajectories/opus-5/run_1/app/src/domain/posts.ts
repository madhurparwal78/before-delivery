import { businessNow } from '../server/clock';
import { config } from '../server/config';
import { query } from '../server/db';
import { REACTION_TYPES, type ReactionType } from '../shared/format';
import { hashtagsOf, mentionHandles } from '../shared/richtext';
import { blockedWith, degreeBetween, type Degree } from './graph';
import { firstDegreeSet, photoUrl } from './members';

export type PostRow = {
  id: string;
  author_id: string;
  text: string;
  created_at: Date;
  edited_at: Date | null;
  photo_id: string | null;
  shared_post_id: string | null;
  deleted_at: Date | null;
};

export const POST_COLUMNS =
  'id, author_id, text, created_at, edited_at, photo_id, shared_post_id, deleted_at';

export type ReactionSummary = {
  count: number;
  mine: ReactionType | null;
  top_types: ReactionType[];
  text: string;
};

export async function postById(id: string): Promise<PostRow | null> {
  const rows = await query<PostRow>(`SELECT ${POST_COLUMNS} FROM posts WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/** A post is visible unless a block exists either way, or its author is private to the viewer. */
export async function postVisibleTo(viewerId: string, post: PostRow): Promise<boolean> {
  if (post.deleted_at) return false;
  if (post.author_id === viewerId) return true;
  const excluded = await blockedWith(viewerId);
  if (excluded.has(post.author_id)) return false;
  const rows = await query<{ visibility: string }>('SELECT visibility FROM members WHERE id = $1', [
    post.author_id,
  ]);
  if (rows[0]?.visibility !== 'private') return true;
  return (await degreeBetween(viewerId, post.author_id)) === '1';
}

export async function reactionSummary(viewerId: string, postId: string): Promise<ReactionSummary> {
  const rows = await query<{ member_id: string; type: string; created_at: Date; name: string }>(
    `SELECT r.member_id, r.type, r.created_at, m.name
     FROM reactions r JOIN members m ON m.id = r.member_id WHERE r.post_id = $1`,
    [postId],
  );
  const excluded = await blockedWith(viewerId);
  const live = rows.filter((row) => !excluded.has(row.member_id));
  const count = live.length;
  const mineRow = live.find((row) => row.member_id === viewerId);
  const mine = (mineRow?.type ?? null) as ReactionType | null;

  const tally = new Map<string, number>();
  for (const row of live) tally.set(row.type, (tally.get(row.type) ?? 0) + 1);
  const top = [...tally.entries()]
    .sort((a, b) => {
      if (a[1] !== b[1]) return b[1] - a[1];
      return REACTION_TYPES.indexOf(a[0] as ReactionType) - REACTION_TYPES.indexOf(b[0] as ReactionType);
    })
    .slice(0, 3)
    .map((entry) => entry[0] as ReactionType);

  return { count, mine, top_types: top, text: await summaryText(viewerId, live, count, mine) };
}

async function summaryText(
  viewerId: string,
  live: { member_id: string; created_at: Date; name: string }[],
  count: number,
  mine: ReactionType | null,
): Promise<string> {
  if (count === 0) return '';
  const suffix = (n: number): string =>
    n === 1 ? '' : n === 2 ? ' and 1 other' : ` and ${n - 1} others`;
  if (mine) return `You${suffix(count)}`;
  const connections = await firstDegreeSet(viewerId);
  const named = live
    .filter((row) => connections.has(row.member_id))
    .sort((a, b) => {
      const byTime = b.created_at.getTime() - a.created_at.getTime();
      return byTime !== 0 ? byTime : a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    })[0];
  if (named) return `${named.name}${suffix(count)}`;
  return count === 1 ? '1 reaction' : `${count} reactions`;
}

async function liveCommentCount(viewerId: string, postId: string): Promise<number> {
  const excluded = await blockedWith(viewerId);
  const rows = await query<{ author_id: string }>(
    'SELECT author_id FROM comments WHERE post_id = $1 AND deleted_at IS NULL',
    [postId],
  );
  return rows.filter((row) => !excluded.has(row.author_id)).length;
}

async function liveRepostCount(viewerId: string, postId: string): Promise<number> {
  const excluded = await blockedWith(viewerId);
  const plain = await query<{ member_id: string }>('SELECT member_id FROM reposts WHERE post_id = $1', [
    postId,
  ]);
  const thoughts = await query<{ author_id: string }>(
    'SELECT author_id FROM posts WHERE shared_post_id = $1 AND deleted_at IS NULL',
    [postId],
  );
  return (
    plain.filter((row) => !excluded.has(row.member_id)).length +
    thoughts.filter((row) => !excluded.has(row.author_id)).length
  );
}

export type PostObject = Record<string, unknown>;

export async function postObject(
  viewerId: string,
  post: PostRow,
  options: { embed?: boolean } = {},
): Promise<PostObject> {
  const author = (
    await query<{ id: string; handle: string; name: string; headline: string }>(
      'SELECT id, handle, name, headline FROM members WHERE id = $1',
      [post.author_id],
    )
  )[0];
  const degree: Degree | 'self' =
    post.author_id === viewerId ? 'self' : await degreeBetween(viewerId, post.author_id);

  const mentionRows = await query<{ member_id: string; handle: string; name: string }>(
    `SELECT mn.member_id, mn.handle, m.name FROM mentions mn JOIN members m ON m.id = mn.member_id
     WHERE mn.owner_kind = 'post' AND mn.owner_id = $1`,
    [post.id],
  );
  const excluded = await blockedWith(viewerId);

  let shared: PostObject | { unavailable: true } | null = null;
  if (post.shared_post_id && !options.embed) {
    const original = await postById(post.shared_post_id);
    shared =
      original && (await postVisibleTo(viewerId, original))
        ? await postObject(viewerId, original, { embed: true })
        : { unavailable: true };
  }

  const editableUntil = post.created_at.getTime() + config.editWindowSeconds * 1000;
  return {
    id: post.id,
    author: {
      id: author.id,
      handle: author.handle,
      name: author.name,
      headline: author.headline,
      degree,
    },
    text: post.text,
    mentions: mentionRows
      .filter((row) => !excluded.has(row.member_id))
      .map((row) => ({ handle: row.handle, member_id: row.member_id, name: row.name })),
    hashtags: hashtagsOf(post.text),
    created_at: post.created_at.toISOString(),
    edited_at: post.edited_at ? post.edited_at.toISOString() : null,
    editable: businessNow().getTime() < editableUntil,
    photo_url: photoUrl(post.photo_id),
    reactions: await reactionSummary(viewerId, post.id),
    comment_count: await liveCommentCount(viewerId, post.id),
    repost_count: await liveRepostCount(viewerId, post.id),
    reposted_by_me: await repostedByMe(viewerId, post.id),
    shared,
  };
}

export async function repostedByMe(viewerId: string, postId: string): Promise<boolean> {
  const rows = await query<{ one: number }>(
    'SELECT 1 AS one FROM reposts WHERE member_id = $1 AND post_id = $2',
    [viewerId, postId],
  );
  return rows.length > 0;
}

/** Mentions resolve only to the author's 1st-degree connections at save time. */
export async function saveMentions(
  ownerKind: 'post' | 'comment',
  ownerId: string,
  authorId: string,
  text: string,
): Promise<string[]> {
  const handles = mentionHandles(text);
  await query('DELETE FROM mentions WHERE owner_kind = $1 AND owner_id = $2', [ownerKind, ownerId]);
  if (handles.length === 0) return [];
  const connections = await firstDegreeSet(authorId);
  const found = await query<{ id: string; handle: string }>(
    'SELECT id, handle FROM members WHERE handle = ANY($1)',
    [handles],
  );
  const resolved = found.filter((row) => connections.has(row.id));
  for (const row of resolved) {
    await query(
      'INSERT INTO mentions (owner_kind, owner_id, member_id, handle) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [ownerKind, ownerId, row.id, row.handle],
    );
  }
  return resolved.map((row) => row.id);
}

export async function saveHashtags(postId: string, text: string): Promise<void> {
  await query('DELETE FROM post_hashtags WHERE post_id = $1', [postId]);
  for (const tag of hashtagsOf(text)) {
    await query(
      'INSERT INTO post_hashtags (post_id, tag_lower, tag_raw) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [postId, tag.toLowerCase(), tag],
    );
  }
}

export type CommentRow = {
  id: string;
  post_id: string;
  author_id: string;
  parent_id: string | null;
  text: string;
  created_at: Date;
  deleted_at: Date | null;
};

export async function commentById(id: string): Promise<CommentRow | null> {
  const rows = await query<CommentRow>(
    'SELECT id, post_id, author_id, parent_id, text, created_at, deleted_at FROM comments WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

async function commentObject(
  row: CommentRow,
  replies: Record<string, unknown>[],
): Promise<Record<string, unknown>> {
  if (row.deleted_at) {
    return { id: row.id, post_id: row.post_id, parent_id: row.parent_id, deleted: true, replies };
  }
  const author = (
    await query<{ id: string; handle: string; name: string; headline: string }>(
      'SELECT id, handle, name, headline FROM members WHERE id = $1',
      [row.author_id],
    )
  )[0];
  const mentionRows = await query<{ member_id: string; handle: string; name: string }>(
    `SELECT mn.member_id, mn.handle, m.name FROM mentions mn JOIN members m ON m.id = mn.member_id
     WHERE mn.owner_kind = 'comment' AND mn.owner_id = $1`,
    [row.id],
  );
  return {
    id: row.id,
    post_id: row.post_id,
    parent_id: row.parent_id,
    author: { id: author.id, handle: author.handle, name: author.name, headline: author.headline },
    text: row.text,
    mentions: mentionRows.map((m) => ({ handle: m.handle, member_id: m.member_id, name: m.name })),
    hashtags: hashtagsOf(row.text),
    created_at: row.created_at.toISOString(),
    deleted: false,
    replies,
  };
}

/** Comments are one level deep and read oldest first at both levels. */
export async function commentTree(
  viewerId: string,
  postId: string,
): Promise<Record<string, unknown>[]> {
  const rows = await query<CommentRow>(
    `SELECT id, post_id, author_id, parent_id, text, created_at, deleted_at
     FROM comments WHERE post_id = $1 ORDER BY created_at, id`,
    [postId],
  );
  const excluded = await blockedWith(viewerId);
  const visible = rows.filter((row) => !excluded.has(row.author_id));
  const tops = visible.filter((row) => row.parent_id === null);
  const out: Record<string, unknown>[] = [];
  for (const top of tops) {
    const replies = visible.filter((row) => row.parent_id === top.id);
    const liveReplies = replies.filter((row) => !row.deleted_at);
    if (top.deleted_at && liveReplies.length === 0) continue;
    const replyObjects: Record<string, unknown>[] = [];
    for (const reply of liveReplies) replyObjects.push(await commentObject(reply, []));
    out.push(await commentObject(top, replyObjects));
  }
  return out;
}

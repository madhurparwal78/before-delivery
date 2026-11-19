import type pg from 'pg';
import { one, rows } from './db.js';
import { now } from './clock.js';
import { renderMarkdown } from './markdown.js';
import { hotRank } from './rank.js';

/* ------------------------------------------------------------------ posts */

export interface NewPost {
  communityId: string;
  authorId: string;
  title: string;
  bodyMd: string;
  spoiler: boolean;
  score: number;
  createdAt: Date;
  images: { id: string; alt: string | null }[];
}

/** Inserts a post with its stored hot rank, and attaches its uploaded images in order. Returns the new id. */
export async function insertPost(client: pg.PoolClient, post: NewPost): Promise<string> {
  const inserted = await one<{ id: string }>(client,
    `INSERT INTO posts (community_id, author_id, title, body_md, body_html, spoiler, score, hot_rank, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [post.communityId, post.authorId, post.title, post.bodyMd, renderMarkdown(post.bodyMd), post.spoiler, post.score,
      hotRank(post.score, post.createdAt), post.createdAt]);
  const id = (inserted as { id: string }).id;
  for (const [position, image] of post.images.entries()) {
    await client.query('UPDATE images SET post_id = $2, position = $3, alt = $4 WHERE id = $1', [image.id, id, position, image.alt]);
  }
  return id;
}

/* ------------------------------------------------------------------ comments */

const ancestorIds = (path: string): string[] => path.split('/').filter(Boolean);

export interface NewComment { postId: string; parentId: string | null; authorId: string; bodyMd: string; createdAt: Date }

/** Inserts a comment and, in the same transaction, moves the stored counters of its ancestors and its post. */
export async function insertComment(client: pg.PoolClient, comment: NewComment): Promise<string> {
  const parent = comment.parentId === null ? null
    : await one<{ depth: number; path: string }>(client, 'SELECT depth, path FROM comments WHERE id = $1', [comment.parentId]);
  const inserted = await one<{ id: string }>(client,
    `INSERT INTO comments (post_id, parent_id, author_id, body_md, body_html, depth, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [comment.postId, comment.parentId, comment.authorId, comment.bodyMd, renderMarkdown(comment.bodyMd),
      (parent?.depth ?? 0) + 1, comment.createdAt]);
  const id = (inserted as { id: string }).id;
  await client.query('UPDATE comments SET path = $2 WHERE id = $1', [id, `${parent?.path ?? '/'}${id}/`]);
  if (parent) {
    await client.query('UPDATE comments SET descendant_count = descendant_count + 1 WHERE id = ANY($1::bigint[])', [ancestorIds(parent.path)]);
  }
  await client.query('UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1', [comment.postId]);
  return id;
}

/** Takes a published comment out of the counts: deletion by its author or removal by a moderator. */
export async function retireComment(
  client: pg.PoolClient, comment: { id: string; postId: string; path: string }, state: 'deleted' | 'removed', reason: string | null,
): Promise<number> {
  await client.query(
    `UPDATE comments SET state = $2, removal_reason = $3, body_md = CASE WHEN $2 = 'deleted' THEN NULL ELSE body_md END,
       body_html = CASE WHEN $2 = 'deleted' THEN NULL ELSE body_html END WHERE id = $1`,
    [comment.id, state, reason]);
  const above = ancestorIds(comment.path).filter((id) => id !== comment.id);
  if (above.length > 0) {
    await client.query('UPDATE comments SET descendant_count = descendant_count - 1 WHERE id = ANY($1::bigint[])', [above]);
  }
  const counted = await one<{ comment_count: number }>(client,
    'UPDATE posts SET comment_count = comment_count - 1 WHERE id = $1 RETURNING comment_count', [comment.postId]);
  return (counted as { comment_count: number }).comment_count;
}

/* ------------------------------------------------------------------ communities */

export interface NewCommunity {
  name: string;
  title: string;
  description: string;
  type: 'public' | 'restricted';
  ownerId: string;
  rules: { title: string; description: string }[];
  moderatorIds: string[];
  memberIds: string[];
  memberCount: number;
}

export async function insertCommunity(client: pg.PoolClient, community: NewCommunity): Promise<{ id: string; ruleIds: string[] }> {
  const inserted = await one<{ id: string }>(client,
    `INSERT INTO communities (name, name_key, title, description, type, member_count, owner_id, created_at)
     VALUES ($1, lower($1), $2, $3, $4, $5, $6, $7) RETURNING id`,
    [community.name, community.title, community.description, community.type, community.memberCount, community.ownerId, now()]);
  const id = (inserted as { id: string }).id;
  await client.query('INSERT INTO moderators (community_id, user_id) SELECT $1, unnest($2::bigint[])', [id, community.moderatorIds]);
  await client.query('INSERT INTO memberships (community_id, user_id, joined_at) SELECT $1, unnest($2::bigint[]), $3', [id, community.memberIds, now()]);
  return { id, ruleIds: await replaceRules(client, id, community.rules) };
}

export async function replaceRules(client: pg.PoolClient, communityId: string, rules: { title: string; description: string }[]): Promise<string[]> {
  await client.query('DELETE FROM rules WHERE community_id = $1', [communityId]);
  const ids: string[] = [];
  for (const [position, rule] of rules.entries()) {
    const row = await one<{ id: string }>(client,
      'INSERT INTO rules (community_id, position, title, description) VALUES ($1, $2, $3, $4) RETURNING id',
      [communityId, position, rule.title, rule.description]);
    ids.push((row as { id: string }).id);
  }
  return ids;
}

/** Joins or leaves; the stored member count changes in the same transaction and only when membership changed. */
export async function setMembership(client: pg.PoolClient, communityId: string, userId: string, joined: boolean): Promise<number> {
  const changed = joined
    ? await rows(client, 'INSERT INTO memberships (community_id, user_id, joined_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1', [communityId, userId, now()])
    : await rows(client, 'DELETE FROM memberships WHERE community_id = $1 AND user_id = $2 RETURNING 1', [communityId, userId]);
  const counted = await one<{ member_count: number }>(client,
    `UPDATE communities SET member_count = member_count + $2 WHERE id = $1 RETURNING member_count`,
    [communityId, changed.length === 0 ? 0 : joined ? 1 : -1]);
  return (counted as { member_count: number }).member_count;
}

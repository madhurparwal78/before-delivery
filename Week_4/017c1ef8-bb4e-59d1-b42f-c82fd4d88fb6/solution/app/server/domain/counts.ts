import { rows, type Db } from '../db.js';
import { visibleComments } from './comments.js';
import type { MemberRef } from './graph.js';
import { REACTION_TYPES, type ReactionType } from './reactions.js';
import { others } from './text.js';
import { connectedWith, memberVisibleTo, notBlockedWith } from './visibility.js';

/**
 * Every derived count the app shows is decided here: reaction summaries, comment and repost counts, mutual
 * connection counts and unread counts. Other modules call these and never count for themselves.
 */

export interface ReactionSummary {
  count: number;
  mine: ReactionType | null;
  top_types: ReactionType[];
  text: string;
}

interface ReactorRow {
  post_id: string;
  member_id: string;
  name: string;
  type: ReactionType;
  connected: boolean;
}

function summarise(reactors: ReactorRow[], viewerId: string): ReactionSummary {
  const count = reactors.length;
  if (count === 0) return { count: 0, mine: null, top_types: [], text: '' };
  const mine = reactors.find((reactor) => reactor.member_id === viewerId)?.type ?? null;
  const tally = new Map<ReactionType, number>();
  for (const reactor of reactors) tally.set(reactor.type, (tally.get(reactor.type) ?? 0) + 1);
  const top_types = REACTION_TYPES.filter((type) => tally.has(type))
    .sort((a, b) => (tally.get(b) as number) - (tally.get(a) as number))
    .slice(0, 3);
  const connection = reactors.find((reactor) => reactor.connected);
  let text: string;
  if (mine) text = count === 1 ? 'You' : `You and ${others(count - 1)}`;
  else if (connection) text = count === 1 ? connection.name : `${connection.name} and ${others(count - 1)}`;
  else text = count === 1 ? '1 reaction' : `${count} reactions`;
  return { count, mine, top_types, text };
}

/** Reaction summaries for the viewer. Reactions by members the viewer may not see are left out, so the count equals the reactor list. */
export async function reactionSummaries(db: Db, viewerId: string, postIds: string[]): Promise<Map<string, ReactionSummary>> {
  const reactors = await rows<ReactorRow>(
    db,
    `SELECT r.post_id, r.member_id, m.name, r.type, ${connectedWith('$1', 'r.member_id')} AS connected
       FROM reactions r JOIN members m ON m.id = r.member_id
      WHERE r.post_id = ANY($2) AND ${memberVisibleTo('$1', 'm')}
      ORDER BY r.created_at DESC, lower(m.name), m.id`,
    [viewerId, postIds],
  );
  const byPost = new Map<string, ReactorRow[]>();
  for (const reactor of reactors) byPost.set(reactor.post_id, [...(byPost.get(reactor.post_id) ?? []), reactor]);
  return new Map(postIds.map((id) => [id, summarise(byPost.get(id) ?? [], viewerId)]));
}

/** Live comments and replies the viewer sees, per post. */
export async function commentCounts(db: Db, viewerId: string, postIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>(postIds.map((id) => [id, 0]));
  for (const comment of await visibleComments(db, viewerId, postIds)) {
    if (!comment.deleted) counts.set(comment.post_id, (counts.get(comment.post_id) as number) + 1);
  }
  return counts;
}

export interface RepostStats {
  count: number;
  byMe: boolean;
}

/**
 * Repost counts for the viewer: plain reposts plus reposts with thoughts, leaving out reposters the viewer may not see.
 * `byMe` is whether the viewer plainly reposted the post.
 */
export async function repostStats(db: Db, viewerId: string, postIds: string[]): Promise<Map<string, RepostStats>> {
  const reposters = await rows<{ post_id: string }>(
    db,
    `SELECT t.post_id FROM (
        SELECT rp.post_id, rp.member_id FROM reposts rp WHERE rp.post_id = ANY($2)
        UNION ALL
        SELECT p.shared_post_id, p.author_id FROM posts p WHERE p.shared_post_id = ANY($2)
      ) t JOIN members m ON m.id = t.member_id
      WHERE ${memberVisibleTo('$1', 'm')}`,
    [viewerId, postIds],
  );
  const mine = new Set(
    (await rows<{ post_id: string }>(db, 'SELECT post_id FROM reposts WHERE member_id = $1 AND post_id = ANY($2)', [viewerId, postIds])).map((row) => row.post_id),
  );
  const stats = new Map<string, RepostStats>(postIds.map((id) => [id, { count: 0, byMe: mine.has(id) }]));
  for (const { post_id } of reposters) (stats.get(post_id) as RepostStats).count += 1;
  return stats;
}

/**
 * The mutual rule: members connected to both the viewer and the owner, leaving out anyone blocked with the viewer.
 * `viewer` and `owner` are SQL expressions; the rows are `m` (the mutual member) and `cv` (its connection to the viewer).
 */
const mutualsSql = (viewer: string, owner: string): string =>
  `FROM connections cv
     JOIN members m ON m.id = CASE WHEN cv.member_lo = ${viewer} THEN cv.member_hi ELSE cv.member_lo END
    WHERE (cv.member_lo = ${viewer} OR cv.member_hi = ${viewer}) AND m.id <> ${owner} AND ${notBlockedWith(viewer, 'm.id')}
      AND EXISTS (SELECT 1 FROM connections co WHERE co.member_lo = LEAST(m.id, ${owner}) AND co.member_hi = GREATEST(m.id, ${owner}))`;

interface Mutuals {
  count: number;
  members: MemberRef[];
}

/** The mutual connections with one owner, most recently connected to the viewer first, ties by name ignoring case. */
export async function mutualsBetween(db: Db, viewerId: string, ownerId: string): Promise<Mutuals> {
  const members = await rows<MemberRef>(db, `SELECT m.id, m.name, m.handle ${mutualsSql('$1', '$2::text')} ORDER BY cv.connected_at DESC, lower(m.name), m.id`, [
    viewerId,
    ownerId,
  ]);
  return { count: members.length, members };
}

/** The number of mutual connections with each of many owners, by the same rule. */
export async function mutualCounts(db: Db, viewerId: string, memberIds: string[]): Promise<Map<string, number>> {
  const counted = await rows<{ id: string; count: number }>(
    db,
    `SELECT o.id, (SELECT count(*)::int ${mutualsSql('$1', 'o.id')}) AS count FROM unnest($2::text[]) AS o(id)`,
    [viewerId, memberIds],
  );
  return new Map(counted.map((row) => [row.id, row.count]));
}

/** The viewer's unread incoming messages in the conversation `conversationAlias`, as a SQL expression. */
export const unreadMessagesSql = (conversationAlias: string, viewerParam: string): string =>
  `(SELECT count(*) FROM messages um WHERE um.conversation_id = ${conversationAlias}.id AND um.sender_id <> ${viewerParam} AND um.read_at IS NULL)`;

/** A notification is unread when it changed after the member last opened Notifications. */
export const isUnread = (changedAt: Date, seenAt: Date): boolean => changedAt > seenAt;

/** How many of the listed notifications are unread. */
export const unreadCount = (items: Array<{ unread: boolean }>): number => items.filter((item) => item.unread).length;

import { rows, type Db, type Tx } from '../db.js';
import { announcePost } from './post-events.js';
import { reactionSummaries, type ReactionSummary } from './counts.js';
import { memberVisibleTo } from './visibility.js';

export const REACTION_TYPES = ['like', 'celebrate', 'support', 'insightful', 'funny'] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];

export const isReactionType = (value: unknown): value is ReactionType => REACTION_TYPES.some((type) => type === value);

async function summaryOf(db: Db, viewerId: string, postId: string): Promise<ReactionSummary> {
  return (await reactionSummaries(db, viewerId, [postId])).get(postId) as ReactionSummary;
}

/** One reaction per member and post; choosing the type already held keeps it as it was. */
export async function setReaction(tx: Tx, viewerId: string, post: { id: string; author_id: string }, type: ReactionType, at: Date): Promise<ReactionSummary> {
  await tx.query(
    `INSERT INTO reactions (post_id, member_id, type, created_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (post_id, member_id) DO UPDATE
       SET type = EXCLUDED.type,
           created_at = CASE WHEN reactions.type = EXCLUDED.type THEN reactions.created_at ELSE EXCLUDED.created_at END`,
    [post.id, viewerId, type, at],
  );
  announcePost(tx, 'reactions', post);
  return summaryOf(tx, viewerId, post.id);
}

export async function removeReaction(tx: Tx, viewerId: string, post: { id: string; author_id: string }): Promise<ReactionSummary> {
  await tx.query('DELETE FROM reactions WHERE post_id = $1 AND member_id = $2', [post.id, viewerId]);
  announcePost(tx, 'reactions', post);
  return summaryOf(tx, viewerId, post.id);
}

interface Reactor {
  member_id: string;
  type: ReactionType;
  at: Date;
}

/** Reactors, newest first, leaving out members the viewer may not see. */
export async function reactorsOf(db: Db, viewerId: string, postId: string): Promise<Reactor[]> {
  return rows<Reactor>(
    db,
    `SELECT r.member_id, r.type, r.created_at AS at FROM reactions r JOIN members m ON m.id = r.member_id
      WHERE r.post_id = $2 AND ${memberVisibleTo('$1', 'm')}
      ORDER BY r.created_at DESC, r.member_id`,
    [viewerId, postId],
  );
}

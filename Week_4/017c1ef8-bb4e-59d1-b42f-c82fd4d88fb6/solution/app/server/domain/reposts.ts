import { maybeRow, type Tx } from '../db.js';
import { conflict, forbidden, notFound } from '../errors.js';
import { newId } from '../ids.js';
import { repostStats, type RepostStats } from './counts.js';
import { notify } from './notify.js';
import { announcePost } from './post-events.js';
import { memberVisibleTo } from './visibility.js';

/** A plain repost: once per member and original; a second attempt is the already-reposted conflict. */
export async function createRepost(tx: Tx, viewerId: string, post: { id: string; author_id: string }, at: Date): Promise<{ repost_id: string; repost_count: number }> {
  const id = newId();
  const inserted = await maybeRow<{ id: string }>(
    tx,
    'INSERT INTO reposts (id, member_id, post_id, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (member_id, post_id) DO NOTHING RETURNING id',
    [id, viewerId, post.id, at],
  );
  if (!inserted) throw conflict('already_reposted');
  await notify(tx, { memberId: post.author_id, kind: 'repost', actorId: viewerId, postId: post.id, detail: id });
  announcePost(tx, 'reposts', post);
  const stats = (await repostStats(tx, viewerId, [post.id])).get(post.id) as RepostStats;
  return { repost_id: id, repost_count: stats.count };
}

/** Deletes a plain repost its member made; the original's author no longer hears of it. */
export async function deleteRepost(tx: Tx, viewerId: string, repostId: string): Promise<void> {
  const repost = await maybeRow<{ member_id: string; post_id: string; author_id: string }>(
    tx,
    `SELECT rp.member_id, rp.post_id, p.author_id FROM reposts rp
       JOIN posts p ON p.id = rp.post_id JOIN members am ON am.id = p.author_id
      WHERE rp.id = $2 AND ${memberVisibleTo('$1', 'am')}`,
    [viewerId, repostId],
  );
  if (!repost) throw notFound();
  if (repost.member_id !== viewerId) throw forbidden('not_author');
  await tx.query('DELETE FROM reposts WHERE id = $1', [repostId]);
  await tx.query(`DELETE FROM notifications WHERE kind = 'repost' AND detail = $1`, [repostId]);
  announcePost(tx, 'reposts', { id: repost.post_id, author_id: repost.author_id });
}

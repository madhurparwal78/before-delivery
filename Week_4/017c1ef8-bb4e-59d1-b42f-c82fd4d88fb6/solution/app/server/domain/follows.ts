import { now } from '../clock.js';
import { maybeRow, type Db, type Tx } from '../db.js';
import { notFound, validation } from '../errors.js';
import { lockPair } from './connections.js';
import { memberVisibleTo } from './visibility.js';

/** Follows a member the viewer may see, or a company. Returns false when already following. */
export async function follow(tx: Tx, viewerId: string, targetId: unknown): Promise<boolean> {
  if (typeof targetId !== 'string') throw validation({ target_id: 'Choose who to follow.' });
  const db = tx;
  await lockPair(db, viewerId, targetId);
  const known =
    (await maybeRow(db, 'SELECT 1 FROM companies WHERE id = $1', [targetId])) ??
    (await maybeRow(db, `SELECT 1 FROM members m WHERE m.id = $2 AND m.confirmed AND ${memberVisibleTo('$1', 'm')}`, [viewerId, targetId]));
  if (!known) throw notFound();
  if (targetId === viewerId) throw validation({ target_id: "You can't follow yourself." });
  const inserted = await db.query('INSERT INTO follows (follower_id, target_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [viewerId, targetId, now()]);
  return inserted.rowCount === 1;
}

export async function unfollow(db: Db, viewerId: string, targetId: string): Promise<void> {
  const known = (await maybeRow(db, 'SELECT 1 FROM companies WHERE id = $1', [targetId])) ?? (await maybeRow(db, 'SELECT 1 FROM members WHERE id = $1', [targetId]));
  if (!known) throw notFound();
  await db.query('DELETE FROM follows WHERE follower_id = $1 AND target_id = $2', [viewerId, targetId]);
}

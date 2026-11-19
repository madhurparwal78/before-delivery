import type pg from 'pg';
import { rows } from './db.js';
import { config } from './config.js';
import { now, secondsFromNow } from './clock.js';
import { AppError, validation } from './errors.js';
import { logAction } from './modlog.js';
import { COPY, asRecord, asString, failIfAny, type Fields } from './validate.js';
import type { PostState } from '../shared/types.js';

/** Every state change of a post, by whoever makes it. This table is the post state machine. */
export type PostMove = 'remove' | 'restore' | 'lock' | 'unlock' | 'pin' | 'unpin' | 'delete';

export interface PostFacts { state: PostState; locked: boolean; pinned: boolean }

const REQUIRED_STATE: Record<PostMove, readonly PostState[]> = {
  remove: ['published'],
  restore: ['removed'],
  lock: ['published'],
  unlock: ['published'],
  pin: ['published'],
  unpin: ['published'],
  delete: ['published', 'removed'],
};

/** Why a move is refused in the post's current state, or null when it is legal. */
export function moveConflict(post: PostFacts, move: PostMove): string | null {
  if (!REQUIRED_STATE[move].includes(post.state)) return `This post is ${post.state}`;
  if (move === 'lock' && post.locked) return 'This thread is already locked';
  if (move === 'unlock' && !post.locked) return 'This thread is not locked';
  if (move === 'pin' && post.pinned) return 'This post is already pinned';
  if (move === 'unpin' && !post.pinned) return 'This post is not pinned';
  return null;
}

export interface Removal { publicReason: string; privateNote: string | null }

/** Shared by post and comment removal: a rule title, "Spam", or the public note for Other. */
export function parseRemoval(body: unknown, rules: { id: string; title: string }[]): Removal {
  const input = asRecord(body);
  const fields: Fields = {};
  const reason = asString(input.reason);
  const privateNote = asString(input.privateNote);
  const publicNote = asString(input.publicNote)?.trim();
  let publicReason = '';
  if (reason === 'spam') publicReason = 'Spam';
  else if (reason === 'rule') {
    const rule = rules.find((r) => r.id === String(input.ruleId));
    if (rule) publicReason = rule.title;
    else fields.ruleId = COPY.rule;
  } else if (reason === 'other') {
    if (!publicNote) fields.publicNote = COPY.reasonOther;
    else if (publicNote.length > 300) fields.publicNote = COPY.publicNote;
    else publicReason = publicNote;
  } else fields.reason = COPY.reasonMissing;
  if (privateNote !== undefined && privateNote.length > 1000) fields.privateNote = COPY.privateNote;
  failIfAny(fields);
  return { publicReason, privateNote: privateNote?.length ? privateNote : null };
}

const LOCK_HOURS = { '1h': { hours: 1, label: '1 hour' }, '24h': { hours: 24, label: '24 hours' }, '7d': { hours: 168, label: '7 days' } } as const;

export interface LockTerms { until: Date | null; label: string | null }

export function parseLock(body: unknown): LockTerms {
  const duration = asString(asRecord(body).duration);
  if (duration === 'indefinite') return { until: null, label: null };
  const timed = duration && duration in LOCK_HOURS ? LOCK_HOURS[duration as keyof typeof LOCK_HOURS] : null;
  if (!timed) throw validation({ duration: COPY.duration });
  return { until: secondsFromNow(timed.hours * config.limits.lockHourSeconds), label: timed.label };
}

export interface MoveContext {
  client: pg.PoolClient;
  postId: string;
  communityId: string;
  moderatorId: string;
  body: unknown;
}

const bump = 'version = version + 1';

async function pinnedPosts(client: pg.PoolClient, communityId: string): Promise<{ id: string; title: string }[]> {
  return rows(client,
    "SELECT id, title FROM posts WHERE community_id = $1 AND pinned AND state = 'published' ORDER BY pinned_at, id FOR UPDATE",
    [communityId]);
}

/** Applies one legal move to a locked post row, bumping its version and writing the mod log entry. */
export async function applyMove(move: PostMove, context: MoveContext): Promise<{ touched: string[] }> {
  const { client, postId, communityId, moderatorId, body } = context;
  const target = { type: 'post' as const, id: postId };
  switch (move) {
    case 'remove': {
      const rules = await rows<{ id: string; title: string }>(client, 'SELECT id, title FROM rules WHERE community_id = $1', [communityId]);
      const removal = parseRemoval(body, rules);
      await client.query(
        `UPDATE posts SET state = 'removed', removal_reason = $2, removed_at = $3, pinned = false, pinned_at = NULL, ${bump} WHERE id = $1`,
        [postId, removal.publicReason, now()]);
      await logAction(client, { communityId, action: 'remove_post', target, publicReason: removal.publicReason, privateNote: removal.privateNote, moderatorId });
      return { touched: [postId] };
    }
    case 'restore':
      await client.query(`UPDATE posts SET state = 'published', removal_reason = NULL, removed_at = NULL, ${bump} WHERE id = $1`, [postId]);
      await logAction(client, { communityId, action: 'restore_post', target, moderatorId });
      return { touched: [postId] };
    case 'lock': {
      const terms = parseLock(body);
      await client.query(`UPDATE posts SET locked = true, locked_until = $2, ${bump} WHERE id = $1`, [postId, terms.until]);
      await logAction(client, { communityId, action: 'lock', target, publicReason: terms.label, moderatorId });
      return { touched: [postId] };
    }
    case 'unlock':
      await client.query(`UPDATE posts SET locked = false, locked_until = NULL, ${bump} WHERE id = $1`, [postId]);
      await logAction(client, { communityId, action: 'unlock', target, moderatorId });
      return { touched: [postId] };
    case 'pin': {
      await client.query('SELECT 1 FROM communities WHERE id = $1 FOR UPDATE', [communityId]);
      const pinned = await pinnedPosts(client, communityId);
      const touched = [postId];
      if (pinned.length >= 2) {
        const replaceId = asString(asRecord(body).replacePostId);
        if (!replaceId || !pinned.some((p) => p.id === replaceId)) {
          throw new AppError('SLOT_TAKEN', 'Both pin slots are taken', { current: { pinned } });
        }
        await client.query(`UPDATE posts SET pinned = false, pinned_at = NULL, ${bump} WHERE id = $1`, [replaceId]);
        await logAction(client, { communityId, action: 'unpin', target: { type: 'post', id: replaceId }, moderatorId });
        touched.push(replaceId);
      }
      await client.query(`UPDATE posts SET pinned = true, pinned_at = $2, ${bump} WHERE id = $1`, [postId, now()]);
      await logAction(client, { communityId, action: 'pin', target, moderatorId });
      return { touched };
    }
    case 'unpin':
      await client.query(`UPDATE posts SET pinned = false, pinned_at = NULL, ${bump} WHERE id = $1`, [postId]);
      await logAction(client, { communityId, action: 'unpin', target, moderatorId });
      return { touched: [postId] };
    case 'delete':
      await client.query(
        `UPDATE posts SET state = 'deleted', body_md = NULL, body_html = NULL, pinned = false, pinned_at = NULL, ${bump} WHERE id = $1`,
        [postId]);
      return { touched: [postId] };
  }
}

import { KIND_LABELS } from '../../shared/reference';
import { config } from '../config';
import { db, transaction, type Db } from '../db/pool';
import { alreadyClaimed, alreadyDecided, ApiError } from '../errors';
import type { SessionUser } from '../http/context';
import { letters, queueLetter } from '../services/mail';
import { publish } from '../services/live';
import { flushSyncQuietly, queueSync } from '../services/sync';
import { findPost, type PostRow } from './posts';

export type HistoryType = 'claimed' | 'renewed' | 'expired' | 'approved' | 'rejected';

const MODERATOR_AUDIENCE = { roles: ['moderator', 'founder'] } as const;

export interface HistoryEvent {
  type: HistoryType;
  by_name: string | null;
  reason: string | null;
  at: string;
}

export function historyText(event: HistoryEvent): string {
  switch (event.type) {
    case 'claimed':
      return `Claimed by ${event.by_name}`;
    case 'renewed':
      return `Claim renewed by ${event.by_name}`;
    case 'expired':
      return 'Claim expired';
    case 'approved':
      return `Approved by ${event.by_name}`;
    case 'rejected':
      return `Rejected by ${event.by_name}: ${event.reason}`;
  }
}

async function appendHistory(
  tx: Db,
  now: Date,
  post: PostRow,
  type: HistoryType,
  byName: string | null,
  reason: string | null,
): Promise<void> {
  const row = await tx.one<{ at: Date }>(
    `INSERT INTO post_history (post_id, type, by_name, reason, at) VALUES ($1, $2, $3, $4, $5) RETURNING at`,
    [post.id, type, byName, reason, now],
  );
  const event: HistoryEvent = {
    type,
    by_name: byName,
    reason,
    at: (row?.at ?? now).toISOString(),
  };
  await publish(tx, now, 'queue.history', { post_id: post.id, event }, MODERATOR_AUDIENCE);
}

async function announceState(
  tx: Db,
  now: Date,
  post: PostRow,
  state: string,
  byName: string | null,
  reason: string | null,
): Promise<void> {
  await publish(tx, now, 'queue.changed', { post_id: post.id, state, by_name: byName }, MODERATOR_AUDIENCE);
  if (post.author_id) {
    await publish(tx, now, 'post.state', { post_id: post.id, state, reason }, { user_ids: [post.author_id] });
  }
}

function leaseEndsAt(post: PostRow): Date {
  const started = post.lease_started_at ?? post.claimed_at ?? new Date(0);
  return new Date(started.getTime() + config.claimLapseSeconds * 1000);
}

function leaseHasEnded(post: PostRow, now: Date): boolean {
  return now.getTime() >= leaseEndsAt(post).getTime();
}

/** A lease that ends returns the post to pending, with one history event. */
async function lapse(tx: Db, now: Date, post: PostRow): Promise<PostRow> {
  await tx.query(
    `UPDATE posts SET state = 'pending', claimed_by = NULL, claimed_at = NULL, lease_started_at = NULL,
            last_lapsed_by = claimed_by, last_lapsed_at = $2
       WHERE id = $1`,
    [post.id, now],
  );
  const lapsed: PostRow = {
    ...post,
    state: 'pending',
    last_lapsed_by: post.claimed_by,
    claimed_by: null,
    claimed_at: null,
    lease_started_at: null,
  };
  await appendHistory(tx, now, post, 'expired', null, null);
  await announceState(tx, now, lapsed, 'pending', null, null);
  return lapsed;
}

async function lapseIfDue(tx: Db, now: Date, post: PostRow): Promise<PostRow> {
  if (post.state !== 'claimed' || !leaseHasEnded(post, now)) return post;
  return lapse(tx, now, post);
}

export async function lapseDueClaims(now: Date): Promise<void> {
  const due = await db.query<{ id: string }>(
    `SELECT id FROM posts WHERE state = 'claimed' AND lease_started_at <= $1`,
    [new Date(now.getTime() - config.claimLapseSeconds * 1000)],
  );
  for (const row of due) {
    await transaction(async (tx) => {
      const post = await lockForModeration(tx, row.id);
      if (post) await lapseIfDue(tx, now, post);
    });
  }
}

async function lockForModeration(tx: Db, id: string): Promise<PostRow | null> {
  const found = await tx.one<{ id: string }>('SELECT id FROM posts WHERE id = $1 FOR UPDATE', [id]);
  return found ? findPost(id, tx) : null;
}

async function moderatorName(tx: Db, userId: string | null): Promise<string> {
  if (!userId) return 'a moderator';
  const row = await tx.one<{ display_name: string }>('SELECT display_name FROM users WHERE id = $1', [userId]);
  return row?.display_name ?? 'a moderator';
}

function decisionWord(state: string): 'approved' | 'rejected' {
  return state === 'approved' ? 'approved' : 'rejected';
}

export interface ClaimOutcome {
  id: string;
  state: 'claimed';
  claimed_by_name: string;
}

export async function claimPost(moderator: SessionUser, postId: string, now: Date): Promise<ClaimOutcome> {
  return transaction(async (tx) => {
    const post = await lapseIfDue(tx, now, await requireQueuePost(tx, moderator, postId));
    if (post.state === 'approved' || post.state === 'rejected') {
      throw alreadyDecided(decisionWord(post.state), await moderatorName(tx, post.decided_by));
    }
    if (post.state === 'claimed') {
      if (post.claimed_by === moderator.id) {
        return { id: post.id, state: 'claimed' as const, claimed_by_name: moderator.display_name };
      }
      throw alreadyClaimed(await moderatorName(tx, post.claimed_by));
    }
    await tx.query(
      `UPDATE posts SET state = 'claimed', claimed_by = $2, claimed_at = $3, lease_started_at = $3 WHERE id = $1`,
      [post.id, moderator.id, now],
    );
    await appendHistory(tx, now, post, 'claimed', moderator.display_name, null);
    await announceState(tx, now, post, 'claimed', moderator.display_name, null);
    await tx.query(
      `INSERT INTO audit_log (action, actor_id, subject_id, detail, at) VALUES ('claim', $1, $2, '{}', $3)`,
      [moderator.id, post.id, now],
    );
    return { id: post.id, state: 'claimed' as const, claimed_by_name: moderator.display_name };
  });
}

/** A moderator never sees or acts on their own past posts. */
async function requireQueuePost(tx: Db, moderator: SessionUser, postId: string): Promise<PostRow> {
  const post = await lockForModeration(tx, postId);
  if (!post || post.deleted_at || post.author_id === moderator.id) throw new ApiError('not_found');
  return post;
}

export async function renewClaim(
  moderator: SessionUser,
  postId: string,
  now: Date,
): Promise<{ id: string; state: 'claimed'; lease_ends_at: string }> {
  return transaction(async (tx) => {
    const post = await lapseIfDue(tx, now, await requireQueuePost(tx, moderator, postId));
    await assertClaimantMayDecide(tx, post, moderator);
    await tx.query(`UPDATE posts SET lease_started_at = $2 WHERE id = $1`, [post.id, now]);
    await appendHistory(tx, now, post, 'renewed', moderator.display_name, null);
    return {
      id: post.id,
      state: 'claimed' as const,
      lease_ends_at: new Date(now.getTime() + config.claimLapseSeconds * 1000).toISOString(),
    };
  });
}

async function assertClaimantMayDecide(tx: Db, post: PostRow, moderator: SessionUser): Promise<void> {
  if (post.state === 'approved' || post.state === 'rejected') {
    throw alreadyDecided(decisionWord(post.state), await moderatorName(tx, post.decided_by));
  }
  if (post.state === 'pending') {
    if (post.last_lapsed_by === moderator.id) throw new ApiError('claim_expired');
    throw new ApiError('not_claimed');
  }
  if (post.claimed_by !== moderator.id) throw alreadyClaimed(await moderatorName(tx, post.claimed_by));
}

export interface DecisionOutcome {
  id: string;
  state: 'approved' | 'rejected';
  decided_by_name: string;
}

export async function decidePost(
  moderator: SessionUser,
  postId: string,
  decision: 'approve' | 'reject',
  now: Date,
  /** Input errors are decided after the state conflicts, per the precedence order. */
  readReason: () => string | null,
): Promise<DecisionOutcome> {
  const outcome = await transaction(async (tx) => {
    const post = await lapseIfDue(tx, now, await requireQueuePost(tx, moderator, postId));
    await assertClaimantMayDecide(tx, post, moderator);
    const reason = readReason();

    const state: 'approved' | 'rejected' = decision === 'approve' ? 'approved' : 'rejected';
    await tx.query(
      `UPDATE posts SET state = $2, decided_by = $3, decided_at = $4, reason = $5,
              claimed_by = NULL, claimed_at = NULL, lease_started_at = NULL
         WHERE id = $1`,
      [post.id, state, moderator.id, now, reason],
    );
    await appendHistory(tx, now, post, state, moderator.display_name, reason);
    await announceState(tx, now, post, state, moderator.display_name, reason);
    await tx.query(
      `INSERT INTO audit_log (action, actor_id, subject_id, detail, at) VALUES ('decision', $1, $2, $3, $4)`,
      [moderator.id, post.id, JSON.stringify({ state, reason }), now],
    );

    if (post.author_id) {
      const author = await tx.one<{ email: string; unlocked: boolean; role: string }>(
        'SELECT email, unlocked, role FROM users WHERE id = $1',
        [post.author_id],
      );
      if (author) {
        await queueLetter(
          tx,
          now,
          letters.moderationOutcome(author.email, KIND_LABELS[post.kind], post.company_name, state, reason),
        );
        if (state === 'approved' && !author.unlocked) {
          await tx.query('UPDATE users SET unlocked = true WHERE id = $1', [post.author_id]);
          await publish(tx, now, 'member.unlocked', {}, { user_ids: [post.author_id] });
        }
      }
    }

    await queueSync(tx, now, 'company', post.company_id, 'upsert');
    await publish(tx, now, 'company.changed', { slug: post.company_slug }, { all: true });
    return { id: post.id, state, decided_by_name: moderator.display_name, companyId: post.company_id };
  });

  await flushSyncQuietly('company', outcome.companyId);
  return { id: outcome.id, state: outcome.state, decided_by_name: outcome.decided_by_name };
}

export async function postHistory(postId: string): Promise<HistoryEvent[]> {
  const rows = await db.query<{ type: HistoryType; by_name: string | null; reason: string | null; at: Date }>(
    'SELECT type, by_name, reason, at FROM post_history WHERE post_id = $1 ORDER BY id',
    [postId],
  );
  return rows.map((row) => ({ type: row.type, by_name: row.by_name, reason: row.reason, at: row.at.toISOString() }));
}

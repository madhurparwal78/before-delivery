import type pg from 'pg';
import { pool, one, tx } from '../db.js';
import { config } from '../config.js';
import { AppError, conflict, notFound, validation } from '../errors.js';
import { ok, route, type Ctx, type Reply } from '../http.js';
import { requireUser, requireVerified } from '../guards.js';
import { emitScore } from '../events.js';
import { hotRank } from '../rank.js';
import { archiveCutoff } from '../views.js';
import { takeSlot, valkeyUnavailable } from '../valkey.js';
import { COPY, asRecord, parseId } from '../validate.js';

type Target = 'post' | 'comment';
type Value = -1 | 0 | 1;

interface TargetRow {
  id: string;
  score: number;
  post_id: string;
  community_name: string;
  post_state: 'published' | 'removed' | 'deleted';
  post_created_at: Date;
  comment_state: 'published' | 'deleted' | 'removed' | null;
}

/** The vote arithmetic: a member's vote is one row of 1 or -1, and the score moves by the difference. */
const scoreDelta = (previous: number, next: Value): number => next - previous;

async function lockTarget(client: pg.PoolClient, kind: Target, id: string): Promise<TargetRow | null> {
  return kind === 'post'
    ? one<TargetRow>(client,
      `SELECT p.id, p.score, p.id AS post_id, c.name AS community_name, p.state AS post_state, p.created_at AS post_created_at,
         NULL AS comment_state
       FROM posts p JOIN communities c ON c.id = p.community_id WHERE p.id = $1 FOR UPDATE OF p`, [id])
    : one<TargetRow>(client,
      `SELECT cm.id, cm.score, cm.post_id, c.name AS community_name, p.state AS post_state, p.created_at AS post_created_at,
         cm.state AS comment_state
       FROM comments cm JOIN posts p ON p.id = cm.post_id JOIN communities c ON c.id = p.community_id
       WHERE cm.id = $1 FOR UPDATE OF cm`, [id]);
}

async function vote(ctx: Ctx, kind: Target): Promise<Reply> {
  const user = requireUser(ctx);
  const id = parseId(ctx.params.id as string);
  if (id === null) throw notFound('Nothing to vote on');
  const exists = await one(pool, kind === 'post' ? 'SELECT 1 FROM posts WHERE id = $1' : 'SELECT 1 FROM comments WHERE id = $1', [id]);
  if (!exists) throw notFound('Nothing to vote on');
  requireVerified(user);
  const decision = await takeSlot('vote', user.id, config.limits.votePerMinute).catch(() => null);
  if (decision && !decision.allowed) {
    throw new AppError('RATE_LIMITED', 'Too many votes. Try again shortly.', { retryAfter: decision.retryAfter });
  }
  const sent = asRecord(ctx.body).value;
  const result = await tx(async (client) => {
    const target = (await lockTarget(client, kind, id)) as TargetRow;
    if (target.post_state === 'removed') throw new AppError('REMOVED', 'This post was removed by moderators');
    if (target.post_state === 'deleted' || (target.comment_state !== null && target.comment_state !== 'published')) {
      throw conflict('This can no longer be voted on');
    }
    if (target.post_created_at < archiveCutoff()) throw new AppError('ARCHIVED', 'This thread is archived. Voting and replies are closed.');
    if (sent !== 1 && sent !== 0 && sent !== -1) throw validation({ value: COPY.value });
    if (decision === null) throw valkeyUnavailable();
    const next: Value = sent;
    const previous = (await one<{ value: number }>(client,
      'SELECT v.value FROM votes v WHERE v.member_id = $1 AND v.target_type = $2 AND v.target_id = $3', [user.id, kind, id]))?.value ?? 0;
    if (previous === next) return { score: target.score, myVote: next, changed: false, target };
    if (next === 0) {
      await client.query('DELETE FROM votes WHERE member_id = $1 AND target_type = $2 AND target_id = $3', [user.id, kind, id]);
    } else {
      await client.query(
        `INSERT INTO votes (member_id, target_type, target_id, value) VALUES ($1, $2, $3, $4)
         ON CONFLICT (member_id, target_type, target_id) DO UPDATE SET value = EXCLUDED.value`, [user.id, kind, id, next]);
    }
    const score = target.score + scoreDelta(previous, next);
    if (kind === 'post') {
      await client.query('UPDATE posts SET score = $2, hot_rank = $3 WHERE id = $1', [id, score, hotRank(score, target.post_created_at)]);
    } else {
      await client.query('UPDATE comments SET score = $2 WHERE id = $1', [id, score]);
    }
    return { score, myVote: next, changed: true, target };
  });
  if (result.changed) {
    await emitScore(result.target.community_name, { targetType: kind, targetId: id, postId: result.target.post_id, score: result.score });
  }
  return ok({ score: result.score, myVote: result.myVote });
}

export function registerVoteRoutes(): void {
  route('PUT', '/api/posts/:id/vote', (ctx) => vote(ctx, 'post'));
  route('PUT', '/api/comments/:id/vote', (ctx) => vote(ctx, 'comment'));
}

import { config } from '../core/config.js';
import { one, transaction } from '../core/db.js';
import { ApiError, errors } from '../core/errors.js';
import { hotRankSql } from '../core/schema.js';
import { consumeRate, ValkeyUnavailable } from '../services/valkey.js';
import { copy } from '../shared/copy.js';
import { emitScore } from './events.js';
import type { Member } from './viewer.js';

export interface VoteTarget {
  targetType: 'post' | 'comment';
  targetId: string;
  postId: string;
  communityName: string;
}

export interface VoteResult {
  score: number;
  myVote: number;
}

export function parseVoteValue(raw: unknown): 1 | 0 | -1 {
  if (raw === 1 || raw === 0 || raw === -1) return raw;
  throw errors.validation('Votes are 1, 0 or -1', { value: 'Votes are 1, 0 or -1' });
}

/** The vote counter lives in Valkey; without it no vote is stored. */
export async function checkVoteRate(member: Member): Promise<void> {
  try {
    const decision = await consumeRate('vote', member.id, config.limits.voteRateLimit);
    if (!decision.allowed) {
      throw errors.rateLimited(copy.vote.rateLimited(decision.retryAfter), decision.retryAfter);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof ValkeyUnavailable) throw errors.serviceUnavailable(copy.vote.failed);
    throw error;
  }
}

/**
 * One row per member per target: repeating a value changes nothing, switching moves the score by two.
 * The target's score (and a post's hot rank) move inside the same transaction as the vote row.
 */
export async function castVote(member: Member, target: VoteTarget, value: 1 | 0 | -1): Promise<VoteResult> {
  const result = await transaction(async (tx) => {
    const existing = await one<{ value: number }>(
      tx,
      `select value from votes where member_id = $1 and target_type = $2 and target_id = $3 for update`,
      [member.id, target.targetType, target.targetId],
    );
    const previous = existing ? Number(existing.value) : 0;

    if (previous === value) {
      const current = await one<{ score: number }>(
        tx,
        target.targetType === 'post'
          ? 'select score from posts where id = $1'
          : 'select score from comments where id = $1',
        [target.targetId],
      );
      return { score: Number(current?.score ?? 0), myVote: value, changed: false };
    }

    if (value === 0) {
      await tx.query('delete from votes where member_id = $1 and target_type = $2 and target_id = $3', [
        member.id,
        target.targetType,
        target.targetId,
      ]);
    } else {
      await tx.query(
        `insert into votes (member_id, target_type, target_id, value) values ($1, $2, $3, $4)
         on conflict (member_id, target_type, target_id) do update set value = excluded.value`,
        [member.id, target.targetType, target.targetId, value],
      );
    }

    const delta = value - previous;
    const updated =
      target.targetType === 'post'
        ? await one<{ score: number }>(
            tx,
            `update posts set score = score + $2, hot_rank = ${hotRankSql('score + $2')}
             where id = $1 returning score`,
            [target.targetId, delta],
          )
        : await one<{ score: number }>(tx, 'update comments set score = score + $2 where id = $1 returning score', [
            target.targetId,
            delta,
          ]);

    return { score: Number(updated?.score ?? 0), myVote: value, changed: true };
  });

  if (result.changed) {
    await emitScore(target.targetType, target.targetId, target.postId, result.score, target.communityName);
  }
  return { score: result.score, myVote: result.myVote };
}

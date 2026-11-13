import type { PoolClient } from 'pg';
import type { ThreadStatus, Topic } from '../shared/types.js';
import { newId } from './ids.js';

function afterPlayerMessage(status: ThreadStatus | null): { status: 'waiting'; reopened: boolean; startsWaiting: boolean } {
  return { status: 'waiting', reopened: status === 'closed', startsWaiting: status !== 'waiting' };
}

function afterReply(status: ThreadStatus): { ok: true; status: 'answered' } | { ok: false; code: 'thread_closed' } {
  return status === 'closed' ? { ok: false, code: 'thread_closed' } : { ok: true, status: 'answered' };
}

function afterClose(status: ThreadStatus): { ok: true; status: 'closed' } | { ok: false; code: 'not_answered' | 'already_closed' } {
  if (status === 'answered') return { ok: true, status: 'closed' };
  return { ok: false, code: status === 'waiting' ? 'not_answered' : 'already_closed' };
}

export interface ThreadRow {
  id: string;
  game_id: string;
  player_id: string;
  topic: Topic;
  status: ThreadStatus;
  waiting_since: Date | null;
  last_player_message_at: Date;
}

export async function lockThreadByPlayer(tx: PoolClient, gameId: string, playerId: string): Promise<ThreadRow | null> {
  const { rows } = await tx.query<ThreadRow>('select * from threads where game_id = $1 and player_id = $2 for update', [gameId, playerId]);
  return rows[0] ?? null;
}

async function lockThread(tx: PoolClient, threadId: string): Promise<ThreadRow> {
  const { rows } = await tx.query<ThreadRow>('select * from threads where id = $1 for update', [threadId]);
  return rows[0] as ThreadRow;
}

export async function recordPlayerMessage(
  tx: PoolClient,
  input: { gameId: string; playerId: string; topic: Topic; body: string; now: Date; existing: ThreadRow | null },
): Promise<{ messageId: string; threadId: string; status: ThreadStatus }> {
  const change = afterPlayerMessage(input.existing?.status ?? null);
  const messageId = newId();
  await tx.query(
    'insert into messages (id, game_id, player_id, kind, body, reopened, created_at) values ($1, $2, $3, $4, $5, $6, $7)',
    [messageId, input.gameId, input.playerId, 'player', input.body, change.reopened, input.now],
  );
  const waitingSince = change.startsWaiting ? input.now : (input.existing?.waiting_since ?? input.now);
  if (input.existing) {
    await tx.query('update threads set status = $2, waiting_since = $3, last_player_message_at = $4 where id = $1', [
      input.existing.id, change.status, waitingSince, input.now,
    ]);
    return { messageId, threadId: input.existing.id, status: change.status };
  }
  const threadId = newId();
  await tx.query(
    'insert into threads (id, game_id, player_id, topic, status, waiting_since, last_player_message_at) values ($1, $2, $3, $4, $5, $6, $7)',
    [threadId, input.gameId, input.playerId, input.topic, change.status, waitingSince, input.now],
  );
  return { messageId, threadId, status: change.status };
}

export async function recordReply(
  tx: PoolClient,
  input: { threadId: string; staffId: string; readBody: () => string; now: Date },
): Promise<{ ok: true; messageId: string; body: string; thread: ThreadRow } | { ok: false; code: 'thread_closed' }> {
  const thread = await lockThread(tx, input.threadId);
  const change = afterReply(thread.status);
  if (!change.ok) return change;
  const body = input.readBody();
  const messageId = newId();
  await tx.query(
    'insert into messages (id, game_id, player_id, kind, author_id, body, created_at) values ($1, $2, $3, $4, $5, $6, $7)',
    [messageId, thread.game_id, thread.player_id, 'reply', input.staffId, body, input.now],
  );
  await tx.query('update threads set status = $2, waiting_since = null where id = $1', [thread.id, change.status]);
  return { ok: true, messageId, body, thread: { ...thread, status: change.status, waiting_since: null } };
}

export async function recordClose(
  tx: PoolClient,
  threadId: string,
  now: Date,
): Promise<{ ok: true; status: ThreadStatus } | { ok: false; code: 'not_answered' | 'already_closed' }> {
  const thread = await lockThread(tx, threadId);
  const change = afterClose(thread.status);
  if (!change.ok) return change;
  await tx.query('update threads set status = $2, waiting_since = null where id = $1', [thread.id, change.status]);
  await tx.query('insert into thread_closes (thread_id, closed_at) values ($1, $2)', [thread.id, now]);
  return { ok: true, status: change.status };
}

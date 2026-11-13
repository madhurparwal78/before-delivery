import { one, query, withTransaction } from '../db';
import { newId } from '../ids';
import { publish } from '../bus';
import { ApiError } from '../errors';
import {
  CLOSABLE_FROM,
  closeConflict,
  isReopen,
  statusAfterPlayerMessage,
  statusAfterReply,
  waitingSinceAfterPlayerMessage,
} from '../domain/threads';
import { playerMessageForensics, eventForensics, linkLine, isSettled } from '../domain/verdicts';
import { resolveLinkStage } from '../domain/unfurl';
import type { SanitiserResult } from '../../shared/sanitiser';
import type { ForensicsLine, ThreadMessage, ThreadStatus, Topic } from '../../shared/types';
import type { GameRow } from './games';
import type { PlayerRow } from './players';
import type { StoredEvent } from './threads';

export interface CreatedMessage {
  message: ThreadMessage;
  threadId: string;
  status: ThreadStatus;
  topic: Topic;
}

interface ThreadStateRow {
  id: string;
  topic: Topic;
  status: ThreadStatus;
  waiting_since: Date | null;
  reopens: number;
}

export async function createPlayerMessage(args: {
  game: GameRow;
  player: PlayerRow;
  topic: Topic;
  body: string;
  sanitised: SanitiserResult;
  bucket: { previous: number; level: number };
}): Promise<CreatedMessage> {
  const forensics = playerMessageForensics(args.sanitised, args.bucket, null);
  const created = await withTransaction(async (client) => {
    const existing = await client.query<ThreadStateRow>(
      `SELECT id, topic, status, waiting_since, reopens FROM threads WHERE player_row_id = $1 FOR UPDATE`,
      [args.player.id],
    );
    const current = existing.rows[0] ?? null;
    const at = new Date();
    let threadId: string;
    let topic: Topic;
    if (current === null) {
      threadId = newId('thr');
      topic = args.topic;
      await client.query(
        `INSERT INTO threads (id, game_id, player_row_id, topic, status, created_at,
            last_player_message_at, waiting_since)
          VALUES ($1, $2, $3, $4, 'waiting', $5, $5, $5)`,
        [threadId, args.game.id, args.player.id, topic, at],
      );
    } else {
      threadId = current.id;
      topic = current.topic;
      const status = statusAfterPlayerMessage();
      const waitingSince = waitingSinceAfterPlayerMessage(current.status, current.waiting_since, at);
      await client.query(
        `UPDATE threads SET status = $2, last_player_message_at = $3, waiting_since = $4,
            reopens = reopens + $5 WHERE id = $1`,
        [threadId, status, at, waitingSince, isReopen(current.status) ? 1 : 0],
      );
    }
    const messageId = newId('msg');
    await client.query(
      `INSERT INTO messages (id, game_id, thread_id, player_row_id, kind, author_role, author_name,
          body, created_at, forensics)
        VALUES ($1, $2, $3, $4, 'player', 'player', $5, $6, $7, $8::jsonb)`,
      [
        messageId,
        args.game.id,
        threadId,
        args.player.id,
        args.player.name,
        args.body,
        at,
        JSON.stringify(forensics),
      ],
    );
    await client.query(
      `UPDATE messages SET thread_id = $1 WHERE player_row_id = $2 AND thread_id IS NULL`,
      [threadId, args.player.id],
    );
    return { messageId, threadId, topic, at };
  });

  publish({
    kind: 'thread',
    gameId: args.game.id,
    threadId: created.threadId,
    topic: created.topic,
    status: 'waiting',
    playerName: args.player.name,
    reason: 'player_message',
    receiptRelated: false,
  });
  void settleLinkStage(created.messageId, args.sanitised.after, args.game.id, created.threadId, created.topic, args.player.name);

  return {
    message: {
      id: created.messageId,
      kind: 'player',
      author: { role: 'player', name: args.player.name },
      body: args.body,
      created_at: created.at.toISOString(),
      attachments: [],
      unfurl: null,
      event: null,
    },
    threadId: created.threadId,
    status: 'waiting',
    topic: created.topic,
  };
}

async function settleLinkStage(
  messageId: string,
  after: string,
  gameId: string,
  threadId: string,
  topic: Topic,
  playerName: string,
): Promise<void> {
  const stage = await resolveLinkStage(after);
  const row = await one<{ forensics: ForensicsLine[] }>(
    `SELECT forensics FROM messages WHERE id = $1`,
    [messageId],
  );
  if (!row) return;
  const lines = row.forensics.map((line) => (line.stage === 'link' ? linkLine(stage) : line));
  await query(`UPDATE messages SET forensics = $2::jsonb, unfurl = $3::jsonb WHERE id = $1`, [
    messageId,
    JSON.stringify(lines),
    stage.unfurl === null ? null : JSON.stringify(stage.unfurl),
  ]);
  publish({
    kind: 'forensics',
    messageId,
    body: { message_id: messageId, settled: isSettled(lines), lines },
  });
  if (stage.unfurl !== null) {
    publish({
      kind: 'thread',
      gameId,
      threadId,
      topic,
      status: 'waiting',
      playerName,
      reason: 'player_message',
      receiptRelated: false,
    });
  }
}

export async function createReply(args: {
  gameId: string;
  threadId: string;
  authorRole: 'developer' | 'moderator';
  authorName: string;
  body: string;
}): Promise<CreatedMessage & { playerName: string }> {
  const created = await withTransaction(async (client) => {
    const existing = await client.query<ThreadStateRow & { player_row_id: string; player_name: string }>(
      `SELECT t.id, t.topic, t.status, t.waiting_since, t.reopens, t.player_row_id, p.name AS player_name
         FROM threads t JOIN players p ON p.id = t.player_row_id WHERE t.id = $1 FOR UPDATE OF t`,
      [args.threadId],
    );
    const thread = existing.rows[0];
    if (!thread) throw new ApiError(404, 'not_found');
    const status = statusAfterReply(thread.status);
    const at = new Date();
    const messageId = newId('msg');
    await client.query(
      `INSERT INTO messages (id, game_id, thread_id, player_row_id, kind, author_role, author_name,
          body, created_at, forensics)
        VALUES ($1, $2, $3, $4, 'reply', $5, $6, $7, $8, '[]'::jsonb)`,
      [
        messageId,
        args.gameId,
        args.threadId,
        thread.player_row_id,
        args.authorRole,
        args.authorName,
        args.body,
        at,
      ],
    );
    await client.query(
      `UPDATE threads SET status = $2, waiting_since = NULL, first_reply_at = COALESCE(first_reply_at, $3)
         WHERE id = $1`,
      [args.threadId, status, at],
    );
    return { messageId, at, status, topic: thread.topic, playerName: thread.player_name };
  });

  publish({
    kind: 'thread',
    gameId: args.gameId,
    threadId: args.threadId,
    topic: created.topic,
    status: created.status,
    playerName: created.playerName,
    reason: 'reply',
    receiptRelated: false,
  });

  return {
    message: {
      id: created.messageId,
      kind: 'reply',
      author: { role: args.authorRole, name: args.authorName },
      body: args.body,
      created_at: created.at.toISOString(),
      attachments: [],
      unfurl: null,
      event: null,
    },
    threadId: args.threadId,
    status: created.status,
    topic: created.topic,
    playerName: created.playerName,
  };
}

export async function closeThread(args: {
  gameId: string;
  threadId: string;
  topic: Topic;
  playerName: string;
}): Promise<void> {
  const closed = await one<{ id: string }>(
    `UPDATE threads SET status = 'closed', waiting_since = NULL,
        first_closed_at = COALESCE(first_closed_at, now()), last_closed_at = now()
      WHERE id = $1 AND status = $2 RETURNING id`,
    [args.threadId, CLOSABLE_FROM],
  );
  if (!closed) {
    const current = await one<{ status: ThreadStatus }>(`SELECT status FROM threads WHERE id = $1`, [
      args.threadId,
    ]);
    throw closeConflict(current?.status ?? 'waiting');
  }
  publish({
    kind: 'thread',
    gameId: args.gameId,
    threadId: args.threadId,
    topic: args.topic,
    status: 'closed',
    playerName: args.playerName,
    reason: 'close',
    receiptRelated: false,
  });
}

export async function insertEventMessage(args: {
  client: { query: typeof query };
  gameId: string;
  threadId: string | null;
  playerRowId: string;
  event: StoredEvent;
  signatureVerdict: string;
  occurredAt: Date;
}): Promise<string> {
  const messageId = newId('msg');
  await args.client.query(
    `INSERT INTO messages (id, game_id, thread_id, player_row_id, kind, author_role, author_name,
        body, created_at, event, forensics)
      VALUES ($1, $2, $3, $4, 'event', 'game_server', 'Game server', NULL, $5, $6::jsonb, $7::jsonb)`,
    [
      messageId,
      args.gameId,
      args.threadId,
      args.playerRowId,
      args.occurredAt,
      JSON.stringify(args.event),
      JSON.stringify(eventForensics(args.signatureVerdict)),
    ],
  );
  return messageId;
}

// Shared thread reads and the one statistics/waiting_since decision.
import { query, transaction } from './db';
import { publish } from './live';
import { newId } from './crypto';
import { insertVerdict, playerVerdictBase, settleLink } from './forensics';
import { firstAddress, fetchLink } from './linkChecks';
import { serialiseAttachment, serialiseMessage, iso, type AttachmentRow, type MessageRow } from './serialise';
import type { Topic, ThreadStatus } from './domain';
import type { VerdictRecord } from './forensics';

const threadTopicsByGame = new Map<string, Map<string, Topic | null>>();

export function registerThreadTopic(gameId: string, threadId: string, topic: Topic | null): void {
  const map = threadTopicsByGame.get(gameId) ?? new Map<string, Topic | null>();
  map.set(threadId, topic);
  threadTopicsByGame.set(gameId, map);
}

export function threadTopicCache(gameId: string): Map<string, Topic | null> {
  const map = threadTopicsByGame.get(gameId) ?? new Map<string, Topic | null>();
  threadTopicsByGame.set(gameId, map);
  return map;
}

export interface ThreadRecord {
  id: string;
  game_id: string;
  player_id: string;
  topic: Topic;
  status: ThreadStatus;
  waiting_since: Date | null;
  last_player_message_at: Date | null;
  created_at: Date;
}

export interface ThreadStatistics {
  player_messages: number;
  replies: number;
  reopens: number;
  first_reply_at: string | null;
  first_closed_at: string | null;
  last_closed_at: string | null;
}

export async function loadThread(threadId: string): Promise<ThreadRecord | null> {
  const result = await query<ThreadRecord>(
    'SELECT id, game_id, player_id, topic, status, waiting_since, last_player_message_at, created_at FROM threads WHERE id = $1',
    [threadId],
  );
  return result.rows[0] ?? null;
}

export async function threadStatistics(threadId: string): Promise<ThreadStatistics> {
  const counts = await query<{ player_messages: number; replies: number; reopens: number }>(
    `SELECT
       (SELECT count(*)::int FROM messages WHERE thread_id=$1 AND kind='player') AS player_messages,
       (SELECT count(*)::int FROM messages WHERE thread_id=$1 AND kind='reply') AS replies,
       (SELECT count(*)::int FROM reopens WHERE thread_id=$1) AS reopens`,
    [threadId],
  );
  const times = await query<{ first_reply_at: Date | null; first_closed_at: Date | null; last_closed_at: Date | null }>(
    `SELECT
       (SELECT m.created_at FROM messages m WHERE m.thread_id=$1 AND m.kind='reply' ORDER BY m.created_at ASC, m.id ASC LIMIT 1) AS first_reply_at,
       (SELECT MIN(closed_at) FROM closes WHERE thread_id=$1) AS first_closed_at,
       (SELECT MAX(closed_at) FROM closes WHERE thread_id=$1) AS last_closed_at`,
    [threadId],
  );
  const row = counts.rows[0];
  const time = times.rows[0];
  return {
    player_messages: row.player_messages,
    replies: row.replies,
    reopens: row.reopens,
    first_reply_at: iso(time.first_reply_at),
    first_closed_at: iso(time.first_closed_at),
    last_closed_at: iso(time.last_closed_at),
  };
}

export interface MessageWithExtras extends MessageRow {
  attachments: AttachmentRow[];
  unfurl: Record<string, unknown> | null;
}

export async function threadMessages(threadId: string, gameId: string, includeRefused: boolean): Promise<MessageWithExtras[]> {
  const messages = await query<MessageRow>(
    'SELECT * FROM messages WHERE thread_id = $1 AND game_id = $2 ORDER BY created_at ASC, id ASC',
    [threadId, gameId],
  );
  if (messages.rows.length === 0) return [];
  const ids = messages.rows.map((row) => row.id);
  const attachments = await query<AttachmentRow>(
    'SELECT id, message_id, filename, content_type, size, status FROM attachments WHERE message_id = ANY($1) ORDER BY created_at, id',
    [ids],
  );
  const verdicts = await query<{ message_id: string; link_verdict: string; link_title: string | null; link_description: string | null; link_url: string | null }>(
    'SELECT message_id, link_verdict, link_title, link_description, link_url FROM verdicts WHERE message_id = ANY($1)',
    [ids],
  );
  const byMessage = new Map(verdicts.rows.map((row) => [row.message_id, row]));
  const grouped = new Map<string, AttachmentRow[]>();
  for (const row of attachments.rows) {
    const list = grouped.get(row.message_id) ?? [];
    list.push(row);
    grouped.set(row.message_id, list);
  }
  const out: MessageWithExtras[] = [];
  for (const row of messages.rows) {
    if (row.kind === 'event' && row.event_verdict === 'refused' && !includeRefused) continue;
    const verdict = byMessage.get(row.id);
    const unfurl = verdict && verdict.link_verdict === 'fetched' && verdict.link_title
      ? { url: verdict.link_url, title: verdict.link_title, description: verdict.link_description }
      : null;
    out.push({ ...row, attachments: grouped.get(row.id) ?? [], unfurl });
  }
  return out;
}

export function serialiseThreadMessages(rows: MessageWithExtras[], includeRefused: boolean): Record<string, unknown>[] {
  return rows
    .filter((row) => !(row.kind === 'event' && row.event_verdict === 'refused' && !includeRefused))
    .map((row) => serialiseMessage(row, row.attachments, row.unfurl, true));
}

export interface PlayerSendResult {
  messageId: string;
  threadId: string;
  status: ThreadStatus;
  createdThread: boolean;
}

export async function storePlayerMessage(options: {
  gameId: string;
  gameSlug: string;
  gameName: string;
  playerId: string;
  playerName: string;
  body: string;
  topic: Topic | null;
  bucket: { previous: number; level: number };
}): Promise<PlayerSendResult> {
  const thread = await query<ThreadRecord>('SELECT id, status, topic FROM threads WHERE game_id=$1 AND player_id=$2', [options.gameId, options.playerId]);
  let threadId: string;
  let createdThread = false;
  let previous: ThreadStatus | null = null;
  let topic: Topic;
  if (thread.rows.length === 0) {
    if (options.topic === null) throw new Error('topic required');
    threadId = newId('thr');
    topic = options.topic;
    createdThread = true;
    await transaction(async (client) => {
      await client.query(
        'INSERT INTO threads (id, game_id, player_id, topic, status) VALUES ($1,$2,$3,$4,\'waiting\')',
        [threadId, options.gameId, options.playerId, options.topic],
      );
    });
  } else {
    threadId = thread.rows[0].id;
    previous = thread.rows[0].status;
    topic = thread.rows[0].topic;
  }
  const messageId = newId('msg');
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO messages (id, thread_id, game_id, kind, author_role, author_name, body, created_at)
       VALUES ($1,$2,$3,'player','player',$4,$5,now())`,
      [messageId, threadId, options.gameId, options.playerName, options.body],
    );
    if (previous === 'closed') {
      await client.query('INSERT INTO reopens (thread_id, message_id) VALUES ($1,$2)', [threadId, messageId]);
    }
    await client.query(
      `UPDATE threads
          SET status = 'waiting',
              last_player_message_at = now(),
              waiting_since = CASE WHEN status IN ('answered','closed') THEN now() ELSE waiting_since END
        WHERE id = $1`,
      [threadId],
    );
  });
  registerThreadTopic(options.gameId, threadId, topic);
  const verdict: VerdictRecord = playerVerdictBase(options.body, options.bucket);
  await insertVerdict(messageId, verdict);
  const link = firstAddress(verdict.sanitiser_after ?? '');
  if (link !== null) {
    void (async () => {
      try {
        const result = await fetchLink(link);
        await settleLink(messageId, result.verdict, result.address, result.title, result.description, link);
        publish({ event: 'message', gameId: options.gameId, threadId, payload: { message_id: messageId, refused: false, link_settled: true } });
      } catch {
        await settleLink(messageId, 'failed: unreachable', null, null, null, link);
      }
    })();
  } else {
    await settleLink(messageId, 'no link', null, null, null, null);
  }
  publish({ event: 'message', gameId: options.gameId, threadId, payload: { message_id: messageId, refused: false, player_message: true } });
  publish({ event: 'thread_status', gameId: options.gameId, threadId, payload: { status: 'waiting', player_id: options.playerId } });
  return { messageId, threadId, status: 'waiting', createdThread };
}

export async function storeReply(options: {
  gameId: string;
  threadId: string;
  authorId: string;
  authorName: string;
  authorRole: 'developer' | 'moderator';
  body: string;
}): Promise<{ messageId: string }> {
  const messageId = newId('msg');
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO messages (id, thread_id, game_id, kind, author_role, author_name, body, created_at)
       VALUES ($1,$2,$3,'reply',$4,$5,$6,now())`,
      [messageId, options.threadId, options.gameId, options.authorRole, options.authorName, options.body],
    );
    await client.query('UPDATE threads SET status=\'answered\', waiting_since=NULL WHERE id=$1', [options.threadId]);
  });
  await insertVerdict(messageId, {
    signature_verdict: 'signature valid',
    signature_secret: 'current',
    bucket_previous: null,
    bucket_level: null,
    bucket_capacity: null,
    sanitiser_verdict: 'no player text',
    sanitiser_before: null,
    sanitiser_after: null,
    sanitiser_removed: [],
    link_verdict: 'no link',
    link_url: null,
    link_address: null,
    link_title: null,
    link_description: null,
  });
  publish({ event: 'message', gameId: options.gameId, threadId: options.threadId, payload: { message_id: messageId, refused: false, reply: true } });
  publish({ event: 'thread_status', gameId: options.gameId, threadId: options.threadId, payload: { status: 'answered' } });
  return { messageId };
}

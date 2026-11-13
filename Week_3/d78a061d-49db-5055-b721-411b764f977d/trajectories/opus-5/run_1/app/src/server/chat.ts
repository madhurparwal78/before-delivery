import { randomUUID } from 'node:crypto';
import { pool, query } from './db.js';
import { errors } from './errors.js';
import { nextSeq } from './realtime/streams.js';
import { publish } from './realtime/bus.js';
import { CHAT_MAX, CHAT_WINDOW_MAX, CHAT_WINDOW_SECONDS } from '../shared/constants.js';
import { graphemeLength } from '../shared/text.js';
import { t, type Locale, type MessageKey } from '../shared/i18n/index.js';
import type { ChatMessage } from '../shared/types.js';

export type SystemCode =
  | 'joined'
  | 'left'
  | 'leader'
  | 'ready_started'
  | 'ready_passed'
  | 'ready_failed'
  | 'dropped'
  | 'rejoined'
  | 'removed';

export interface ChatRow {
  id: string;
  channel: string;
  seq: string | number;
  kind: 'user' | 'system';
  author_id: string | null;
  author_name: string | null;
  body: string | null;
  code: string | null;
  params: Record<string, string | number>;
  created_at: Date | string;
}

export function chatStream(channel: string): string {
  return `chat:${channel}`;
}

function systemText(locale: Locale, code: string, params: Record<string, string | number>): string {
  const key = `system.${code}` as MessageKey;
  const resolved: Record<string, string | number> = { ...params };
  if (typeof params.story_id === 'string') {
    resolved.story = t(locale, `story.${params.story_id}` as MessageKey);
  }
  return t(locale, key, resolved);
}

/** One place renders a stored message into the reader's own language. */
export function renderMessage(row: ChatRow, locale: Locale): ChatMessage {
  const created = row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at;
  return {
    id: row.id,
    seq: Number(row.seq),
    kind: row.kind,
    author:
      row.author_id === null || row.author_name === null
        ? null
        : { account_id: row.author_id, display_name: row.author_name },
    body: row.body,
    code: row.code,
    params: row.params,
    text: row.kind === 'system' ? systemText(locale, row.code ?? '', row.params) : (row.body ?? ''),
    created_at: created,
  };
}

const SELECT_MESSAGE = `
  SELECT m.id, m.channel, m.seq, m.kind, m.author_id, a.display_name AS author_name,
         m.body, m.code, m.params, m.created_at
  FROM chat_messages m LEFT JOIN accounts a ON a.id = m.author_id`;

export async function listMessages(channel: string, afterSeq: number): Promise<ChatRow[]> {
  return query<ChatRow>(
    `${SELECT_MESSAGE} WHERE m.channel = $1 AND m.seq > $2 ORDER BY m.seq LIMIT 100`,
    [channel, afterSeq],
  );
}

export async function messageBySeq(channel: string, seq: number): Promise<ChatRow | null> {
  const rows = await query<ChatRow>(`${SELECT_MESSAGE} WHERE m.channel = $1 AND m.seq = $2`, [
    channel,
    seq,
  ]);
  return rows[0] ?? null;
}

async function storedReplay(
  channel: string,
  accountId: string,
  clientMessageId: string,
): Promise<ChatRow | null> {
  const rows = await query<ChatRow>(
    `${SELECT_MESSAGE} WHERE m.channel = $1 AND m.author_id = $2 AND m.client_message_id = $3`,
    [channel, accountId, clientMessageId],
  );
  return rows[0] ?? null;
}

/** The single chat rate limit: 5 accepted messages per channel per rolling 10 seconds. */
async function assertWithinRateLimit(accountId: string, channel: string): Promise<void> {
  const rows = await query<{ created_at: Date }>(
    `SELECT created_at FROM chat_rate_events
     WHERE account_id = $1 AND channel = $2 AND created_at > now() - make_interval(secs => $3)
     ORDER BY created_at`,
    [accountId, channel, CHAT_WINDOW_SECONDS],
  );
  if (rows.length < CHAT_WINDOW_MAX) return;
  const oldest = rows[rows.length - CHAT_WINDOW_MAX].created_at.getTime();
  const retryMs = oldest + CHAT_WINDOW_SECONDS * 1000 - Date.now();
  throw errors.rateLimited(Math.max(1, Math.ceil(retryMs / 1000)));
}

export interface PostResult {
  row: ChatRow;
  replay: boolean;
}

export async function postUserMessage(input: {
  accountId: string;
  channel: string;
  clientMessageId: unknown;
  body: unknown;
}): Promise<PostResult> {
  const { accountId, channel } = input;
  if (typeof input.clientMessageId !== 'string' || input.clientMessageId === '') {
    throw errors.invalidField('client_message_id', { key: 'fb.generic' });
  }
  const clientMessageId = input.clientMessageId;
  const existing = await storedReplay(channel, accountId, clientMessageId);
  if (existing !== null) {
    if (existing.body !== (typeof input.body === 'string' ? input.body.trim() : null)) {
      throw errors.conflict('idempotency_conflict', { key: 'fb.generic' });
    }
    return { row: existing, replay: true };
  }

  await assertWithinRateLimit(accountId, channel);

  const body = typeof input.body === 'string' ? input.body.trim() : '';
  const length = graphemeLength(body);
  if (length < 1 || length > CHAT_MAX) {
    throw errors.invalidField('body', { key: 'fb.chatLimit' });
  }

  const id = randomUUID();
  const seq = await nextSeq(chatStream(channel));
  await pool.query(
    `INSERT INTO chat_messages (id, channel, seq, kind, author_id, body, client_message_id)
     VALUES ($1, $2, $3, 'user', $4, $5, $6)`,
    [id, channel, seq, accountId, body, clientMessageId],
  );
  await pool.query('INSERT INTO chat_rate_events (account_id, channel) VALUES ($1, $2)', [
    accountId,
    channel,
  ]);
  const row = await messageBySeq(channel, seq);
  if (row === null) throw errors.internal();
  // A chat message is its own stream event: the message's seq and id are the event's.
  await publish({ kind: 'event', stream: chatStream(channel), seq });
  return { row, replay: false };
}

export async function postSystemMessage(
  channel: string,
  code: SystemCode,
  params: Record<string, string | number> = {},
): Promise<void> {
  const seq = await nextSeq(chatStream(channel));
  await pool.query(
    `INSERT INTO chat_messages (id, channel, seq, kind, code, params)
     VALUES ($1, $2, $3, 'system', $4, $5)`,
    [randomUUID(), channel, seq, code, JSON.stringify(params)],
  );
  await publish({ kind: 'event', stream: chatStream(channel), seq });
}

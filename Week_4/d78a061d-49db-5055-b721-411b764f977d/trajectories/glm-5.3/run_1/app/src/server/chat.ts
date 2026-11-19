import { query, transaction, type DBClient } from './db.js';
import { CHAT_LIMIT, countChars, CHAT_WINDOW_MESSAGES, CHAT_WINDOW_SECONDS } from '../shared/domain.js';

export type ChatMessageRow = {
  id: string;
  channel: string;
  seq: number;
  kind: 'user' | 'system';
  author: { account_id: string; display_name: string } | null;
  body: string | null;
  code: string | null;
  params: Record<string, string> | null;
  created_at: Date;
};

export function messageJson(m: ChatMessageRow, locale: 'en' | 'ja' | 'es'): Record<string, unknown> {
  const { tr } = require('../shared/i18n.js') as typeof import('../shared/i18n.js');
  let text = m.body ?? '';
  if (m.kind === 'system' && m.code) {
    text = tr(locale, 'system', m.code, m.params ?? {});
  }
  return {
    id: m.id,
    seq: Number(m.seq),
    kind: m.kind,
    author: m.author,
    body: m.body,
    code: m.code,
    params: m.params ?? {},
    text,
    created_at: m.created_at.toISOString(),
  };
}

export async function channelExists(channel: string): Promise<boolean> {
  if (channel === 'lobby') return true;
  if (channel.startsWith('party-')) {
    const res = await query('select 1 from parties where id = $1', [channel.slice('party-'.length)]);
    return res.rows.length > 0;
  }
  if (channel.startsWith('session-')) {
    const res = await query("select 1 from sessions_world where id = $1 and status = 'running'", [channel.slice('session-'.length)]);
    return res.rows.length > 0;
  }
  return false;
}

export async function nextSeq(client: DBClient | null, channel: string): Promise<number> {
  if (client) {
    const res = await client.query<{ last_seq: string }>('insert into chat_channels (channel, last_seq) values ($1, 0) on conflict (channel) do update set last_seq = chat_channels.last_seq + 1 returning last_seq', [channel]);
    return Number(res.rows[0]?.last_seq ?? 0);
  }
  return transaction(async (tx) => nextSeq(tx, channel));
}

export async function appendChatMessage(
  client: DBClient | null,
  channel: string,
  payload: { kind: 'user'; authorId: string; authorName: string; body: string; clientMessageId: string } | { kind: 'system'; code: string; params: Record<string, string> },
): Promise<ChatMessageRow> {
  const id = crypto.randomUUID();
  const seq = await nextSeq(client, channel);
  const executor: { query: Function } = client ?? (await import('./db.js')).pool;
  const res = await executor.query(
    `insert into chat_messages (id, channel, seq, kind, author, body, code, params, client_message_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning id, channel, seq, kind, author, body, code, params, created_at`,
    [
      id,
      channel,
      seq,
      payload.kind,
      payload.kind === 'user' ? payload.authorId : null,
      payload.kind === 'user' ? payload.body : null,
      payload.kind === 'system' ? payload.code : null,
      payload.kind === 'system' ? JSON.stringify(payload.params) : null,
      payload.kind === 'user' ? payload.clientMessageId : null,
    ],
  );
  const row = res.rows[0] as unknown as ChatMessageRow;
  const { publishChatEvent } = await import('./realtime.js');
  await publishChatEvent(channel, row);
  return row;
}

export async function messagesAfter(channel: string, afterSeq: number, limit = 100): Promise<ChatMessageRow[]> {
  const res = await query<ChatMessageRow & { author_id: string | null; author_name: string | null }>(
    `select m.id, m.channel, m.seq, m.kind, m.body, m.code, m.params, m.created_at, a.id as author_id, a.display_name as author_name
       from chat_messages m left join accounts a on a.id = m.author
      where m.channel = $1 and m.seq > $2 order by m.seq asc limit $3`,
    [channel, afterSeq, limit],
  );
  return res.rows.map((row) => ({
    id: row.id,
    channel: row.channel,
    seq: Number(row.seq),
    kind: row.kind,
    author: row.author_id ? { account_id: row.author_id, display_name: row.author_name ?? '' } : null,
    body: row.body,
    code: row.code,
    params: row.params,
    created_at: row.created_at,
  }));
}

export async function findStoredClientMessage(channel: string, clientMessageId: string): Promise<ChatMessageRow | null> {
  const res = await query<ChatMessageRow & { author_id: string | null; author_name: string | null }>(
    `select m.id, m.channel, m.seq, m.kind, m.body, m.code, m.params, m.created_at, m.client_message_id, a.id as author_id, a.display_name as author_name
       from chat_messages m left join accounts a on a.id = m.author
      where m.channel = $1 and m.client_message_id = $2`,
    [channel, clientMessageId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    channel: row.channel,
    seq: Number(row.seq),
    kind: row.kind,
    author: row.author_id ? { account_id: row.author_id, display_name: row.author_name ?? '' } : null,
    body: row.body,
    code: row.code,
    params: row.params,
    created_at: row.created_at,
  };
}

export type RateVerdict = { allowed: true } | { allowed: false; retryAfter: number };

/** The chat rate limit (DP-47), decided in this one function. */
export async function checkRate(accountId: string, channel: string): Promise<RateVerdict> {
  const res = await query<{ created_at: Date }>(
    `select created_at from chat_messages
      where channel = $1 and author = $2 and kind = 'user'
      order by created_at desc limit $3`,
    [channel, accountId, CHAT_WINDOW_MESSAGES],
  );
  const rows = res.rows.map((r) => r.created_at.getTime());
  if (rows.length < CHAT_WINDOW_MESSAGES) return { allowed: true };
  const oldest = rows[rows.length - 1] ?? 0;
  const elapsed = (Date.now() - oldest) / 1000;
  if (elapsed >= CHAT_WINDOW_SECONDS) return { allowed: true };
  const retryAfter = Math.max(1, Math.ceil(CHAT_WINDOW_SECONDS - elapsed));
  return { allowed: false, retryAfter };
}

export function bodyLengthOk(body: string): boolean {
  const length = countChars(body);
  return length >= 1 && length <= CHAT_LIMIT;
}

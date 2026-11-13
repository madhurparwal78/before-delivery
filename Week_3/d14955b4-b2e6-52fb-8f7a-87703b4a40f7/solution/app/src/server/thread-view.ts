import type { Currency } from '../shared/amount.js';
import type { Author, EventBody, MessageBody, ThreadBody, ThreadStatistics, Topic, WidgetThreadBody } from '../shared/types.js';
import { attachmentBody } from './attachments.js';
import type { AttachmentRow } from './attachments.js';
import type { Db } from './db.js';
import { derivePurchases, refundApplied } from './ledger.js';
import type { EventRow } from './ledger.js';
import type { ThreadRow } from './threads.js';

interface MessageRow extends EventRow {
  id: string;
  kind: 'player' | 'reply' | 'event';
  body: string | null;
  reopened: boolean;
  created_at: Date;
  staff_name: string | null;
  staff_role: 'developer' | 'moderator' | null;
  player_name: string;
  occurred_at: Date | null;
  match_id: string | null;
  mode: string | null;
  result: 'won' | 'lost' | 'abandoned' | null;
  duration_seconds: number | null;
}

export type ThreadSource = ThreadRow & { player_name: string };

export async function findThread(db: Db, gameId: string, threadId: string): Promise<ThreadSource | null> {
  const { rows } = await db.query<ThreadSource>(
    'select t.*, p.name as player_name from threads t join players p on p.game_id = t.game_id and p.id = t.player_id where t.id = $1 and t.game_id = $2',
    [threadId, gameId],
  );
  return rows[0] ?? null;
}

const iso = (date: Date): string => date.toISOString();

export function isPurchaseEvent(type: string | null): boolean {
  return type === 'purchase.receipt' || type === 'purchase.refunded';
}

async function loadMessageRows(db: Db, thread: ThreadRow): Promise<MessageRow[]> {
  const { rows } = await db.query<MessageRow>(
    `select m.id, m.kind, m.body, m.reopened, m.created_at, s.name as staff_name, s.role as staff_role, p.name as player_name,
            e.type, e.verdict, e.occurred_at, e.receipt_id, e.refund_id, e.item, e.amount_minor, e.currency, e.match_id, e.mode, e.result, e.duration_seconds,
            m.id as message_id
       from messages m
       join players p on p.game_id = m.game_id and p.id = m.player_id
       left join staff s on s.id = m.author_id
       left join events e on e.message_id = m.id
      where m.game_id = $1 and m.player_id = $2
      order by m.created_at, m.seq`,
    [thread.game_id, thread.player_id],
  );
  return rows;
}

export async function loadPurchases(db: Db, thread: ThreadRow): Promise<ReturnType<typeof derivePurchases>> {
  const rows = await loadMessageRows(db, thread);
  return derivePurchases(rows.filter((row) => row.type !== null));
}

function authorOf(row: MessageRow, audience: 'staff' | 'widget', gameName: string): Author {
  if (row.kind === 'player') return { role: 'player', name: row.player_name };
  if (row.kind === 'event') return { role: 'game_server', name: 'Game server' };
  if (audience === 'widget') return { role: 'support', name: `${gameName} support` };
  return { role: row.staff_role as 'developer' | 'moderator', name: row.staff_name as string };
}

function eventOf(row: MessageRow, purchases: ReturnType<typeof derivePurchases>): EventBody {
  return {
    type: row.type,
    verdict: row.verdict,
    receipt_id: row.receipt_id,
    refund_id: row.refund_id,
    refund_applied: row.verdict === 'accepted' && row.type === 'purchase.refunded' ? refundApplied(row, purchases) : null,
    item: row.item,
    amount_minor: row.amount_minor,
    currency: row.currency as Currency | null,
    match_id: row.match_id,
    mode: row.mode,
    result: row.result,
    duration_seconds: row.duration_seconds,
  };
}

interface Assembled {
  messages: MessageBody[];
  purchases: ReturnType<typeof derivePurchases>;
  rows: MessageRow[];
}

async function assemble(db: Db, thread: ThreadRow, audience: 'staff' | 'widget', gameName: string, keep: (row: MessageRow) => boolean): Promise<Assembled> {
  const all = await loadMessageRows(db, thread);
  const purchases = derivePurchases(all.filter((row) => row.type !== null));
  const rows = all.filter(keep);
  const ids = rows.map((row) => row.id);
  const attachments = ids.length === 0 ? [] : (await db.query<AttachmentRow>('select id, message_id, filename, content_type, size, status from attachments where message_id = any($1) order by seq', [ids])).rows;
  const previews = ids.length === 0 ? [] : (await db.query<{ message_id: string; url: string; title: string; description: string | null }>('select message_id, url, title, description from link_previews where message_id = any($1)', [ids])).rows;
  const messages = rows.map((row): MessageBody => {
    const preview = previews.find((candidate) => candidate.message_id === row.id);
    return {
      id: row.id,
      kind: row.kind,
      author: authorOf(row, audience, gameName),
      body: row.kind === 'event' ? null : row.body,
      created_at: iso(row.created_at),
      attachments: attachments.filter((attachment) => attachment.message_id === row.id).map(attachmentBody),
      unfurl: preview ? { url: preview.url, title: preview.title, description: preview.description } : null,
      event: row.kind === 'event' ? eventOf(row, purchases) : null,
    };
  });
  return { messages, purchases, rows };
}

async function statistics(db: Db, thread: ThreadRow, rows: MessageRow[]): Promise<ThreadStatistics> {
  const replies = rows.filter((row) => row.kind === 'reply');
  const { rows: closes } = await db.query<{ first: Date | null; last: Date | null }>(
    'select min(closed_at) as first, max(closed_at) as last from thread_closes where thread_id = $1',
    [thread.id],
  );
  const [range] = closes;
  return {
    player_messages: rows.filter((row) => row.kind === 'player').length,
    replies: replies.length,
    reopens: rows.filter((row) => row.reopened).length,
    first_reply_at: replies[0] ? iso(replies[0].created_at) : null,
    first_closed_at: range?.first ? iso(range.first) : null,
    last_closed_at: range?.last ? iso(range.last) : null,
  };
}

export async function buildStaffThread(db: Db, thread: ThreadSource, receipts: boolean): Promise<ThreadBody> {
  const { messages, purchases, rows } = await assemble(db, thread, 'staff', '', (row) => receipts || !isPurchaseEvent(row.type));
  return {
    id: thread.id,
    status: thread.status,
    topic: thread.topic,
    player: { id: thread.player_id, name: thread.player_name },
    messages,
    purchases: receipts ? purchases : [],
    statistics: await statistics(db, thread, rows),
    waiting_since: thread.waiting_since ? iso(thread.waiting_since) : null,
  };
}

export async function buildWidgetThread(db: Db, thread: ThreadSource, gameName: string): Promise<WidgetThreadBody> {
  const { messages, purchases } = await assemble(db, thread, 'widget', gameName, (row) => row.verdict !== 'refused');
  return { id: thread.id, status: thread.status, topic: thread.topic, player: { id: thread.player_id, name: thread.player_name }, messages, purchases };
}

export async function findMessage(db: Db, gameId: string, messageId: string): Promise<{ id: string; kind: 'player' | 'reply' | 'event'; player_id: string; type: string | null; thread_id: string | null; topic: Topic | null } | null> {
  const { rows } = await db.query(
    `select m.id, m.kind, m.player_id, e.type, t.id as thread_id, t.topic
       from messages m left join events e on e.message_id = m.id left join threads t on t.game_id = m.game_id and t.player_id = m.player_id
      where m.id = $1 and m.game_id = $2`,
    [messageId, gameId],
  );
  return rows[0] ?? null;
}

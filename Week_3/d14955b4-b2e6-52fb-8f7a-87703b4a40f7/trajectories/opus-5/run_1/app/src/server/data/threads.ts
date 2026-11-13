import { one, query } from '../db';
import { notFound } from '../errors';
import { buildPurchase, refundApplied, type PurchaseRecord, type RefundRecord } from '../domain/ledger';
import { cursorClause, decodeCursor, encodeCursor, orderClause } from '../domain/inbox';
import { may, permittedTopics, type Caller } from '../domain/permissions';
import type {
  Attachment,
  EventDetail,
  ForensicsLine,
  InboxBody,
  InboxRow,
  Purchase,
  ThreadBody,
  ThreadMessage,
  ThreadStatistics,
  ThreadStatus,
  Topic,
  Unfurl,
} from '../../shared/types';

export interface ThreadRow {
  id: string;
  game_id: string;
  player_row_id: string;
  topic: Topic;
  status: ThreadStatus;
  last_player_message_at: Date;
  waiting_since: Date | null;
  reopens: number;
  first_reply_at: Date | null;
  first_closed_at: Date | null;
  last_closed_at: Date | null;
  player_public_id: string;
  player_name: string;
}

const THREAD_COLUMNS = `t.id, t.game_id, t.player_row_id, t.topic, t.status, t.last_player_message_at,
  t.waiting_since, t.reopens, t.first_reply_at, t.first_closed_at, t.last_closed_at,
  p.player_id AS player_public_id, p.name AS player_name`;

export async function findThread(gameId: string, threadId: string): Promise<ThreadRow | null> {
  return one<ThreadRow>(
    `SELECT ${THREAD_COLUMNS} FROM threads t JOIN players p ON p.id = t.player_row_id
      WHERE t.id = $1 AND t.game_id = $2`,
    [threadId, gameId],
  );
}

/** Any thread of another game, or one the caller may not read, answers the same 404. */
export async function requireReadableThread(caller: Caller, threadId: string): Promise<ThreadRow> {
  const thread = await findThread(caller.gameId, threadId);
  if (!thread) throw notFound();
  if (!may(caller, 'read', thread.topic)) throw notFound();
  return thread;
}

interface MessageRow {
  id: string;
  thread_id: string | null;
  kind: 'player' | 'reply' | 'event';
  author_role: string;
  author_name: string;
  body: string | null;
  created_at: Date;
  event: StoredEvent | null;
  forensics: ForensicsLine[];
  unfurl: Unfurl | null;
}

export interface StoredEvent {
  type: string;
  verdict: 'accepted' | 'refused';
  receipt_id?: string | null;
  refund_id?: string | null;
  item?: string | null;
  amount_minor?: number | null;
  currency?: string | null;
  match_id?: string | null;
  mode?: string | null;
  result?: string | null;
  duration_seconds?: number | null;
}

interface AttachmentRow {
  id: string;
  message_id: string;
  filename: string;
  content_type: string;
  size: string | number;
  status: Attachment['status'];
}

export interface ThreadView {
  /** Refused records are shown to staff only. */
  includeRefused: boolean;
  /** Purchase and refund data, including the purchase list. */
  includeReceipts: boolean;
  gameName: string;
  forWidget: boolean;
}

export function viewForCaller(caller: Caller, thread: ThreadRow, gameName: string): ThreadView {
  return {
    includeRefused: true,
    includeReceipts: may(caller, 'receipts', thread.topic),
    gameName,
    forWidget: false,
  };
}

export function isReceiptEvent(event: StoredEvent | null): boolean {
  return event !== null && (event.type === 'purchase.receipt' || event.type === 'purchase.refunded');
}

async function loadPurchaseRecords(gameId: string, playerRowId: string): Promise<PurchaseRecord[]> {
  const result = await query<{ receipt_id: string; item: string; amount_minor: string; currency: string }>(
    `SELECT receipt_id, item, amount_minor, currency FROM purchases
      WHERE game_id = $1 AND player_row_id = $2 ORDER BY occurred_at ASC, receipt_id ASC`,
    [gameId, playerRowId],
  );
  return result.rows.map((row) => ({
    receipt_id: row.receipt_id,
    item: row.item,
    amount_minor: Number(row.amount_minor),
    currency: row.currency,
  }));
}

async function loadRefundRecords(gameId: string, playerRowId: string): Promise<RefundRecord[]> {
  const result = await query<{
    refund_id: string;
    receipt_id: string;
    amount_minor: string;
    currency: string;
  }>(
    `SELECT refund_id, receipt_id, amount_minor, currency FROM refunds
      WHERE game_id = $1 AND player_row_id = $2 ORDER BY occurred_at ASC, refund_id ASC`,
    [gameId, playerRowId],
  );
  return result.rows.map((row) => ({
    refund_id: row.refund_id,
    receipt_id: row.receipt_id,
    amount_minor: Number(row.amount_minor),
    currency: row.currency,
  }));
}

export async function loadPurchases(gameId: string, playerRowId: string): Promise<Purchase[]> {
  const [purchases, refunds] = await Promise.all([
    loadPurchaseRecords(gameId, playerRowId),
    loadRefundRecords(gameId, playerRowId),
  ]);
  return purchases.map((purchase) => buildPurchase(purchase, refunds));
}

function toEventDetail(stored: StoredEvent, purchases: readonly PurchaseRecord[]): EventDetail {
  const receiptId = stored.receipt_id ?? null;
  const purchase = receiptId === null ? undefined : purchases.find((entry) => entry.receipt_id === receiptId);
  const applied =
    stored.type === 'purchase.refunded' && stored.verdict === 'accepted'
      ? refundApplied(purchase, stored.currency ?? '')
      : null;
  return {
    type: stored.type,
    verdict: stored.verdict,
    receipt_id: receiptId,
    refund_id: stored.refund_id ?? null,
    refund_applied: applied,
    item: stored.item ?? null,
    amount_minor: stored.amount_minor ?? null,
    currency: stored.currency ?? null,
    match_id: stored.match_id ?? null,
    mode: stored.mode ?? null,
    result: stored.result ?? null,
    duration_seconds: stored.duration_seconds ?? null,
  };
}

function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    message_id: row.message_id,
    filename: row.filename,
    content_type: row.content_type,
    size: Number(row.size),
    status: row.status,
  };
}

export async function buildMessages(
  threadId: string,
  view: ThreadView,
  purchases: readonly PurchaseRecord[],
): Promise<ThreadMessage[]> {
  const rows = await query<MessageRow>(
    `SELECT id, thread_id, kind, author_role, author_name, body, created_at, event, forensics, unfurl
       FROM messages WHERE thread_id = $1 ORDER BY created_at ASC, seq ASC`,
    [threadId],
  );
  const visible = rows.rows.filter((row) => {
    if (row.event !== null) {
      if (row.event.verdict === 'refused' && !view.includeRefused) return false;
      if (isReceiptEvent(row.event) && !view.includeReceipts) return false;
    }
    return true;
  });
  const attachments = await query<AttachmentRow>(
    `SELECT id, message_id, filename, content_type, size, status FROM attachments
       WHERE message_id = ANY($1::text[]) ORDER BY created_at ASC`,
    [visible.map((row) => row.id)],
  );
  return visible.map((row) => {
    const own = attachments.rows.filter((entry) => entry.message_id === row.id).map(toAttachment);
    const author =
      row.kind === 'reply' && view.forWidget
        ? { role: 'support' as const, name: `${view.gameName} support` }
        : { role: row.author_role as ThreadMessage['author']['role'], name: row.author_name };
    return {
      id: row.id,
      kind: row.kind,
      author,
      body: row.body,
      created_at: row.created_at.toISOString(),
      attachments: own,
      unfurl: row.unfurl,
      event: row.event === null ? null : toEventDetail(row.event, purchases),
    };
  });
}

export async function loadStatistics(thread: ThreadRow): Promise<ThreadStatistics> {
  const counts = await one<{ player_messages: string; replies: string }>(
    `SELECT
       count(*) FILTER (WHERE kind = 'player') AS player_messages,
       count(*) FILTER (WHERE kind = 'reply') AS replies
     FROM messages WHERE thread_id = $1`,
    [thread.id],
  );
  return {
    player_messages: Number(counts?.player_messages ?? 0),
    replies: Number(counts?.replies ?? 0),
    reopens: thread.reopens,
    first_reply_at: thread.first_reply_at === null ? null : thread.first_reply_at.toISOString(),
    first_closed_at: thread.first_closed_at === null ? null : thread.first_closed_at.toISOString(),
    last_closed_at: thread.last_closed_at === null ? null : thread.last_closed_at.toISOString(),
  };
}

export async function buildThreadBody(thread: ThreadRow, view: ThreadView): Promise<ThreadBody> {
  const purchaseRecords = await loadPurchaseRecords(thread.game_id, thread.player_row_id);
  const messages = await buildMessages(thread.id, view, purchaseRecords);
  const purchases = view.includeReceipts ? await loadPurchases(thread.game_id, thread.player_row_id) : [];
  const body: ThreadBody = {
    id: thread.id,
    status: thread.status,
    topic: thread.topic,
    player: { id: thread.player_public_id, name: thread.player_name },
    messages,
    purchases,
  };
  if (!view.forWidget) {
    body.waiting_since = thread.waiting_since === null ? null : thread.waiting_since.toISOString();
    body.statistics = await loadStatistics(thread);
  }
  return body;
}

function searchClause(caller: Caller, q: string, params: unknown[]): string {
  if (q === '') return '';
  const needle = `%${q.replace(/([%_\\])/g, '\\$1')}%`;
  params.push(needle);
  const needleParam = params.length;
  params.push(permittedTopics(caller, 'receipts'));
  const receiptTopicsParam = params.length;
  return `AND (
      p.name ILIKE $${needleParam}
      OR p.player_id ILIKE $${needleParam}
      OR EXISTS (
        SELECT 1 FROM messages m
         WHERE m.thread_id = t.id AND m.kind = 'player' AND m.body ILIKE $${needleParam}
      )
      OR (
        t.topic = ANY($${receiptTopicsParam}::text[])
        AND EXISTS (
          SELECT 1 FROM purchases pu
           WHERE pu.game_id = t.game_id AND pu.player_row_id = t.player_row_id
             AND (pu.receipt_id ILIKE $${needleParam} OR pu.item ILIKE $${needleParam})
        )
      )
    )`;
}

function baseClause(caller: Caller, q: string): { clause: string; params: unknown[] } {
  const params: unknown[] = [caller.gameId, permittedTopics(caller, 'read')];
  const clause = `FROM threads t JOIN players p ON p.id = t.player_row_id
    WHERE t.game_id = $1 AND t.topic = ANY($2::text[]) ${searchClause(caller, q, params)}`;
  return { clause, params };
}

export async function inboxCounts(
  caller: Caller,
  q: string,
): Promise<{ waiting: number; answered: number; closed: number }> {
  const { clause, params } = baseClause(caller, q);
  const result = await query<{ status: ThreadStatus; total: string }>(
    `SELECT t.status, count(*) AS total ${clause} GROUP BY t.status`,
    params,
  );
  const counts = { waiting: 0, answered: 0, closed: 0 };
  for (const row of result.rows) counts[row.status] = Number(row.total);
  return counts;
}

function firstLine(forensics: ForensicsLine[] | null): string {
  if (!forensics) return '';
  const sanitiser = forensics.find((line) => line.stage === 'sanitiser');
  const text = sanitiser?.after ?? '';
  const [line] = text.split('\n');
  return (line ?? '').slice(0, 120);
}

export async function listInbox(
  caller: Caller,
  options: { status: ThreadStatus; q: string; limit: number; cursor: string | null },
): Promise<InboxBody> {
  const counts = await inboxCounts(caller, options.q);
  const { clause, params } = baseClause(caller, options.q);
  params.push(options.status);
  let where = `${clause} AND t.status = $${params.length}`;
  if (options.cursor !== null) {
    const cursor = decodeCursor(options.cursor, options.status, options.q);
    params.push(cursor.at, cursor.id);
    where += ` ${cursorClause(options.status, params.length - 1, params.length)}`;
  }
  params.push(options.limit + 1);
  const rows = await query<{
    id: string;
    status: ThreadStatus;
    topic: Topic;
    player_public_id: string;
    player_name: string;
    last_player_message_at: Date;
    waiting_since: Date | null;
    latest_forensics: ForensicsLine[] | null;
  }>(
    `SELECT t.id, t.status, t.topic, p.player_id AS player_public_id, p.name AS player_name,
            t.last_player_message_at, t.waiting_since,
            (SELECT m.forensics FROM messages m
               WHERE m.thread_id = t.id AND m.kind = 'player'
               ORDER BY m.created_at DESC, m.seq DESC LIMIT 1) AS latest_forensics
       ${where} ${orderClause(options.status)} LIMIT $${params.length}`,
    params,
  );
  const page = rows.rows.slice(0, options.limit);
  const threads: InboxRow[] = page.map((row) => ({
    id: row.id,
    status: row.status,
    topic: row.topic,
    player: { id: row.player_public_id, name: row.player_name },
    first_line: firstLine(row.latest_forensics),
    last_player_message_at: row.last_player_message_at.toISOString(),
    waiting_since: row.waiting_since === null ? null : row.waiting_since.toISOString(),
  }));
  const last = page[page.length - 1];
  const nextCursor =
    rows.rows.length > options.limit && last
      ? encodeCursor({
          status: options.status,
          q: options.q,
          at: last.last_player_message_at.toISOString(),
          id: last.id,
        })
      : null;
  return { counts, threads, next_cursor: nextCursor };
}

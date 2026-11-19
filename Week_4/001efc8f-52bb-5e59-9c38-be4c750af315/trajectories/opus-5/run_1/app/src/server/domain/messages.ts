import { query } from '../db';
import { config } from '../config';
import { isoOf, isoOrNull } from '../clock';
import { DELIVERED_COUNT_SQL, READ_COUNT_SQL, RECIPIENT_COUNT_SQL, REPLY_COUNT_SQL } from './counts';
import type { Attachment, Message, MessageOrPlaceholder, Quote, Role } from '../../shared/api';

export interface MessageRow {
  id: string;
  workspace_id: string;
  channel_id: string;
  author_id: string;
  client_message_id: string | null;
  text: string;
  version: number;
  sent_at: Date;
  edited_at: Date | null;
  thread_root_id: string | null;
  quoted_message_id: string | null;
  counted: boolean;
  deleted: boolean;
  author_name: string;
  author_role: Role;
  recipient_count: number;
  delivered_count: number;
  read_count: number;
  reply_count: number;
  pinned_by_id: string | null;
  pinned_by_name: string | null;
}

export const MESSAGE_COLUMNS = `
  m.id, m.workspace_id, m.channel_id, m.author_id, m.client_message_id, m.text, m.version,
  m.sent_at, m.edited_at, m.thread_root_id, m.quoted_message_id, m.counted, m.deleted,
  author.name AS author_name, author.role AS author_role,
  ${RECIPIENT_COUNT_SQL} AS recipient_count,
  ${DELIVERED_COUNT_SQL} AS delivered_count,
  ${READ_COUNT_SQL} AS read_count,
  ${REPLY_COUNT_SQL} AS reply_count,
  pin.pinned_by AS pinned_by_id,
  pinner.name AS pinned_by_name`;

export const MESSAGE_FROM = `
  FROM messages m
  JOIN users author ON author.id = m.author_id
  LEFT JOIN pins pin ON pin.message_id = m.id
  LEFT JOIN users pinner ON pinner.id = pin.pinned_by`;

export function editableUntil(sentAt: Date): string {
  return isoOf(sentAt.getTime() + config.editWindowSeconds * 1000);
}

export function attachmentShape(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    filename: row.filename,
    content_type: row.content_type,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    url: `/api/attachments/${row.id}`,
    thumb_url: `/api/attachments/${row.id}/thumb`,
  };
}

export interface AttachmentRow {
  id: string;
  message_id: string;
  filename: string;
  content_type: string;
  bytes: number;
  width: number;
  height: number;
}

interface QuoteRow {
  id: string;
  text: string;
  version: number;
  deleted: boolean;
  author_name: string;
}

export async function buildMessages(rows: MessageRow[]): Promise<MessageOrPlaceholder[]> {
  if (rows.length === 0) return [];
  const liveIds = rows.filter((row) => !row.deleted).map((row) => row.id);
  const attachmentsByMessage = new Map<string, Attachment[]>();
  if (liveIds.length > 0) {
    const attachmentRows = await query<AttachmentRow>(
      `SELECT id, message_id, filename, content_type, bytes, width, height
       FROM attachments WHERE message_id = ANY($1::uuid[]) ORDER BY position ASC`,
      [liveIds],
    );
    for (const attachment of attachmentRows) {
      const list = attachmentsByMessage.get(attachment.message_id) ?? [];
      list.push(attachmentShape(attachment));
      attachmentsByMessage.set(attachment.message_id, list);
    }
  }

  const quotedIds = rows
    .filter((row) => !row.deleted && row.quoted_message_id !== null)
    .map((row) => row.quoted_message_id as string);
  const quotesById = new Map<string, QuoteRow>();
  if (quotedIds.length > 0) {
    const quoteRows = await query<QuoteRow>(
      `SELECT q.id, q.text, q.version, q.deleted, qa.name AS author_name
       FROM messages q JOIN users qa ON qa.id = q.author_id
       WHERE q.id = ANY($1::uuid[])`,
      [quotedIds],
    );
    for (const row of quoteRows) quotesById.set(row.id, row);
  }

  return rows.map((row) => shapeMessage(row, attachmentsByMessage, quotesById));
}

export async function buildMessage(row: MessageRow): Promise<MessageOrPlaceholder> {
  const built = await buildMessages([row]);
  return built[0]!;
}

function shapeMessage(
  row: MessageRow,
  attachmentsByMessage: Map<string, Attachment[]>,
  quotesById: Map<string, QuoteRow>,
): MessageOrPlaceholder {
  if (row.deleted) {
    return {
      id: row.id,
      channel_id: row.channel_id,
      deleted: true,
      sent_at: isoOf(row.sent_at),
      reply_count: row.reply_count,
    };
  }
  let quote: Quote = null;
  if (row.quoted_message_id !== null) {
    const quoted = quotesById.get(row.quoted_message_id);
    if (!quoted || quoted.deleted) {
      quote = { message_id: row.quoted_message_id, deleted: true };
    } else {
      quote = {
        message_id: quoted.id,
        author_name: quoted.author_name,
        text: quoted.text,
        edited: quoted.version > 1,
        deleted: false,
      };
    }
  }
  const message: Message = {
    id: row.id,
    channel_id: row.channel_id,
    client_message_id: row.client_message_id,
    author: { id: row.author_id, name: row.author_name, role: row.author_role },
    text: row.text,
    version: row.version,
    edited: row.version > 1,
    sent_at: isoOf(row.sent_at),
    edited_at: isoOrNull(row.edited_at),
    editable_until: editableUntil(row.sent_at),
    thread_root_id: row.thread_root_id,
    reply_count: row.reply_count,
    quote,
    attachments: attachmentsByMessage.get(row.id) ?? [],
    pinned: row.pinned_by_id !== null,
    pinned_by: row.pinned_by_id === null ? null : { id: row.pinned_by_id, name: row.pinned_by_name ?? '' },
    recipient_count: row.recipient_count,
    delivered_count: row.delivered_count,
    read_count: row.read_count,
    deleted: false,
  };
  return message;
}

export async function loadMessageRow(messageId: string): Promise<MessageRow | null> {
  const rows = await query<MessageRow>(`SELECT ${MESSAGE_COLUMNS} ${MESSAGE_FROM} WHERE m.id = $1`, [messageId]);
  return rows[0] ?? null;
}

export async function loadMessageForDelivery(messageId: string): Promise<MessageOrPlaceholder | null> {
  const row = await loadMessageRow(messageId);
  if (!row) return null;
  return buildMessage(row);
}

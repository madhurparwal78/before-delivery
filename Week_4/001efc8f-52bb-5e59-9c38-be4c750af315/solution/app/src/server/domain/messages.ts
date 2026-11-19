import { ApiError } from "../errors.js";
import { one, rows, type Queryable } from "../db.js";
import { messageCountColumns } from "./counts.js";
import { encodeCursor, instantCursor, type PageParams } from "./cursor.js";
import { isUuid } from "./ids.js";
import type { Role } from "./roles.js";

export type AttachmentJson = {
  id: string;
  filename: string;
  content_type: string;
  bytes: number;
  width: number;
  height: number;
  url: string;
  thumb_url: string;
};

export type QuoteJson =
  | { message_id: string; author_name: string; text: string; edited: boolean; deleted: false }
  | { message_id: string; deleted: true };

export type MessageJson = {
  id: string;
  channel_id: string;
  client_message_id: string | null;
  author: { id: string; name: string; role: Role };
  text: string;
  version: number;
  edited: boolean;
  sent_at: string;
  edited_at: string | null;
  editable_until: string;
  thread_root_id: string | null;
  reply_count: number;
  quote: QuoteJson | null;
  attachments: AttachmentJson[];
  pinned: boolean;
  pinned_by: { id: string; name: string } | null;
  recipient_count: number;
  delivered_count: number;
  read_count: number;
  deleted: false;
};

type PlaceholderJson = { id: string; channel_id: string; deleted: true; sent_at: string; reply_count: number };

type MessageRow = {
  id: string;
  channel_id: string;
  client_message_id: string | null;
  author_id: string;
  author_name: string;
  author_role: Role;
  text: string;
  version: number;
  sent_at: Date;
  edited_at: Date | null;
  editable_until: Date;
  thread_root_id: string | null;
  quoted_message_id: string | null;
  deleted_at: Date | null;
  pinned_by_id: string | null;
  pinned_by_name: string | null;
  reply_count: number;
  quote_id: string | null;
  quote_deleted_at: Date | null;
  quote_text: string | null;
  quote_version: number | null;
  quote_author: string | null;
  recipient_count: number;
  delivered_count: number;
  read_count: number;
};

const MESSAGE_SELECT = `
SELECT m.id, m.channel_id, m.client_message_id, m.author_id, au.name AS author_name, au.role AS author_role,
       m.text, m.version, m.sent_at, m.edited_at, m.editable_until, m.thread_root_id, m.quoted_message_id, m.deleted_at,
       pb.id AS pinned_by_id, pb.name AS pinned_by_name,
       (SELECT count(*)::int FROM messages rp WHERE rp.thread_root_id = m.id AND rp.deleted_at IS NULL) AS reply_count,
       q.id AS quote_id, q.deleted_at AS quote_deleted_at, q.text AS quote_text, q.version AS quote_version, qa.name AS quote_author,
       ${messageCountColumns("m")}
  FROM messages m
  JOIN users au ON au.id = m.author_id
  LEFT JOIN users pb ON pb.id = m.pinned_by AND m.pinned_at IS NOT NULL
  LEFT JOIN messages q ON q.id = m.quoted_message_id
  LEFT JOIN users qa ON qa.id = q.author_id
 WHERE m.id = ANY($1::uuid[])`;

function quoteOf(row: MessageRow): QuoteJson | null {
  if (row.quoted_message_id === null) return null;
  if (row.quote_id === null || row.quote_deleted_at !== null) return { message_id: row.quoted_message_id, deleted: true };
  return {
    message_id: row.quoted_message_id,
    author_name: row.quote_author ?? "",
    text: row.quote_text ?? "",
    edited: (row.quote_version ?? 1) > 1,
    deleted: false,
  };
}

export function attachmentUrls(id: string): { url: string; thumb_url: string } {
  return { url: `/api/attachments/${id}`, thumb_url: `/api/attachments/${id}/thumb` };
}

// Loads Message (or deleted-root placeholder) JSON for the given ids, keyed by id.
export async function loadMessages(db: Queryable, ids: string[]): Promise<Map<string, MessageJson | PlaceholderJson>> {
  const found = new Map<string, MessageJson | PlaceholderJson>();
  if (ids.length === 0) return found;
  const messageRows = await rows<MessageRow>(db, MESSAGE_SELECT, [ids]);
  const attachmentRows = await rows<{ message_id: string; id: string; filename: string; content_type: string; bytes: number; width: number; height: number }>(
    db,
    `SELECT message_id, id, filename, content_type, bytes, width, height FROM attachments
      WHERE message_id = ANY($1::uuid[]) AND state = 'stored' ORDER BY position`,
    [ids],
  );
  for (const row of messageRows) {
    if (row.deleted_at !== null) {
      found.set(row.id, { id: row.id, channel_id: row.channel_id, deleted: true, sent_at: row.sent_at.toISOString(), reply_count: row.reply_count });
      continue;
    }
    found.set(row.id, {
      id: row.id,
      channel_id: row.channel_id,
      client_message_id: row.client_message_id,
      author: { id: row.author_id, name: row.author_name, role: row.author_role },
      text: row.text,
      version: row.version,
      edited: row.version > 1,
      sent_at: row.sent_at.toISOString(),
      edited_at: row.edited_at?.toISOString() ?? null,
      editable_until: row.editable_until.toISOString(),
      thread_root_id: row.thread_root_id,
      reply_count: row.reply_count,
      quote: quoteOf(row),
      attachments: attachmentRows
        .filter((a) => a.message_id === row.id)
        .map((a) => ({ id: a.id, filename: a.filename, content_type: a.content_type, bytes: a.bytes, width: a.width, height: a.height, ...attachmentUrls(a.id) })),
      pinned: row.pinned_by_id !== null,
      pinned_by: row.pinned_by_id !== null ? { id: row.pinned_by_id, name: row.pinned_by_name ?? "" } : null,
      recipient_count: row.recipient_count,
      delivered_count: row.delivered_count,
      read_count: row.read_count,
      deleted: false,
    });
  }
  return found;
}

export async function loadMessage(db: Queryable, id: string): Promise<MessageJson> {
  const message = (await loadMessages(db, [id])).get(id);
  if (!message || message.deleted) throw new ApiError("not_found");
  return message;
}

type MessageAccess = {
  id: string;
  channel_id: string;
  workspace_id: string;
  author_id: string;
  thread_root_id: string | null;
  version: number;
  text: string;
  editable_until: Date;
  deleted_at: Date | null;
};

// A message inside a channel the viewer currently belongs to. Deleted messages answer not_found
// unless the caller asks for a thread root, which may be a placeholder.
export async function visibleMessage(
  db: Queryable,
  viewer: { id: string; workspace: { id: string } },
  id: string,
  options: { allowPlaceholder?: boolean; forUpdate?: boolean } = {},
): Promise<MessageAccess> {
  if (!isUuid(id)) throw new ApiError("not_found");
  const row = await one<MessageAccess>(
    db,
    `SELECT m.id, m.channel_id, m.workspace_id, m.author_id, m.thread_root_id, m.version, m.text, m.editable_until, m.deleted_at
       FROM messages m
      WHERE m.id = $1 AND m.workspace_id = $3
        AND EXISTS (SELECT 1 FROM memberships mb WHERE mb.channel_id = m.channel_id AND mb.user_id = $2)
      ${options.forUpdate ? "FOR UPDATE OF m" : ""}`,
    [id, viewer.id, viewer.workspace.id],
  );
  if (!row || (row.deleted_at !== null && !options.allowPlaceholder)) throw new ApiError("not_found");
  return row;
}

type Page<T> = { items: T[]; next_cursor: string | null };

async function keyset(db: Queryable, where: string, params: unknown[], page: PageParams): Promise<Page<MessageJson | PlaceholderJson>> {
  const cursor = instantCursor(page.before, 2);
  const at = params.length;
  const found = await rows<{ id: string; sent_at: Date }>(
    db,
    `SELECT m.id, m.sent_at FROM messages m WHERE ${where}
       ${cursor ? `AND (m.sent_at, m.id::text) < ($${at + 1}::timestamptz, $${at + 2})` : ""}
     ORDER BY m.sent_at DESC, m.id::text DESC LIMIT $${at + (cursor ? 3 : 1)}`,
    [...params, ...(cursor ?? []), page.limit + 1],
  );
  const pageRows = found.slice(0, page.limit);
  const loaded = await loadMessages(db, pageRows.map((r) => r.id));
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map((r) => loaded.get(r.id)).filter((m): m is MessageJson | PlaceholderJson => m !== undefined),
    next_cursor: found.length > page.limit && last ? encodeCursor([last.sent_at.toISOString(), last.id]) : null,
  };
}

// Channel history: top-level messages, plus deleted roots that still have live replies.
export function historyPage(db: Queryable, channelId: string, page: PageParams): Promise<Page<MessageJson | PlaceholderJson>> {
  return keyset(
    db,
    `m.channel_id = $1 AND m.thread_root_id IS NULL
       AND (m.deleted_at IS NULL OR EXISTS (SELECT 1 FROM messages lr WHERE lr.thread_root_id = m.id AND lr.deleted_at IS NULL))`,
    [channelId],
    page,
  );
}

export function threadPage(db: Queryable, rootId: string, page: PageParams): Promise<Page<MessageJson | PlaceholderJson>> {
  return keyset(db, "m.thread_root_id = $1 AND m.deleted_at IS NULL", [rootId], page);
}

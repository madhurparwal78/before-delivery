import { nowDate } from './clock.js';
import { db, type Queryable } from './db.js';
import { appendEvent } from './events.js';
import { attachmentsFor } from './issueview.js';
import { storedInstant } from './domain/zone.js';
import type { Message, Unread } from '../shared/types.js';

export const TYPING_WINDOW_SECONDS = 5;
export const MESSAGE_LIMIT = 4000;

export type MessageRow = {
  id: number;
  channel_id: string;
  author_id: string;
  body: string;
  thread_root_id: number | null;
  mentions: string[];
  client_key: string | null;
  created_at: string;
  reply_count: number;
};

export const messageColumns = `m.id, m.channel_id, m.author_id, m.body, m.thread_root_id, m.mentions,
  m.client_key, m.created_at,
  (select count(*)::int from messages r where r.thread_root_id = m.id and r.deleted = false) as reply_count`;

export async function messageBodies(
  rows: MessageRow[],
  viewerId: string,
  zone: string,
  client: Queryable = db,
): Promise<Message[]> {
  const attachments = await attachmentsFor(
    'message',
    rows.map((row) => String(row.id)),
    client,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    channel_id: row.channel_id,
    author_id: row.author_id,
    body: row.body,
    thread_root_id: row.thread_root_id === null ? null : Number(row.thread_root_id),
    reply_count: Number(row.reply_count),
    mentions: row.mentions,
    created_at: storedInstant(zone, row.created_at) ?? row.created_at,
    attachments: attachments.get(String(row.id)) ?? [],
    client_key: row.author_id === viewerId ? row.client_key : null,
  }));
}

const inboxPredicate = `
  m.deleted = false and m.author_id <> $1
  and ((m.thread_root_id is null and m.id > coalesce(rc.up_to, 0))
       or (m.thread_root_id is not null and m.id > coalesce(rt.up_to, 0)))
  and ($1 = any(m.mentions)
       or (m.thread_root_id is not null and (
            exists (select 1 from messages root where root.id = m.thread_root_id and root.author_id = $1)
            or exists (select 1 from messages prev
                        where prev.thread_root_id = m.thread_root_id and prev.deleted = false
                          and prev.author_id = $1 and prev.id < m.id))))`;

/** Unread counts are derived from stored messages and read markers on every read. */
export async function unreadFor(
  personId: string,
  workspaceId: string,
  client: Queryable = db,
): Promise<Unread> {
  const channels = await client.query<{ id: string; unread: number }>(
    `select c.id,
            (select count(*)::int from messages m
              where m.channel_id = c.id and m.thread_root_id is null and m.deleted = false
                and m.author_id <> $1 and m.id > coalesce(rm.up_to, 0)) as unread
       from channel_members cm
       join channels c on c.id = cm.channel_id
       left join read_markers rm on rm.person_id = $1 and rm.channel_id = c.id and rm.thread_root_id = 0
      where cm.person_id = $1 and c.workspace_id = $2
      order by c.name asc`,
    [personId, workspaceId],
  );
  const inbox = await client.one<{ count: number }>(
    `select count(*)::int as count from messages m
       join channel_members cm on cm.channel_id = m.channel_id and cm.person_id = $1
       left join read_markers rc on rc.person_id = $1 and rc.channel_id = m.channel_id and rc.thread_root_id = 0
       left join read_markers rt on rt.person_id = $1 and rt.channel_id = m.channel_id
            and rt.thread_root_id = m.thread_root_id
      where m.workspace_id = $2 and ${inboxPredicate}`,
    [personId, workspaceId],
  );
  const counts: Record<string, number> = {};
  for (const channel of channels) counts[channel.id] = Number(channel.unread);
  return { channels: counts, inbox: inbox?.count ?? 0 };
}

export async function inboxMessages(
  personId: string,
  workspaceId: string,
  zone: string,
  client: Queryable = db,
): Promise<Message[]> {
  const rows = await client.query<MessageRow>(
    `select ${messageColumns} from messages m
       join channel_members cm on cm.channel_id = m.channel_id and cm.person_id = $1
       left join read_markers rc on rc.person_id = $1 and rc.channel_id = m.channel_id and rc.thread_root_id = 0
       left join read_markers rt on rt.person_id = $1 and rt.channel_id = m.channel_id
            and rt.thread_root_id = m.thread_root_id
      where m.workspace_id = $2 and ${inboxPredicate}
      order by m.id desc`,
    [personId, workspaceId],
  );
  return messageBodies(rows, personId, zone, client);
}

/** One fresh unread event for each person whose counts a change touched. */
export async function emitUnread(
  client: Queryable,
  workspaceId: string,
  personIds: readonly string[],
  createdAt: string,
): Promise<void> {
  for (const personId of new Set(personIds)) {
    const body = await unreadFor(personId, workspaceId, client);
    await appendEvent(client, workspaceId, 'unread', { ...body }, { type: 'person', id: personId }, createdAt);
  }
}

export async function channelMemberIds(channelId: string, client: Queryable = db): Promise<string[]> {
  const rows = await client.query<{ person_id: string }>(
    `select cm.person_id from channel_members cm join people p on p.id = cm.person_id
      where cm.channel_id = $1 and p.removed = false`,
    [channelId],
  );
  return rows.map((row) => row.person_id);
}

/** The server's typing list for a channel: each person once, by name A to Z. */
export async function typingList(channelId: string, client: Queryable = db): Promise<string[]> {
  const since = new Date(nowDate().getTime() - TYPING_WINDOW_SECONDS * 1000).toISOString();
  const rows = await client.query<{ person_id: string }>(
    `select t.person_id from typing t join people p on p.id = t.person_id
      where t.channel_id = $1 and t.last_at > $2 and p.removed = false
      order by p.name asc, p.id asc`,
    [channelId, since],
  );
  return rows.map((row) => row.person_id);
}

export async function emitTyping(
  client: Queryable,
  workspaceId: string,
  channelId: string,
  createdAt: string,
): Promise<void> {
  const typing = await typingList(channelId, client);
  await appendEvent(
    client,
    workspaceId,
    'typing',
    { channel_id: channelId, typing },
    { type: 'channel', id: channelId },
    createdAt,
  );
}

/** Mentions name channel members by handle, matched case-insensitively. */
export function mentionedHandles(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/@([A-Za-z0-9_.-]+)/g)) {
    const handle = match[1];
    if (handle !== undefined) found.add(handle.toLowerCase());
  }
  return [...found];
}

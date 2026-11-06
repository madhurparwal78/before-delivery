import { nowDate } from '../clock.js';
import { db, tx, type Queryable } from '../db.js';
import { ApiError } from '../errors.js';
import { canSeeChannel, requireWorkspace, type Actor } from '../access.js';
import {
  channelMemberIds,
  emitTyping,
  emitUnread,
  inboxMessages,
  mentionedHandles,
  messageBodies,
  messageColumns,
  MESSAGE_LIMIT,
  typingList,
  unreadFor,
  type MessageRow,
} from '../chatview.js';
import { appendEvent } from '../events.js';
import { withIdempotency } from '../idempotency.js';
import { sessionRoute, type Route } from '../router.js';
import { queueMail } from '../services/mail.js';
import { noticeOwner } from '../services/status.js';
import { config } from '../config.js';
import { zoneOf } from '../calendarstore.js';
import { messageIdOrNotFound, textField, uuidOrNotFound } from '../validate.js';
import type { Message } from '../../shared/types.js';

async function requireChannel(actor: Actor, channelId: string): Promise<{ id: string; name: string }> {
  if (!(await canSeeChannel(actor, channelId))) throw new ApiError('not_found');
  const row = await db.one<{ id: string; name: string }>('select id, name from channels where id = $1', [
    channelId,
  ]);
  if (row === undefined) throw new ApiError('not_found');
  return row;
}

async function loadMessage(
  actor: Actor,
  messageId: number,
  client: Queryable = db,
): Promise<MessageRow & { deleted: boolean; author_name: string; channel_name: string }> {
  const row = await client.one<MessageRow & { deleted: boolean; author_name: string; channel_name: string }>(
    `select ${messageColumns}, m.deleted, a.name as author_name, c.name as channel_name
       from messages m join people a on a.id = m.author_id join channels c on c.id = m.channel_id
      where m.id = $1 and m.workspace_id = $2`,
    [messageId, actor.workspaceId],
  );
  if (row === undefined || row.deleted) throw new ApiError('not_found');
  if (!(await canSeeChannel(actor, row.channel_id, client))) throw new ApiError('not_found');
  return row;
}

export const chatRoutes: Route[] = [
  sessionRoute('GET', '/api/channels', 'none', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const unread = await unreadFor(ctx.actor.id, workspaceId);
    const rows = await db.query<{ id: string; name: string }>(
      `select c.id, c.name from channels c join channel_members cm on cm.channel_id = c.id
        where cm.person_id = $1 and c.workspace_id = $2 order by c.name asc`,
      [ctx.actor.id, workspaceId],
    );
    return {
      status: 200,
      body: {
        channels: rows.map((row) => ({ id: row.id, name: row.name, unread: unread.channels[row.id] ?? 0 })),
      },
    };
  }),

  sessionRoute('GET', '/api/channels/:id/messages', 'none', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const channelId = uuidOrNotFound(ctx.params.id);
    await requireChannel(ctx.actor, channelId);
    const rows = await db.query<MessageRow>(
      `select ${messageColumns} from messages m
        where m.channel_id = $1 and m.thread_root_id is null and m.deleted = false
        order by m.id asc`,
      [channelId],
    );
    return {
      status: 200,
      body: {
        messages: await messageBodies(rows, ctx.actor.id, await zoneOf(workspaceId)),
        typing: (await typingList(channelId)).filter((id) => id !== ctx.actor.id),
      },
    };
  }),

  sessionRoute('POST', '/api/channels/:id/messages', 'json', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    return withIdempotency(ctx.actor.id, 'post-message', ctx.idempotencyKey, ctx.rawBody, async () => {
      const channelId = uuidOrNotFound(ctx.params.id);
      const channel = await requireChannel(ctx.actor, channelId);
      const body = textField(ctx.body, 'body', {
        field: 'body',
        min: 1,
        max: MESSAGE_LIMIT,
        message: `Messages can be up to ${MESSAGE_LIMIT} characters.`,
        blankMessage: 'Write a message.',
      });
      let threadRootId: number | null = null;
      if (ctx.body.thread_root_id !== undefined && ctx.body.thread_root_id !== null) {
        const value = ctx.body.thread_root_id;
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          throw new ApiError('validation', {
            fields: { thread_root_id: 'Reply to a message in this channel.' },
            message: 'Reply to a message in this channel.',
          });
        }
        const root = await db.one<{ id: number }>(
          `select id from messages
            where id = $1 and channel_id = $2 and thread_root_id is null and deleted = false`,
          [value, channelId],
        );
        if (root === undefined) {
          throw new ApiError('validation', {
            fields: { thread_root_id: 'Reply to a message in this channel.' },
            message: 'Reply to a message in this channel.',
          });
        }
        threadRootId = value;
      }

      const handles = mentionedHandles(body);
      const mentioned =
        handles.length === 0
          ? []
          : await db.query<{ id: string; email: string }>(
              `select p.id, p.email from people p
                 join channel_members cm on cm.person_id = p.id and cm.channel_id = $1
                where p.removed = false and lower(p.handle) = any($2::text[]) and p.id <> $3`,
              [channelId, handles, ctx.actor.id],
            );
      const at = nowDate().toISOString();
      const members = await channelMemberIds(channelId);
      const zone = await zoneOf(workspaceId);

      const message = await tx(async (client) => {
        const inserted = await client.one<{ id: number }>(
          `insert into messages (id, workspace_id, channel_id, author_id, body, thread_root_id, mentions, client_key, created_at)
           values (nextval('message_ids'), $1, $2, $3, $4, $5, $6::uuid[], $7, $8) returning id`,
          [
            workspaceId,
            channelId,
            ctx.actor.id,
            body,
            threadRootId,
            mentioned.map((person) => person.id),
            ctx.idempotencyKey ?? null,
            at,
          ],
        );
        if (inserted === undefined) throw new ApiError('not_found');
        const rows = await client.query<MessageRow>(
          `select ${messageColumns} from messages m where m.id = $1`,
          [inserted.id],
        );
        const bodies = await messageBodies(rows, ctx.actor.id, zone, client);
        const stored = bodies[0];
        if (stored === undefined) throw new ApiError('not_found');
        await appendEvent(
          client,
          workspaceId,
          threadRootId === null ? 'message' : 'thread_reply',
          { ...stored },
          { type: 'channel', id: channelId },
          at,
        );
        await client.query('delete from typing where channel_id = $1 and person_id = $2', [
          channelId,
          ctx.actor.id,
        ]);
        await emitTyping(client, workspaceId, channelId, at);
        await emitUnread(
          client,
          workspaceId,
          members.filter((id) => id !== ctx.actor.id),
          at,
        );
        for (const person of mentioned) {
          await queueMail(client, {
            workspaceId,
            to: person.email,
            subject: `${ctx.actor.name} mentioned you in #${channel.name}`,
            body:
              `${ctx.actor.name} mentioned you in #${channel.name} on Tallyroom.\n\n` +
              `${body}\n\nOpen Tallyroom at ${config.appPublicUrl}\n`,
            kind: 'mention',
            messageId: Number(inserted.id),
            personId: person.id,
            channelId,
          });
        }
        if (mentioned.length > 0) await noticeOwner(client, workspaceId, at);
        return stored;
      });
      return { status: 201, body: message };
    });
  }),

  sessionRoute('GET', '/api/messages/:id/thread', 'none', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const zone = await zoneOf(workspaceId);
    const messageId = messageIdOrNotFound(ctx.params.id);
    const root = await loadMessage(ctx.actor, messageId);
    if (root.thread_root_id !== null) throw new ApiError('not_found');
    const rows = await db.query<MessageRow>(
      `select ${messageColumns} from messages m
        where m.thread_root_id = $1 and m.deleted = false order by m.id asc`,
      [messageId],
    );
    const rootRows = await db.query<MessageRow>(`select ${messageColumns} from messages m where m.id = $1`, [
      messageId,
    ]);
    const rootBody = (await messageBodies(rootRows, ctx.actor.id, zone))[0];
    if (rootBody === undefined) throw new ApiError('not_found');
    return {
      status: 200,
      body: { root: rootBody, replies: await messageBodies(rows, ctx.actor.id, await zoneOf(workspaceId)) },
    };
  }),

  sessionRoute('DELETE', '/api/messages/:id', 'none', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const messageId = messageIdOrNotFound(ctx.params.id);
    const message = await loadMessage(ctx.actor, messageId);
    if (message.author_id !== ctx.actor.id && ctx.actor.role !== 'owner') throw new ApiError('forbidden');
    const at = nowDate().toISOString();
    const members = await channelMemberIds(message.channel_id);
    await tx(async (client) => {
      const deleted = await client.query<{ id: number }>(
        `update messages set deleted = true
          where (id = $1 or thread_root_id = $1) and deleted = false and workspace_id = $2
          returning id`,
        [messageId, workspaceId],
      );
      const ids = deleted.map((row) => String(row.id));
      const attachments = await client.query<{ object_key: string }>(
        `delete from attachments where parent_type = 'message' and parent_id = any($1::text[])
         returning object_key`,
        [ids],
      );
      for (const attachment of attachments) {
        await client.query(
          'insert into attachment_deletions (object_key, created_at) values ($1, $2)',
          [attachment.object_key, at],
        );
      }
      const held = await client.query<{ id: number }>(
        `delete from outbox where sent_at is null and kind = 'mention' and message_id = any($1::bigint[])
         returning id`,
        [deleted.map((row) => Number(row.id))],
      );
      await appendEvent(
        client,
        workspaceId,
        'message_deleted',
        {
          id: Number(messageId),
          channel_id: message.channel_id,
          thread_root_id: message.thread_root_id === null ? null : Number(message.thread_root_id),
        },
        { type: 'channel', id: message.channel_id },
        at,
      );
      await emitUnread(client, workspaceId, members, at);
      if (held.length > 0) await noticeOwner(client, workspaceId, at);
    });
    return { status: 204 };
  }),

  sessionRoute('POST', '/api/channels/:id/read', 'json', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const channelId = uuidOrNotFound(ctx.params.id);
    await requireChannel(ctx.actor, channelId);
    const upTo = ctx.body.up_to;
    if (typeof upTo !== 'number' || !Number.isInteger(upTo)) throw badUpTo();
    const exists = await db.one<{ id: number }>('select id from messages where id = $1 and channel_id = $2', [
      upTo,
      channelId,
    ]);
    if (exists === undefined) throw badUpTo();
    const at = nowDate().toISOString();
    const body = await tx(async (client) => {
      await client.query(
        `insert into read_markers (person_id, channel_id, thread_root_id, up_to) values ($1, $2, 0, $3)
         on conflict (person_id, channel_id, thread_root_id)
         do update set up_to = greatest(read_markers.up_to, excluded.up_to)`,
        [ctx.actor.id, channelId, upTo],
      );
      const unread = await unreadFor(ctx.actor.id, workspaceId, client);
      await appendEvent(
        client,
        workspaceId,
        'unread',
        { ...unread },
        { type: 'person', id: ctx.actor.id },
        at,
      );
      return unread;
    });
    return { status: 200, body };
  }),

  sessionRoute('POST', '/api/threads/:rootId/read', 'json', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const rootId = messageIdOrNotFound(ctx.params.rootId);
    const root = await loadMessage(ctx.actor, rootId);
    if (root.thread_root_id !== null) throw new ApiError('not_found');
    const upTo = ctx.body.up_to;
    if (typeof upTo !== 'number' || !Number.isInteger(upTo)) throw badUpTo();
    const exists = await db.one<{ id: number }>(
      'select id from messages where id = $1 and (id = $2 or thread_root_id = $2)',
      [upTo, rootId],
    );
    if (exists === undefined) throw badUpTo();
    const at = nowDate().toISOString();
    const body = await tx(async (client) => {
      await client.query(
        `insert into read_markers (person_id, channel_id, thread_root_id, up_to) values ($1, $2, $3, $4)
         on conflict (person_id, channel_id, thread_root_id)
         do update set up_to = greatest(read_markers.up_to, excluded.up_to)`,
        [ctx.actor.id, root.channel_id, rootId, upTo],
      );
      const unread = await unreadFor(ctx.actor.id, workspaceId, client);
      await appendEvent(
        client,
        workspaceId,
        'unread',
        { ...unread },
        { type: 'person', id: ctx.actor.id },
        at,
      );
      return unread;
    });
    return { status: 200, body };
  }),

  sessionRoute('GET', '/api/unread', 'none', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    return { status: 200, body: await unreadFor(ctx.actor.id, workspaceId) };
  }),

  sessionRoute('GET', '/api/inbox', 'none', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const items: Message[] = await inboxMessages(ctx.actor.id, workspaceId, await zoneOf(workspaceId));
    return { status: 200, body: { items } };
  }),

  sessionRoute('POST', '/api/channels/:id/typing', 'json', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const channelId = uuidOrNotFound(ctx.params.id);
    await requireChannel(ctx.actor, channelId);
    const at = nowDate().toISOString();
    await tx(async (client) => {
      const before = await typingList(channelId, client);
      await client.query(
        `insert into typing (person_id, channel_id, last_at) values ($1, $2, $3)
         on conflict (person_id, channel_id) do update set last_at = excluded.last_at`,
        [ctx.actor.id, channelId, at],
      );
      if (!before.includes(ctx.actor.id)) await emitTyping(client, workspaceId, channelId, at);
    });
    return { status: 204 };
  }),
];

function badUpTo(): ApiError {
  return new ApiError('validation', {
    fields: { up_to: 'Name a message in this channel.' },
    message: 'Name a message in this channel.',
  });
}

// Channels, messages, threads, read markers, mentions and typing.
import { clientKeyFor, isChannelMember, type Viewer } from "./access.js";
import { attachmentsOf, queueObjectDeletions } from "./attachments.js";
import { config } from "./config.js";
import { tx, type Db } from "./db.js";
import { ApiError, invalid } from "./errors.js";
import { emit } from "./events.js";
import { route } from "./router.js";
import { dropHeldMail, queueMail } from "./outbox.js";
import { signalTyping, stopTyping, typingList } from "./presence.js";
import { textWithin } from "../shared/text.js";
import { isoInstant, nowMs } from "./time.js";
import { emitUnread, inboxMessageIds, unreadBody } from "./unread.js";
import { zoneOf } from "./workspace.js";

interface MessageRow {
  id: number;
  channel_id: string;
  author_id: string;
  body: string;
  thread_root_id: number | null;
  client_key: string | null;
  created_at: number;
  reply_count: number;
  mentions: string[] | null;
}

const MESSAGE_SELECT = `
  SELECT m.id, m.channel_id, m.author_id, m.body, m.thread_root_id, m.client_key, m.created_at,
         (SELECT count(*)::int FROM messages r WHERE r.thread_root_id = m.id) AS reply_count,
         (SELECT array_agg(x.person_id) FROM message_mentions x WHERE x.message_id = m.id) AS mentions
  FROM messages m`;

/** Messages as `readerId` reads them: `client_key` goes to the author alone. */
async function messagesJson(db: Db, workspaceId: string, readerId: string, rows: MessageRow[]): Promise<Record<string, unknown>[]> {
  const zone = await zoneOf(db, workspaceId);
  const attachments = await attachmentsOf(db, "message", rows.map((r) => r.id));
  return rows.map((m) => ({
    id: m.id,
    channel_id: m.channel_id,
    author_id: m.author_id,
    body: m.body,
    thread_root_id: m.thread_root_id,
    reply_count: m.reply_count,
    mentions: m.mentions ?? [],
    created_at: isoInstant(m.created_at, zone),
    attachments: attachments.get(m.id) ?? [],
    client_key: clientKeyFor(readerId, m.author_id, m.client_key),
  }));
}

async function channelOf(db: Db, viewer: Viewer, channelId: string): Promise<{ id: string; name: string }> {
  const { rows } = await db.query<{ id: string; name: string }>("SELECT id, name FROM channels WHERE id::text = $1 AND workspace_id = $2", [channelId, viewer.workspaceId]);
  const channel = rows[0];
  if (!channel || !(await isChannelMember(db, viewer.id, channel.id))) throw new ApiError("not_found");
  return channel;
}

/** A channel of the workspace for owner membership changes (owner need not be a member). */
async function workspaceChannel(db: Db, viewer: Viewer, channelId: string): Promise<{ id: string; name: string }> {
  const { rows } = await db.query<{ id: string; name: string }>("SELECT id, name FROM channels WHERE id::text = $1 AND workspace_id = $2", [channelId, viewer.workspaceId]);
  if (!rows[0]) throw new ApiError("not_found");
  if (viewer.role !== "owner") throw new ApiError("forbidden");
  return rows[0];
}

async function visibleMessage(db: Db, viewer: Viewer, id: string): Promise<MessageRow> {
  if (!/^\d{1,15}$/.test(id)) throw new ApiError("not_found");
  const { rows } = await db.query<MessageRow>(`${MESSAGE_SELECT} WHERE m.id = $1 AND m.workspace_id = $2`, [Number(id), viewer.workspaceId]);
  const message = rows[0];
  if (!message || !(await isChannelMember(db, viewer.id, message.channel_id))) throw new ApiError("not_found");
  return message;
}

async function channelMembers(db: Db, channelId: string): Promise<{ id: string; handle: string; name: string; email: string }[]> {
  const { rows } = await db.query<{ id: string; handle: string; name: string; email: string }>(
    "SELECT p.id, p.handle, p.name, p.email FROM channel_members c JOIN people p ON p.id = c.person_id WHERE c.channel_id = $1",
    [channelId],
  );
  return rows;
}

/** The viewer's own channels with their unread counts. */
export async function channelsFor(db: Db, viewer: Viewer): Promise<{ id: string; name: string; unread: number }[]> {
  const { rows } = await db.query<{ id: string; name: string }>(
    "SELECT c.id, c.name FROM channels c JOIN channel_members m ON m.channel_id = c.id AND m.person_id = $1 WHERE c.workspace_id = $2 ORDER BY c.name",
    [viewer.id, viewer.workspaceId],
  );
  const unread = await unreadBody(db, viewer.id);
  return rows.map((c) => ({ id: c.id, name: c.name, unread: unread.channels[c.id] ?? 0 }));
}

route("GET", "/api/channels", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  return { status: 200, body: { channels: await tx((db) => channelsFor(db, viewer)) } };
});

route("GET", "/api/channels/:id/messages", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  return {
    status: 200,
    body: await tx(async (db) => {
      const channel = await channelOf(db, viewer, ctx.params.id ?? "");
      const { rows } = await db.query<MessageRow>(`${MESSAGE_SELECT} WHERE m.channel_id = $1 AND m.thread_root_id IS NULL ORDER BY m.id`, [channel.id]);
      return { messages: await messagesJson(db, viewer.workspaceId, viewer.id, rows), typing: await typingList(db, channel.id) };
    }),
  };
});

route("POST", "/api/channels/:id/messages", { access: "workspace", idempotent: true }, async (ctx) => {
  const viewer = ctx.viewer;
  return tx(async (db) => {
    const channel = await channelOf(db, viewer, ctx.params.id ?? "");
    const body = ctx.body.body;
    const fields: Record<string, string> = {};
    if (!textWithin(body, 1, 4000)) fields.body = "Messages can be up to 4000 characters.";
    let root: MessageRow | null = null;
    const rootId = ctx.body.thread_root_id;
    if (rootId !== undefined && rootId !== null) {
      const { rows } = typeof rootId === "number" && Number.isInteger(rootId) ? await db.query<MessageRow>(`${MESSAGE_SELECT} WHERE m.id = $1`, [rootId]) : { rows: [] as MessageRow[] };
      root = rows[0] ?? null;
      if (!root || root.channel_id !== channel.id || root.thread_root_id !== null) fields.thread_root_id = "Reply to a top-level message in this channel.";
    }
    if (Object.keys(fields).length) throw invalid(fields);
    const text = body as string;
    const members = await channelMembers(db, channel.id);
    const handles = new Set([...text.matchAll(/@([A-Za-z0-9_]+)/g)].map((m) => (m[1] as string).toLowerCase()));
    const mentioned = members.filter((p) => handles.has(p.handle.toLowerCase()));
    const { rows } = await db.query<{ id: number }>(
      "INSERT INTO messages (workspace_id, channel_id, author_id, body, thread_root_id, client_key, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [viewer.workspaceId, channel.id, viewer.id, text, root?.id ?? null, ctx.req.headers["idempotency-key"] ?? null, nowMs()],
    );
    const id = (rows[0] as { id: number }).id;
    for (const person of mentioned) await db.query("INSERT INTO message_mentions (message_id, person_id) VALUES ($1, $2)", [id, person.id]);
    await stopTyping(db, viewer.workspaceId, channel.id, viewer.id);
    const { rows: stored } = await db.query<MessageRow>(`${MESSAGE_SELECT} WHERE m.id = $1`, [id]);
    const [message] = await messagesJson(db, viewer.workspaceId, viewer.id, stored);
    await emit(db, viewer.workspaceId, root ? "thread_reply" : "message", message as Record<string, unknown>, { channelId: channel.id });
    for (const person of mentioned) {
      if (person.id === viewer.id) continue;
      await queueMail(db, {
        workspaceId: viewer.workspaceId,
        kind: "mention",
        recipientId: person.id,
        email: person.email,
        messageId: id,
        subject: `${viewer.name} mentioned you in #${channel.name}`,
        body: `${viewer.name} mentioned you in #${channel.name}:\n\n${text}\n\nOpen the channel: ${config.publicUrl}/chat/${channel.id}\n`,
      });
    }
    await emitUnread(db, viewer.workspaceId, members.map((p) => p.id).filter((p) => p !== viewer.id));
    const reply = { status: 201, body: message };
    await ctx.settle(db, reply);
    return reply;
  });
});

route("GET", "/api/messages/:id/thread", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  return {
    status: 200,
    body: await tx(async (db) => {
      const root = await visibleMessage(db, viewer, ctx.params.id ?? "");
      if (root.thread_root_id !== null) throw new ApiError("not_found");
      const { rows } = await db.query<MessageRow>(`${MESSAGE_SELECT} WHERE m.thread_root_id = $1 ORDER BY m.id`, [root.id]);
      const [rootJson] = await messagesJson(db, viewer.workspaceId, viewer.id, [root]);
      return { root: rootJson, replies: await messagesJson(db, viewer.workspaceId, viewer.id, rows) };
    }),
  };
});

route("DELETE", "/api/messages/:id", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  await tx(async (db) => {
    const message = await visibleMessage(db, viewer, ctx.params.id ?? "");
    if (message.author_id !== viewer.id && viewer.role !== "owner") throw new ApiError("forbidden");
    const { rows } = await db.query<{ id: number; thread_root_id: number | null }>("SELECT id, thread_root_id FROM messages WHERE id = $1 OR thread_root_id = $1", [message.id]);
    const ids = rows.map((r) => r.id);
    await dropHeldMail(db, viewer.workspaceId, { messageIds: ids });
    await queueObjectDeletions(db, ids);
    await db.query("INSERT INTO deleted_messages (id, channel_id, thread_root_id) SELECT id, channel_id, thread_root_id FROM messages WHERE id = ANY($1)", [ids]);
    await db.query("DELETE FROM messages WHERE id = $1", [message.id]);
    await emit(db, viewer.workspaceId, "message_deleted", { id: message.id, channel_id: message.channel_id, thread_root_id: message.thread_root_id }, { channelId: message.channel_id });
    await emitUnread(db, viewer.workspaceId, (await channelMembers(db, message.channel_id)).map((p) => p.id));
  });
  return { status: 204 };
});

function upTo(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw invalid({ up_to: "Use the id of a message here." });
  return value;
}

route("POST", "/api/channels/:id/read", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  return {
    status: 200,
    body: await tx(async (db) => {
      const channel = await channelOf(db, viewer, ctx.params.id ?? "");
      const id = upTo(ctx.body.up_to);
      const { rows } = await db.query(
        "SELECT 1 FROM messages WHERE id = $1 AND channel_id = $2 UNION ALL SELECT 1 FROM deleted_messages WHERE id = $1 AND channel_id = $2",
        [id, channel.id],
      );
      if (!rows.length) throw invalid({ up_to: "Use the id of a message in this channel." });
      await db.query(
        "INSERT INTO read_markers (person_id, channel_id, up_to) VALUES ($1, $2, $3) ON CONFLICT (person_id, channel_id) DO UPDATE SET up_to = GREATEST(read_markers.up_to, EXCLUDED.up_to)",
        [viewer.id, channel.id, id],
      );
      await emitUnread(db, viewer.workspaceId, [viewer.id]);
      return unreadBody(db, viewer.id);
    }),
  };
});

route("POST", "/api/threads/:id/read", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  return {
    status: 200,
    body: await tx(async (db) => {
      const root = await visibleMessage(db, viewer, ctx.params.id ?? "");
      if (root.thread_root_id !== null) throw new ApiError("not_found");
      const id = upTo(ctx.body.up_to);
      const { rows } = await db.query(
        "SELECT 1 FROM messages WHERE id = $1 AND (id = $2 OR thread_root_id = $2) UNION ALL SELECT 1 FROM deleted_messages WHERE id = $1 AND thread_root_id = $2",
        [id, root.id],
      );
      if (!rows.length) throw invalid({ up_to: "Use the id of a message in this thread." });
      await db.query(
        "INSERT INTO thread_markers (person_id, root_id, up_to) VALUES ($1, $2, $3) ON CONFLICT (person_id, root_id) DO UPDATE SET up_to = GREATEST(thread_markers.up_to, EXCLUDED.up_to)",
        [viewer.id, root.id, id],
      );
      await emitUnread(db, viewer.workspaceId, [viewer.id]);
      return unreadBody(db, viewer.id);
    }),
  };
});

route("GET", "/api/unread", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  return { status: 200, body: await tx((db) => unreadBody(db, viewer.id)) };
});

route("GET", "/api/inbox", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  return {
    status: 200,
    body: await tx(async (db) => {
      const ids = await inboxMessageIds(db, viewer.id);
      const { rows } = await db.query<MessageRow>(`${MESSAGE_SELECT} WHERE m.id = ANY($1) ORDER BY m.id DESC`, [ids]);
      return { items: await messagesJson(db, viewer.workspaceId, viewer.id, rows) };
    }),
  };
});

route("POST", "/api/channels/:id/typing", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  await tx(async (db) => {
    const channel = await channelOf(db, viewer, ctx.params.id ?? "");
    await signalTyping(db, viewer.workspaceId, channel.id, viewer.id);
  });
  return { status: 204 };
});

/** Adds a person to a channel with their read marker at its newest message. */
export async function joinChannel(db: Db, workspaceId: string, channelId: string, personId: string): Promise<void> {
  await db.query("INSERT INTO channel_members (channel_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [channelId, personId]);
  await db.query(
    `INSERT INTO read_markers (person_id, channel_id, up_to) VALUES ($1, $2, COALESCE((SELECT max(id) FROM messages WHERE channel_id = $2), 0))
     ON CONFLICT (person_id, channel_id) DO UPDATE SET up_to = EXCLUDED.up_to`,
    [personId, channelId],
  );
  await emitUnread(db, workspaceId, [personId]);
}

/** Takes a person out of a channel: their streams get `revoked` and fresh counts. */
async function leaveChannel(db: Db, workspaceId: string, channelId: string, personId: string): Promise<void> {
  const { rows } = await db.query<{ person_id: string }>("DELETE FROM channel_members WHERE channel_id = $1 AND person_id::text = $2 RETURNING person_id", [channelId, personId]);
  if (!rows[0]) return;
  await dropHeldMail(db, workspaceId, { personId: rows[0].person_id, channelId });
  await stopTyping(db, workspaceId, channelId, personId);
  await emit(db, workspaceId, "revoked", { scope: "channel", id: channelId }, { recipients: [personId] });
  await emitUnread(db, workspaceId, [personId]);
}

async function activePerson(db: Db, viewer: Viewer, personId: unknown): Promise<string> {
  const { rows } = await db.query<{ id: string }>("SELECT id FROM people WHERE id::text = $1 AND workspace_id = $2", [typeof personId === "string" ? personId : "", viewer.workspaceId]);
  if (!rows[0]) throw invalid({ person_id: "Choose someone in this workspace." });
  return rows[0].id;
}

route("POST", "/api/channels/:id/members", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  await tx(async (db) => {
    const channel = await workspaceChannel(db, viewer, ctx.params.id ?? "");
    await joinChannel(db, viewer.workspaceId, channel.id, await activePerson(db, viewer, ctx.body.person_id));
  });
  return { status: 204 };
});

route("DELETE", "/api/channels/:id/members/:person", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  await tx(async (db) => {
    const channel = await workspaceChannel(db, viewer, ctx.params.id ?? "");
    await leaveChannel(db, viewer.workspaceId, channel.id, ctx.params.person ?? "");
  });
  return { status: 204 };
});


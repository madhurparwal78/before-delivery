import { blockExists, degreeBetween } from '../../domain/graph';
import { memberById, photoUrl } from '../../domain/members';
import { businessNow } from '../clock';
import { MESSAGE_MAX_CHARS } from '../config';
import { query } from '../db';
import { forbidden, notFound, validation } from '../errors';
import { newId } from '../ids';
import { jsonBody, requireMember, withIdempotency, type Ctx } from '../http';
import { pushTo } from '../live';
import { queueMail } from '../mail';

type ConversationRow = { id: string; member_a: string; member_b: string };

async function conversationFor(viewerId: string, id: string): Promise<{
  conversation: ConversationRow;
  otherId: string;
}> {
  const rows = await query<ConversationRow>(
    'SELECT id, member_a, member_b FROM conversations WHERE id = $1',
    [id],
  );
  const conversation = rows[0];
  if (!conversation) throw notFound();
  if (conversation.member_a !== viewerId && conversation.member_b !== viewerId) throw notFound();
  const otherId =
    conversation.member_a === viewerId ? conversation.member_b : conversation.member_a;
  if (await blockExists(viewerId, otherId)) throw notFound();
  return { conversation, otherId };
}

async function unreadCount(conversationId: string, memberId: string): Promise<number> {
  const rows = await query<{ count: string }>(
    `SELECT count(*) AS count FROM messages
     WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL`,
    [conversationId, memberId],
  );
  return Number(rows[0].count);
}

export async function listConversations(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const rows = await query<ConversationRow>(
    'SELECT id, member_a, member_b FROM conversations WHERE member_a = $1 OR member_b = $1',
    [viewerId],
  );
  const out: { body: Record<string, unknown>; sortKey: number }[] = [];
  for (const conversation of rows) {
    const otherId =
      conversation.member_a === viewerId ? conversation.member_b : conversation.member_a;
    if (await blockExists(viewerId, otherId)) continue;
    const other = await memberById(otherId);
    if (!other) continue;
    const last = await query<{ text: string; sent_at: Date; sender_id: string }>(
      'SELECT text, sent_at, sender_id FROM messages WHERE conversation_id = $1 ORDER BY sent_at DESC, id DESC LIMIT 1',
      [conversation.id],
    );
    out.push({
      sortKey: last[0] ? last[0].sent_at.getTime() : 0,
      body: {
        id: conversation.id,
        other: {
          id: other.id,
          name: other.name,
          handle: other.handle,
          photo_url: photoUrl(other.photo_id),
        },
        last_message: last[0]
          ? {
              text: last[0].text,
              sent_at: last[0].sent_at.toISOString(),
              sender_id: last[0].sender_id,
            }
          : null,
        unread_count: await unreadCount(conversation.id, viewerId),
      },
    });
  }
  out.sort((a, b) => b.sortKey - a.sortKey);
  return { status: 200, body: { conversations: out.map((entry) => entry.body) } };
}

/** Only 1st-degree connections can start a conversation or send. */
export async function createConversation(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const body = jsonBody(ctx);
  const memberId = String(body.member_id ?? '');
  const other = await memberById(memberId);
  if (!other || (await blockExists(viewerId, memberId))) throw notFound();
  if ((await degreeBetween(viewerId, memberId)) !== '1') throw forbidden('not_connected');
  const [low, high] = viewerId < memberId ? [viewerId, memberId] : [memberId, viewerId];
  const existing = await query<{ id: string }>(
    'SELECT id FROM conversations WHERE member_a = $1 AND member_b = $2',
    [low, high],
  );
  if (existing[0]) return { status: 200, body: { id: existing[0].id } };
  const id = newId('cnv');
  await query(
    'INSERT INTO conversations (id, member_a, member_b, created_at) VALUES ($1,$2,$3,$4)',
    [id, low, high, businessNow()],
  );
  return { status: 201, body: { id } };
}

export async function listMessages(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const { conversation } = await conversationFor(viewerId, ctx.params.id);
  const before = ctx.search.get('before');
  const rows = before
    ? await query<{ id: string; sender_id: string; text: string; sent_at: Date; read_at: Date | null }>(
        `SELECT id, sender_id, text, sent_at, read_at FROM messages
         WHERE conversation_id = $1 AND sent_at < $2 ORDER BY sent_at DESC, id DESC LIMIT 50`,
        [conversation.id, new Date(before)],
      )
    : await query<{ id: string; sender_id: string; text: string; sent_at: Date; read_at: Date | null }>(
        `SELECT id, sender_id, text, sent_at, read_at FROM messages
         WHERE conversation_id = $1 ORDER BY sent_at DESC, id DESC LIMIT 50`,
        [conversation.id],
      );
  const page = [...rows].reverse();
  const oldest = page[0];
  const more = rows.length === 50;
  return {
    status: 200,
    body: {
      messages: page.map((row) => ({
        id: row.id,
        sender_id: row.sender_id,
        text: row.text,
        sent_at: row.sent_at.toISOString(),
        read_at: row.read_at ? row.read_at.toISOString() : null,
      })),
      next_cursor: more && oldest ? oldest.sent_at.toISOString() : null,
    },
  };
}

export async function createMessage(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const conversationId = ctx.params.id;
  return withIdempotency(ctx, viewerId, 'POST /api/conversations/:id/messages', async () => {
    const { conversation, otherId } = await conversationFor(viewerId, conversationId);
    if ((await degreeBetween(viewerId, otherId)) !== '1') throw forbidden('not_connected');
    const body = jsonBody(ctx);
    const text = String(body.text ?? '');
    if (text.trim() === '') throw validation({ text: 'Write something first.' });
    if ([...text].length > MESSAGE_MAX_CHARS) {
      throw validation({ text: `Messages can be up to ${MESSAGE_MAX_CHARS} characters.` });
    }
    const before = await query<{ count: string }>(
      'SELECT count(*) AS count FROM messages WHERE conversation_id = $1',
      [conversation.id],
    );
    const first = Number(before[0].count) === 0;
    const id = newId('msg');
    const now = businessNow();
    await query(
      'INSERT INTO messages (id, conversation_id, sender_id, text, sent_at) VALUES ($1,$2,$3,$4,$5)',
      [id, conversation.id, viewerId, text, now],
    );
    const sender = await memberById(viewerId);
    const other = await memberById(otherId);
    if (first && sender && other) {
      await queueMail(
        other.email,
        `${sender.name} sent you a message`,
        `${sender.name} sent you a message on Plainwork. Open Messaging to read it.`,
      );
    }
    pushTo([otherId, viewerId], 'message', {
      conversation_id: conversation.id,
      message_id: id,
      sender_id: viewerId,
      sender_name: sender?.name ?? '',
    });
    return {
      status: 201,
      body: {
        id,
        sender_id: viewerId,
        text,
        sent_at: now.toISOString(),
        read_at: null,
      },
    };
  });
}

export async function markRead(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const { conversation, otherId } = await conversationFor(viewerId, ctx.params.id);
  const body = jsonBody(ctx);
  const upTo = String(body.up_to ?? '');
  const target = await query<{ sent_at: Date }>(
    'SELECT sent_at FROM messages WHERE id = $1 AND conversation_id = $2',
    [upTo, conversation.id],
  );
  if (target.length === 0) throw notFound();
  await query(
    `UPDATE messages SET read_at = $3 WHERE conversation_id = $1 AND sender_id <> $2
     AND read_at IS NULL AND sent_at <= $4`,
    [conversation.id, viewerId, businessNow(), target[0].sent_at],
  );
  pushTo([otherId, viewerId], 'read', { conversation_id: conversation.id });
  return { status: 200, body: { unread_count: await unreadCount(conversation.id, viewerId) } };
}

export async function sendTyping(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const { conversation, otherId } = await conversationFor(viewerId, ctx.params.id);
  if ((await degreeBetween(viewerId, otherId)) !== '1') throw forbidden('not_connected');
  const sender = await memberById(viewerId);
  pushTo([otherId], 'typing', {
    conversation_id: conversation.id,
    member_id: viewerId,
    name: sender?.name ?? '',
  });
  return { status: 204, body: null };
}

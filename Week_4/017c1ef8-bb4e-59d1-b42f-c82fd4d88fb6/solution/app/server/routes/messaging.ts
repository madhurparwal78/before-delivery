import type { FastifyInstance } from 'fastify';
import { memberOf } from '../auth.js';
import { conversationFor, listConversations, markRead, messagePage, openConversation, sendMessage, signalTyping } from '../domain/messaging.js';
import { pool, transaction } from '../db.js';
import { idempotent } from '../idempotency.js';

interface ConversationParams {
  id: string;
}

export async function messagingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/conversations', async (request) => ({ conversations: await listConversations(pool, memberOf(request).id) }));

  app.post('/api/conversations', async (request, reply) => {
    const member = memberOf(request);
    const body = (request.body ?? {}) as { member_id?: unknown };
    const opened = await transaction((tx) => openConversation(tx, member.id, typeof body.member_id === 'string' ? body.member_id : ''));
    return reply.status(opened.created ? 201 : 200).send({ id: opened.id });
  });

  app.get<{ Params: ConversationParams; Querystring: { before?: string } }>('/api/conversations/:id/messages', async (request) => {
    const conversation = await conversationFor(pool, memberOf(request).id, request.params.id);
    return messagePage(pool, conversation.id, request.query.before ?? null);
  });

  app.post<{ Params: ConversationParams }>('/api/conversations/:id/messages', async (request, reply) => {
    const member = memberOf(request);
    const conversation = await conversationFor(pool, member.id, request.params.id);
    return idempotent(request, reply, async (tx) => ({ status: 201, body: await sendMessage(tx, member, conversation, request.body ?? {}) }));
  });

  app.post<{ Params: ConversationParams }>('/api/conversations/:id/read', async (request) => {
    const member = memberOf(request);
    const conversation = await conversationFor(pool, member.id, request.params.id);
    const body = (request.body ?? {}) as { up_to?: unknown };
    return { unread_count: await transaction((tx) => markRead(tx, member.id, conversation, body.up_to)) };
  });

  app.post<{ Params: ConversationParams }>('/api/conversations/:id/typing', async (request, reply) => {
    const member = memberOf(request);
    const conversation = await conversationFor(pool, member.id, request.params.id);
    await transaction((tx) => signalTyping(tx, member.id, conversation));
    return reply.status(204).send();
  });
}

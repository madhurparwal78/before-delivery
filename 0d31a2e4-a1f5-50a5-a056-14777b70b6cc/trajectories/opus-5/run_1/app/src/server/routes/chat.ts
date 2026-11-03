import { type Router, requireId, requireUser } from '../http/router.js';
import {
  dmMessages,
  partyMessages,
  sendDirectMessage,
  sendPartyMessage,
} from '../services/chat.js';

export function registerChatRoutes(router: Router): void {
  router.add(
    'GET',
    '/api/party/messages',
    async (ctx) => ({
      status: 200,
      body: { messages: await partyMessages(requireUser(ctx).id) },
    }),
    { gated: true },
  );

  router.add(
    'POST',
    '/api/party/messages',
    async (ctx) => ({
      status: 201,
      body: { message: await sendPartyMessage(requireUser(ctx), ctx.body.body) },
    }),
    { gated: true },
  );

  router.add(
    'GET',
    '/api/dms/:userId/messages',
    async (ctx) => ({
      status: 200,
      body: { messages: await dmMessages(requireUser(ctx).id, requireId(ctx, 'userId')) },
    }),
    { gated: true },
  );

  router.add(
    'POST',
    '/api/dms/:userId/messages',
    async (ctx) => ({
      status: 201,
      body: {
        message: await sendDirectMessage(requireUser(ctx), requireId(ctx, 'userId'), ctx.body.body),
      },
    }),
    { gated: true },
  );
}

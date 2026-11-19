import type { ChatMessage } from '../../shared/wire';
import type { OpenedSession } from '../access';
import { config } from '../config';
import { one, pool, rows, run } from '../db';
import { derivePlaces } from '../domain/layout';
import { requireCapability } from '../domain/lifecycle';
import { notFound, Refusal, TEACHER_ONLY } from '../errors';
import { characters, param, reply, textOf, type Route } from '../http';
import { newId } from '../ids';
import { activeRound, latestRound, runningRound, type RoundRow } from '../live/breakouts';
import { announce, requireBus } from '../live/valkey';
import { worldNow } from '../world';
import { sessionOf } from './common';

interface MessageRow {
  id: string;
  author: string;
  text: string;
  sent_ms: number;
}

const toMessage = (row: MessageRow): ChatMessage => ({
  messageId: row.id,
  author: row.author,
  text: row.text,
  sentAt: new Date(row.sent_ms).toISOString(),
});

/** The table's chat a caller may open: teachers any table, a learner only the table they were dealt. */
async function openTable(opened: OpenedSession, tableId: string): Promise<RoundRow | null> {
  if (!derivePlaces(opened.session.layout).tables.some((table) => table.tableId === tableId)) throw notFound();
  const round = (await activeRound(opened.session.id)) ?? (await latestRound(opened.session.id));
  if (opened.role !== 'learner') return round;
  if (!round) throw notFound();
  const dealt = await one<{ table_id: string }>(pool, 'SELECT table_id FROM breakout_assignments WHERE round_id = $1 AND learner_id = $2', [round.id, opened.caller.id]);
  if (dealt?.table_id !== tableId) throw notFound();
  return round;
}

export const chatRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/sessions/:id/tables/:tableId/chat',
    handler: async (ctx) => {
      const opened = await sessionOf(ctx);
      const round = await openTable(opened, param(ctx.params, 'tableId'));
      const found = round
        ? await rows<MessageRow>(pool, 'SELECT id, author, text, sent_ms FROM chat_messages WHERE round_id = $1 AND table_id = $2 ORDER BY created_seq', [
            round.id,
            param(ctx.params, 'tableId'),
          ])
        : [];
      return reply(200, { messages: found.map(toMessage) });
    },
  },
  {
    method: 'POST',
    path: '/api/sessions/:id/tables/:tableId/chat',
    handler: async (ctx) => {
      const opened = await sessionOf(ctx);
      const tableId = param(ctx.params, 'tableId');
      await openTable(opened, tableId);
      if (opened.role === 'co-teacher') throw new Refusal(403, TEACHER_ONLY);
      requireCapability(opened.session.state, 'chat');
      const round = await runningRound(opened.session);
      const text = textOf((await ctx.json()).text)?.trim() ?? '';
      if (characters(text) < 1 || characters(text) > config.chatMaxChars) throw new Refusal(422, `Write 1 to ${config.chatMaxChars} characters.`);
      requireBus();
      const message: MessageRow = { id: newId('msg'), author: opened.caller.displayName, text, sent_ms: await worldNow(opened.session.world_id) };
      await run(pool, 'INSERT INTO chat_messages (id, round_id, table_id, author, text, sent_ms) VALUES ($1, $2, $3, $4, $5, $6)', [
        message.id,
        round.id,
        tableId,
        message.author,
        message.text,
        message.sent_ms,
      ]);
      await announce(opened.session.id, 'chat', { tableId, message: toMessage(message) });
      return reply(201, toMessage(message));
    },
  },
];


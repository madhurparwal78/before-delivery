import type { PollClosedBody, PollOpenedBody } from '../../shared/wire';
import { authenticate, openSession, requireLearner, requireTeaching, type OpenedSession } from '../access';
import { isUniqueViolation, one, pool, run, tx } from '../db';
import { requireCapability } from '../domain/lifecycle';
import { answersFrom, countsFrom } from '../domain/poll';
import { notFound, Refusal } from '../errors';
import { characters, param, reply, textOf, type Ctx, type Route } from '../http';
import { newId } from '../ids';
import { closePoll } from '../live/ending';
import { announce, answerPoll, pollTally, requireBus } from '../live/valkey';
import { sessionOf } from './common';

const CLOSED = 'This poll is closed.';

interface PollRow {
  id: string;
  session_id: string;
  options: string[];
  state: 'open' | 'closed';
}

async function pollOf(ctx: Ctx): Promise<{ opened: OpenedSession; poll: PollRow }> {
  const caller = await authenticate(ctx.req);
  const poll = await one<PollRow>(pool, 'SELECT id, session_id, options, state FROM polls WHERE id = $1', [param(ctx.params, 'id')]);
  if (!poll) throw notFound();
  return { opened: await openSession(caller, poll.session_id), poll };
}

function checkPoll(body: Record<string, unknown>): { question: string; options: string[] } {
  const question = textOf(body.question)?.trim() ?? '';
  if (characters(question) < 1 || characters(question) > 200) throw new Refusal(422, 'Write a question of 1 to 200 characters.');
  const listed = Array.isArray(body.options) ? body.options : [];
  if (listed.length < 2 || listed.length > 6) throw new Refusal(422, 'Give 2 to 6 options.');
  const options = listed.map((option: unknown) => textOf(option)?.trim() ?? '');
  if (options.some((option) => characters(option) < 1 || characters(option) > 80)) throw new Refusal(422, 'Each option needs 1 to 80 characters.');
  if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) throw new Refusal(422, 'Options must be different.');
  return { question, options };
}

export const pollRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/sessions/:id/polls',
    handler: async (ctx) => {
      const opened = await sessionOf(ctx);
      requireTeaching(opened.role);
      requireCapability(opened.session.state, 'poll');
      const sessionId = opened.session.id;
      const stillOpen = new Refusal(409, 'Close the open poll first.');
      if (await one(pool, "SELECT 1 AS found FROM polls WHERE session_id = $1 AND state = 'open'", [sessionId])) throw stillOpen;
      const { question, options } = checkPoll(await ctx.json());
      requireBus();
      const pollId = newId('pol');
      try {
        await run(pool, "INSERT INTO polls (id, session_id, question, options, state) VALUES ($1, $2, $3, $4, 'open')", [
          pollId,
          sessionId,
          question,
          JSON.stringify(options),
        ]);
      } catch (error) {
        if (isUniqueViolation(error)) throw stillOpen;
        throw error;
      }
      await announce(sessionId, 'poll-opened');
      const created: PollOpenedBody = { pollId, question, options, state: 'open' };
      return reply(201, created);
    },
  },
  {
    method: 'POST',
    path: '/api/polls/:id/answer',
    handler: async (ctx) => {
      const { opened, poll } = await pollOf(ctx);
      const learnerId = requireLearner(opened);
      if (poll.state === 'closed') throw new Refusal(409, CLOSED);
      requireCapability(opened.session.state, 'poll');
      const option = (await ctx.json()).option;
      if (typeof option !== 'number' || !Number.isInteger(option) || option < 1 || option > poll.options.length) {
        throw new Refusal(422, 'No such option.');
      }
      await answerPoll(poll.session_id, poll.id, learnerId, option);
      await announce(poll.session_id, 'poll-answered');
      return reply(200, { pollId: poll.id, yourAnswer: option });
    },
  },
  {
    method: 'POST',
    path: '/api/polls/:id/close',
    handler: async (ctx) => {
      const { opened, poll } = await pollOf(ctx);
      requireTeaching(opened.role);
      if (poll.state === 'closed') throw new Refusal(409, CLOSED);
      requireCapability(opened.session.state, 'poll');
      requireBus();
      const live = await pollTally(poll.session_id, poll.id);
      const closed = await tx((client) => closePoll(client, poll, countsFrom(poll.options.length, live.counts), answersFrom(live.answers)));
      if (!closed) throw new Refusal(409, CLOSED);
      await announce(poll.session_id, 'poll-closed');
      const body: PollClosedBody = { pollId: poll.id, total: closed.total, results: closed.results };
      return reply(200, body);
    },
  },
];

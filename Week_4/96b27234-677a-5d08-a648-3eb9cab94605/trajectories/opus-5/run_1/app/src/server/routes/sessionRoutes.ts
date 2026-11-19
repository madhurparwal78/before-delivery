import { notFound } from '../errors.js';
import { personOrThrow, readJsonBody, route, sendJson } from '../http.js';
import { one, query } from '../db.js';
import {
  chatHistory,
  detailFor,
  joinSession,
  leaveSession,
  lensFor,
  openSession,
  requireMembership,
  requireVisibleSession,
  sendChat,
  sitInSession,
  standInSession,
  stepInSession,
  summaryFor,
  visibleSessions
} from '../sessions.js';
import { castBallot, listVotes, startVote } from '../voting.js';

route('GET', '/api/sessions', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const lens = await lensFor(person);
  const search = (ctx.url.searchParams.get('q') ?? '').trim().toLowerCase();
  const sessions = await visibleSessions(person);
  const summaries = [];
  for (const session of sessions) {
    const summary = await summaryFor(lens, session);
    if (
      search === '' ||
      summary.roomName.toLowerCase().includes(search) ||
      summary.hostName.toLowerCase().includes(search)
    ) {
      summaries.push(summary);
    }
  }
  sendJson(ctx.res, 200, { sessions: summaries, total: summaries.length });
});

route('POST', '/api/sessions', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const body = await readJsonBody(ctx);
  const detail = await openSession(person, {
    roomId: body['roomId'],
    visibility: body['visibility'],
    capacity: body['capacity'],
    communityId: body['communityId'] ?? null
  });
  sendJson(ctx.res, 201, detail);
});

route('GET', '/api/sessions/:id', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const session = await requireVisibleSession(person, ctx.params['id'] ?? '');
  sendJson(ctx.res, 200, await detailFor(person, session));
});

route('POST', '/api/sessions/:id/join', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const session = await requireVisibleSession(person, ctx.params['id'] ?? '');
  sendJson(ctx.res, 200, await joinSession(person, session));
});

route('POST', '/api/sessions/:id/leave', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const session = await requireVisibleSession(person, ctx.params['id'] ?? '');
  const member = await requireMembership(person, session);
  await leaveSession(session, person.id, member.display_name);
  sendJson(ctx.res, 200, { status: 'left' });
});

route('POST', '/api/sessions/:id/invitees', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const session = await requireVisibleSession(person, ctx.params['id'] ?? '');
  if (session.host_id !== person.id) throw notFound();
  const body = await readJsonBody(ctx);
  const personId = typeof body['personId'] === 'string' ? body['personId'] : '';
  const guest = await one<{ id: string }>('select id from people where id = $1 and world_id = $2', [
    personId,
    person.world_id
  ]);
  if (guest === null) throw notFound();
  await query('insert into session_invitees (session_id, person_id) values ($1, $2) on conflict do nothing', [
    session.id,
    guest.id
  ]);
  sendJson(ctx.res, 201, { personId: guest.id });
});

route('POST', '/api/sessions/:id/step', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const session = await requireVisibleSession(person, ctx.params['id'] ?? '');
  const body = await readJsonBody(ctx);
  sendJson(ctx.res, 200, await stepInSession(person, session, body['direction']));
});

route('POST', '/api/sessions/:id/sit', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const session = await requireVisibleSession(person, ctx.params['id'] ?? '');
  sendJson(ctx.res, 200, await sitInSession(person, session));
});

route('POST', '/api/sessions/:id/stand', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const session = await requireVisibleSession(person, ctx.params['id'] ?? '');
  sendJson(ctx.res, 200, await standInSession(person, session));
});

route('POST', '/api/sessions/:id/chat', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const session = await requireVisibleSession(person, ctx.params['id'] ?? '');
  const body = await readJsonBody(ctx);
  sendJson(ctx.res, 201, await sendChat(person, session, body['text']));
});

route('GET', '/api/sessions/:id/chat', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const session = await requireVisibleSession(person, ctx.params['id'] ?? '');
  await requireMembership(person, session);
  sendJson(ctx.res, 200, { messages: await chatHistory(person, session) });
});

route('POST', '/api/sessions/:id/votes', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const session = await requireVisibleSession(person, ctx.params['id'] ?? '');
  const body = await readJsonBody(ctx);
  sendJson(ctx.res, 201, await startVote(person, session, body['personId']));
});

route('GET', '/api/sessions/:id/votes', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const session = await requireVisibleSession(person, ctx.params['id'] ?? '');
  await requireMembership(person, session);
  sendJson(ctx.res, 200, { votes: await listVotes(session) });
});

route('POST', '/api/sessions/:id/votes/:voteId/ballots', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const session = await requireVisibleSession(person, ctx.params['id'] ?? '');
  const body = await readJsonBody(ctx);
  sendJson(ctx.res, 201, await castBallot(person, session, ctx.params['voteId'] ?? '', body['choice']));
});

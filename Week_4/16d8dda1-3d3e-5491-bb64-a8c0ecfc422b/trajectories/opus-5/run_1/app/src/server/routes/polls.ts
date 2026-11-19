import type { ChatMessageJson, LayoutJson, ViewerRole } from '../../shared/types.js';
import { ApiError, asNumber, asString, errors, readJsonBody, sendJson } from '../http.js';
import { config } from '../config.js';
import { query, queryOne } from '../db.js';
import { newId } from '../ids.js';
import { worldNow } from '../clock.js';
import { derivePlan } from '../domain/layout.js';
import { breakoutsOver, requireState } from '../domain/lifecycle.js';
import { dealTables } from '../domain/breakouts.js';
import { judgePoll } from '../domain/polls.js';
import {
  applyPollAnswer,
  initPollCounts,
  requireLiveBus,
  setBreakoutDeadline,
  snapshotFor,
  writeBreakoutKeys
} from '../livestate.js';
import { announceChange } from '../hub.js';
import { closePoll } from '../sessionflow.js';
import {
  openSession,
  requireLearner,
  requireOwner,
  requireTeaching,
  requireViewer,
  type SessionRecord,
  type Viewer
} from '../access.js';
import type { Router } from '../router.js';

interface PollRow {
  id: string;
  session_id: string;
  question: string;
  options: string[];
  state: 'open' | 'closed';
}

async function openPollFor(sessionId: string): Promise<PollRow | null> {
  return queryOne<PollRow>(
    "SELECT id, session_id, question, options, state FROM polls WHERE session_id = $1 AND state = 'open'",
    [sessionId]
  );
}

/** A poll belongs to one session; a caller who cannot open that session gets 404. */
async function openPoll(
  viewer: Viewer,
  pollId: string
): Promise<{ poll: PollRow; session: SessionRecord; role: ViewerRole }> {
  const poll = await queryOne<PollRow>(
    'SELECT id, session_id, question, options, state FROM polls WHERE id = $1',
    [pollId]
  );
  if (poll === null) throw errors.notFound();
  const { session, role } = await openSession(viewer, poll.session_id);
  return { poll, session, role };
}

async function roundFor(sessionId: string): Promise<{ id: string; deadline: Date } | null> {
  return queryOne(
    `SELECT id, deadline FROM breakout_rounds WHERE session_id = $1 AND ended_at IS NULL
      ORDER BY started_at DESC LIMIT 1`,
    [sessionId]
  );
}

export function pollRoutes(router: Router): void {
  router.add('POST', '/api/sessions/:sessionId/polls', async ({ req, res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { session, role } = await openSession(signedIn, params.sessionId as string);
    requireTeaching(role);
    requireState('poll', session.state);
    if ((await openPollFor(session.id)) !== null) throw new ApiError(409, 'Close the open poll first.');
    const body = await readJsonBody(req);
    const judged = judgePoll(body.question, body.options);
    requireLiveBus();
    const id = newId('pol');
    const now = await worldNow(session.world_id);
    await query(
      "INSERT INTO polls (id, session_id, question, options, state, opened_at) VALUES ($1, $2, $3, $4, 'open', $5)",
      [id, session.id, judged.question, JSON.stringify(judged.options), now]
    );
    await initPollCounts(session, id, judged.options.length);
    await announceChange(session.id, 'poll-opened');
    sendJson(res, 201, { pollId: id, question: judged.question, options: judged.options, state: 'open' });
  });

  router.add('POST', '/api/polls/:pollId/answer', async ({ req, res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { poll, session, role } = await openPoll(signedIn, params.pollId as string);
    requireLearner(role);
    requireState('poll', session.state);
    if (poll.state !== 'open') throw new ApiError(409, 'This poll is closed.');
    const body = await readJsonBody(req);
    const option = asNumber(body.option);
    if (!Number.isInteger(option) || option < 1 || option > poll.options.length) {
      throw new ApiError(422, 'No such option.');
    }
    requireLiveBus();
    const previous = await queryOne<{ option: number }>(
      'SELECT option FROM poll_answers WHERE poll_id = $1 AND learner_id = $2',
      [poll.id, signedIn.id]
    );
    if (previous?.option === option) {
      sendJson(res, 200, { pollId: poll.id, yourAnswer: option });
      return;
    }
    await query(
      `INSERT INTO poll_answers (poll_id, learner_id, option) VALUES ($1, $2, $3)
         ON CONFLICT (poll_id, learner_id) DO UPDATE SET option = $3`,
      [poll.id, signedIn.id, option]
    );
    await applyPollAnswer(session, poll.id, option, previous?.option ?? null);
    await announceChange(session.id, 'poll-answer');
    sendJson(res, 200, { pollId: poll.id, yourAnswer: option });
  });

  router.add('POST', '/api/polls/:pollId/close', async ({ res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { poll, session, role } = await openPoll(signedIn, params.pollId as string);
    requireTeaching(role);
    requireState('poll', session.state);
    if (poll.state !== 'open') throw new ApiError(409, 'This poll is closed.');
    requireLiveBus();
    const now = await worldNow(session.world_id);
    const final = await closePoll(session, poll, now);
    await announceChange(session.id, 'poll-closed');
    sendJson(res, 200, { pollId: poll.id, total: final.total, results: final.results });
  });

  router.add('POST', '/api/sessions/:sessionId/breakouts', async ({ req, res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { session, cls, role } = await openSession(signedIn, params.sessionId as string);
    requireOwner(role);
    requireState('breakouts', session.state);
    const body = await readJsonBody(req);
    const plan = derivePlan(cls.layout);
    const seated = await query<{ seat_id: string; learner_id: string }>(
      'SELECT seat_id, learner_id FROM session_seats WHERE session_id = $1',
      [session.id]
    );
    const dealt = dealTables(
      seated.map((row) => ({ seatId: row.seat_id, learnerId: row.learner_id })),
      asNumber(body.tables),
      plan.tables.length
    );
    requireLiveBus();
    const now = await worldNow(session.world_id);
    const deadline = new Date(now.getTime() + config.breakoutSeconds * 1_000);
    const roundId = newId('brk');
    await query(
      `INSERT INTO breakout_rounds (id, session_id, tables, started_at, deadline, length_seconds, warning_seconds)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [roundId, session.id, dealt.length, now, deadline, config.breakoutSeconds, config.breakoutWarningSeconds]
    );
    const members = new Map<string, string>();
    for (const table of dealt) {
      for (const learnerId of table.learnerIds) {
        members.set(learnerId, table.tableId);
        await query('INSERT INTO breakout_members (round_id, learner_id, table_id) VALUES ($1, $2, $3)', [
          roundId,
          learnerId,
          table.tableId
        ]);
      }
    }
    await writeBreakoutKeys(session.id, deadline, dealt.length, members);
    await query("UPDATE sessions SET state = 'breakouts', breakout_rounds = breakout_rounds + 1 WHERE id = $1", [
      session.id
    ]);
    await announceChange(session.id, 'breakouts-started');
    const fresh = (await queryOne<SessionRecord>('SELECT * FROM sessions WHERE id = $1', [session.id])) ?? session;
    sendJson(res, 201, await snapshotFor(fresh, cls, { role, learnerId: null }));
  });

  router.add('POST', '/api/sessions/:sessionId/breakouts/extend', async ({ res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { session, cls, role } = await openSession(signedIn, params.sessionId as string);
    requireOwner(role);
    if (session.state !== 'breakouts') throw breakoutsOver();
    const round = await roundFor(session.id);
    const now = await worldNow(session.world_id);
    if (round === null || now.getTime() >= round.deadline.getTime()) throw breakoutsOver();
    requireLiveBus();
    const deadline = new Date(round.deadline.getTime() + config.breakoutExtendSeconds * 1_000);
    const stillWarned = deadline.getTime() - now.getTime() <= config.breakoutWarningSeconds * 1_000;
    await query('UPDATE breakout_rounds SET deadline = $2, length_seconds = length_seconds + $3, warned = $4 WHERE id = $1', [
      round.id,
      deadline,
      config.breakoutExtendSeconds,
      stillWarned
    ]);
    await setBreakoutDeadline(session.id, deadline);
    await announceChange(session.id, 'breakouts-extended');
    sendJson(res, 200, await snapshotFor(session, cls, { role, learnerId: null }));
  });

  router.add('GET', '/api/sessions/:sessionId/tables/:tableId/chat', async ({ res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { session, cls, role } = await openSession(signedIn, params.sessionId as string);
    const tableId = params.tableId as string;
    await requireTableToRead(session, cls.layout, role, role === 'learner' ? signedIn.id : null, tableId);
    const rows = await query<{ id: string; author: string; text: string; sent_at: Date }>(
      'SELECT id, author, text, sent_at FROM chat_messages WHERE session_id = $1 AND table_id = $2 ORDER BY position ASC',
      [session.id, tableId]
    );
    const messages: ChatMessageJson[] = rows.map((row) => ({
      messageId: row.id,
      author: row.author,
      text: row.text,
      sentAt: row.sent_at.toISOString()
    }));
    sendJson(res, 200, { messages });
  });

  router.add('POST', '/api/sessions/:sessionId/tables/:tableId/chat', async ({ req, res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { session, cls, role } = await openSession(signedIn, params.sessionId as string);
    const tableId = params.tableId as string;
    const round = await roundFor(session.id);
    await requireTableToPost(
      cls.layout,
      role,
      role === 'learner' ? signedIn.id : null,
      tableId,
      round?.id ?? null
    );
    if (role === 'co-teacher') throw errors.onlyTeacher();
    requireState('chat', session.state);
    const now = await worldNow(session.world_id);
    if (round === null || now.getTime() >= round.deadline.getTime()) throw breakoutsOver();
    const body = await readJsonBody(req);
    const text = asString(body.text).trim();
    if (text.length < 1 || text.length > config.chatMaxChars) {
      throw new ApiError(422, `Write 1 to ${config.chatMaxChars} characters.`);
    }
    requireLiveBus();
    const id = newId('msg');
    await query(
      'INSERT INTO chat_messages (id, session_id, table_id, author, text, sent_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, session.id, tableId, signedIn.displayName, text, now]
    );
    const message: ChatMessageJson & { tableId: string } = {
      messageId: id,
      tableId,
      author: signedIn.displayName,
      text,
      sentAt: now.toISOString()
    };
    await announceChange(session.id, 'chat', message);
    sendJson(res, 201, { messageId: id, author: message.author, text, sentAt: message.sentAt });
  });
}

function requireTable(layout: LayoutJson, tableId: string): void {
  if (!derivePlan(layout).tables.some((table) => table.tableId === tableId)) throw errors.notFound();
}

async function tableInRound(roundId: string, learnerId: string): Promise<string | null> {
  const membership = await queryOne<{ table_id: string }>(
    'SELECT table_id FROM breakout_members WHERE round_id = $1 AND learner_id = $2',
    [roundId, learnerId]
  );
  return membership?.table_id ?? null;
}

async function tableInLatestRound(sessionId: string, learnerId: string): Promise<string | null> {
  const membership = await queryOne<{ table_id: string }>(
    `SELECT m.table_id FROM breakout_members m
       JOIN breakout_rounds r ON r.id = m.round_id
      WHERE r.session_id = $1 AND m.learner_id = $2
      ORDER BY r.started_at DESC LIMIT 1`,
    [sessionId, learnerId]
  );
  return membership?.table_id ?? null;
}

/** DP-24, DP-34: another table's chat, and any table for a learner not dealt, is not there. */
async function requireTableToRead(
  session: SessionRecord,
  layout: LayoutJson,
  role: ViewerRole,
  learnerId: string | null,
  tableId: string
): Promise<void> {
  requireTable(layout, tableId);
  if (role !== 'learner') return;
  if (learnerId === null) throw errors.notFound();
  if ((await tableInLatestRound(session.id, learnerId)) !== tableId) throw errors.notFound();
}

/**
 * DP-24: while a round runs, a learner may post only to the table they were
 * dealt to; with no round running the post is simply too late.
 */
async function requireTableToPost(
  layout: LayoutJson,
  role: ViewerRole,
  learnerId: string | null,
  tableId: string,
  roundId: string | null
): Promise<void> {
  requireTable(layout, tableId);
  if (role !== 'learner' || roundId === null) return;
  if (learnerId === null) throw errors.notFound();
  if ((await tableInRound(roundId, learnerId)) !== tableId) throw errors.notFound();
}

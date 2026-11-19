import type { ServerResponse } from 'node:http';
import type { ViewerRole } from '../../shared/types.js';
import { ApiError, asNumber, asString, errors, readJsonBody, sendJson, sessionCookie } from '../http.js';
import { config } from '../config.js';
import { query, queryOne } from '../db.js';
import { newId, normaliseCode } from '../ids.js';
import { worldNow } from '../clock.js';
import { derivePlan } from '../domain/layout.js';
import { requireState, requireTransition } from '../domain/lifecycle.js';
import { formatWallTime, parseWallTime, wallTimeToInstant } from '../timezone.js';
import {
  openClass,
  openSession,
  requireLearner,
  requireOwner,
  requireTeaching,
  requireViewer,
  type ClassRecord,
  type SessionRecord
} from '../access.js';
import {
  leaveSeat,
  setHand,
  setLocked,
  setSlide,
  setSpotlight,
  snapshotFor,
  takeNextHand,
  takeSeat
} from '../livestate.js';
import { announceChange } from '../hub.js';
import { endSession } from '../sessionflow.js';
import { startLearnerSession } from '../auth.js';
import type { Router } from '../router.js';

async function confirmedSlideCount(lessonId: string): Promise<number> {
  const row = await queryOne<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM lesson_files WHERE lesson_id = $1 AND kind = 'slide' AND status = 'confirmed'",
    [lessonId]
  );
  return row?.count ?? 0;
}

export async function isPresent(session: SessionRecord, learnerId: string, now: Date): Promise<boolean> {
  const edge = new Date(now.getTime() - config.reconnectGraceSeconds * 1_000);
  const row = await queryOne<{ id: number }>(
    `SELECT id FROM presence
      WHERE session_id = $1 AND learner_id = $2 AND (left_at IS NULL OR left_at > $3) LIMIT 1`,
    [session.id, learnerId, edge]
  );
  return row !== null;
}

async function answerWithSnapshot(
  res: ServerResponse,
  session: SessionRecord,
  cls: ClassRecord,
  role: ViewerRole,
  learnerId: string | null
): Promise<void> {
  const fresh = (await queryOne<SessionRecord>('SELECT * FROM sessions WHERE id = $1', [session.id])) ?? session;
  sendJson(res, 200, await snapshotFor(fresh, cls, { role, learnerId }));
}

export function sessionRoutes(router: Router): void {
  router.add('POST', '/api/classes/:classId/sessions', async ({ req, res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { cls, role } = await openClass(signedIn, params.classId as string);
    if (role !== 'owner') throw errors.onlyTeacher();
    const body = await readJsonBody(req);
    const lessonId = asString(body.lessonId);
    const lesson = await queryOne<{ id: string }>('SELECT id FROM lessons WHERE id = $1 AND class_id = $2', [
      lessonId,
      cls.id
    ]);
    if (lesson === null) throw errors.notFound();
    const startsWall = parseWallTime(asString(body.startsAt));
    const endsWall = parseWallTime(asString(body.endsAt));
    if (startsWall === null || endsWall === null) {
      throw new ApiError(422, 'Use a date and time like 2027-03-09T19:00.');
    }
    const startsMillis = Date.UTC(
      startsWall.year,
      startsWall.month - 1,
      startsWall.day,
      startsWall.hour,
      startsWall.minute,
      startsWall.second
    );
    const endsMillis = Date.UTC(
      endsWall.year,
      endsWall.month - 1,
      endsWall.day,
      endsWall.hour,
      endsWall.minute,
      endsWall.second
    );
    if (endsMillis <= startsMillis) throw new ApiError(422, 'End the session after it starts.');
    const startsAt = wallTimeToInstant(cls.time_zone, startsWall);
    const endsAt = wallTimeToInstant(cls.time_zone, endsWall);
    if (startsAt === null || endsAt === null) {
      throw new ApiError(422, `That time doesn't exist in ${cls.time_zone}.`);
    }
    const id = newId('ses');
    const startsLocal = formatWallTime(startsWall);
    const endsLocal = formatWallTime(endsWall);
    await query(
      `INSERT INTO sessions (id, world_id, class_id, lesson_id, state, starts_at_local, ends_at_local, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, 'scheduled', $5, $6, $7, $8)`,
      [id, cls.world_id, cls.id, lessonId, startsLocal, endsLocal, startsAt, endsAt]
    );
    const created = (await queryOne<SessionRecord>('SELECT * FROM sessions WHERE id = $1', [id])) as SessionRecord;
    sendJson(res, 201, await snapshotFor(created, cls, { role: 'teacher', learnerId: null }));
  });

  router.add('GET', '/api/sessions/:sessionId', async ({ res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { session, cls, role } = await openSession(signedIn, params.sessionId as string);
    const learnerId = role === 'learner' ? signedIn.id : null;
    sendJson(res, 200, await snapshotFor(session, cls, { role, learnerId }));
  });

  for (const move of ['open', 'start', 'end'] as const) {
    router.add('POST', `/api/sessions/:sessionId/${move}`, async ({ res, viewer, params }) => {
      const signedIn = requireViewer(viewer);
      const { session, cls, role } = await openSession(signedIn, params.sessionId as string);
      requireOwner(role);
      requireTransition(move, session.state);
      const now = await worldNow(session.world_id);
      if (move === 'open') {
        const running = await queryOne<{ id: string }>(
          "SELECT id FROM sessions WHERE class_id = $1 AND state IN ('open', 'live', 'breakouts')",
          [cls.id]
        );
        if (running !== null) throw new ApiError(409, 'This class already has a session running.');
        await query("UPDATE sessions SET state = 'open' WHERE id = $1", [session.id]);
      } else if (move === 'start') {
        const lesson = await queryOne<{ state: string }>('SELECT state FROM lessons WHERE id = $1', [session.lesson_id]);
        if (lesson?.state !== 'ready') throw new ApiError(409, "The lesson isn't ready to teach.");
        await query("UPDATE sessions SET state = 'live' WHERE id = $1", [session.id]);
      } else {
        await endSession(session, now);
      }
      await announceChange(session.id, 'session-state');
      await answerWithSnapshot(res, session, cls, role, null);
    });
  }

  router.add('POST', '/api/join', async ({ req, res, viewer }) => {
    const body = await readJsonBody(req);
    const code = normaliseCode(asString(body.code));
    const displayName = asString(body.displayName).trim();
    const cls = await queryOne<ClassRecord>('SELECT * FROM classes WHERE code = $1', [code]);
    if (cls === null) throw errors.notFound();
    const session = await queryOne<SessionRecord>(
      `SELECT * FROM sessions WHERE class_id = $1 AND state IN ('open', 'live', 'breakouts')
        ORDER BY created_at DESC LIMIT 1`,
      [cls.id]
    );
    if (session === null) throw new ApiError(409, "This class isn't open right now.");
    const learner = viewer !== null && viewer.kind === 'learner' && viewer.worldId === cls.world_id ? viewer : null;
    const already =
      learner === null
        ? null
        : await queryOne<{ learner_id: string }>(
            'SELECT learner_id FROM session_learners WHERE session_id = $1 AND learner_id = $2',
            [session.id, learner.id]
          );
    if (already !== null) {
      sendJson(res, 200, { sessionId: session.id, learnerId: already.learner_id });
      return;
    }
    if (session.locked) {
      throw new ApiError(409, 'This class is locked. Ask your teacher to let you in.');
    }
    let learnerId = learner?.id ?? null;
    if (learnerId === null) {
      if (displayName.length < 1 || displayName.length > 40) {
        throw new ApiError(422, 'Enter a name of 1 to 40 characters.');
      }
      learnerId = newId('lrn');
      await query('INSERT INTO learners (id, world_id, display_name) VALUES ($1, $2, $3)', [
        learnerId,
        cls.world_id,
        displayName
      ]);
      const token = await startLearnerSession(learnerId);
      res.setHeader('set-cookie', sessionCookie(token));
    }
    await query('INSERT INTO enrolments (class_id, learner_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
      cls.id,
      learnerId
    ]);
    await query(
      `INSERT INTO session_learners (session_id, learner_id, via_join) VALUES ($1, $2, true)
         ON CONFLICT (session_id, learner_id) DO UPDATE SET via_join = true`,
      [session.id, learnerId]
    );
    sendJson(res, 201, { sessionId: session.id, learnerId });
  });

  router.add('POST', '/api/sessions/:sessionId/seat', async ({ req, res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { session, cls, role } = await openSession(signedIn, params.sessionId as string);
    requireLearner(role);
    requireState('seat', session.state);
    const body = await readJsonBody(req);
    const seatId = asString(body.seatId);
    const plan = derivePlan(cls.layout);
    if (!plan.seats.some((seat) => seat.seatId === seatId)) throw new ApiError(422, 'No such seat.');
    const result = await takeSeat(session, signedIn.id, seatId);
    if (!result.won) throw new ApiError(409, `Seat ${seatId} was just taken. Pick another seat.`);
    await announceChange(session.id, 'seat');
    await answerWithSnapshot(res, session, cls, role, signedIn.id);
  });

  router.add('DELETE', '/api/sessions/:sessionId/seat', async ({ res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { session, cls, role } = await openSession(signedIn, params.sessionId as string);
    requireLearner(role);
    requireState('seat', session.state);
    await leaveSeat(session, signedIn.id);
    await announceChange(session.id, 'seat');
    await answerWithSnapshot(res, session, cls, role, signedIn.id);
  });

  router.add('POST', '/api/sessions/:sessionId/slide', async ({ req, res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { session, cls, role } = await openSession(signedIn, params.sessionId as string);
    requireTeaching(role);
    requireState('slide', session.state);
    const body = await readJsonBody(req);
    const slide = asNumber(body.slide);
    const total = await confirmedSlideCount(session.lesson_id);
    if (!Number.isInteger(slide) || slide < 1 || slide > total) throw new ApiError(422, 'No such slide.');
    await setSlide(session, slide);
    await announceChange(session.id, 'slide');
    await answerWithSnapshot(res, session, cls, role, null);
  });

  router.add('POST', '/api/sessions/:sessionId/hand', async ({ req, res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { session, cls, role } = await openSession(signedIn, params.sessionId as string);
    requireLearner(role);
    requireState('hand', session.state);
    const body = await readJsonBody(req);
    const raised = body.raised === true;
    const seat = await queryOne<{ seat_id: string }>(
      'SELECT seat_id FROM session_seats WHERE session_id = $1 AND learner_id = $2',
      [session.id, signedIn.id]
    );
    if (seat === null) throw new ApiError(409, 'Take a seat to raise your hand.');
    const changed = await setHand(session, signedIn.id, raised);
    if (changed) await announceChange(session.id, 'hand');
    await answerWithSnapshot(res, session, cls, role, signedIn.id);
  });

  router.add('POST', '/api/sessions/:sessionId/hands/next', async ({ res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { session, cls, role } = await openSession(signedIn, params.sessionId as string);
    requireTeaching(role);
    requireState('hand', session.state);
    const learnerId = await takeNextHand(session);
    if (learnerId === null) throw new ApiError(409, 'No hands are raised.');
    const learner = await queryOne<{ display_name: string }>('SELECT display_name FROM learners WHERE id = $1', [
      learnerId
    ]);
    await announceChange(session.id, 'hand-taken');
    const fresh = (await queryOne<SessionRecord>('SELECT * FROM sessions WHERE id = $1', [session.id])) ?? session;
    sendJson(res, 200, {
      took: { learnerId, displayName: learner?.display_name ?? '' },
      snapshot: await snapshotFor(fresh, cls, { role, learnerId: null })
    });
  });

  router.add('POST', '/api/sessions/:sessionId/spotlight', async ({ req, res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { session, cls, role } = await openSession(signedIn, params.sessionId as string);
    requireTeaching(role);
    requireState('spotlight', session.state);
    const body = await readJsonBody(req);
    const learnerId = body.learnerId === null ? null : asString(body.learnerId);
    if (learnerId !== null) {
      const roster = await queryOne<{ learner_id: string }>(
        'SELECT learner_id FROM session_learners WHERE session_id = $1 AND learner_id = $2',
        [session.id, learnerId]
      );
      if (roster === null) throw errors.notFound();
      const now = await worldNow(session.world_id);
      if (!(await isPresent(session, learnerId, now))) {
        throw new ApiError(409, "That learner isn't in the room.");
      }
    }
    await setSpotlight(session, learnerId);
    await announceChange(session.id, 'spotlight');
    await answerWithSnapshot(res, session, cls, role, null);
  });

  router.add('POST', '/api/sessions/:sessionId/lock', async ({ req, res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { session, cls, role } = await openSession(signedIn, params.sessionId as string);
    requireOwner(role);
    requireState('lock', session.state);
    const body = await readJsonBody(req);
    await setLocked(session, body.locked === true);
    await announceChange(session.id, 'lock');
    await answerWithSnapshot(res, session, cls, role, null);
  });
}

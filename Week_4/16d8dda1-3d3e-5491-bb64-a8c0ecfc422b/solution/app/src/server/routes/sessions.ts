import { authenticate, openClass, openSession, requireLearner, requireOwner, requireTeaching } from '../access';
import { count, isUniqueViolation, one, pool, run, sole, tx } from '../db';
import { tablesInRange } from '../domain/breakout';
import { compareSeatIds } from '../../shared/seats';
import { derivePlaces } from '../domain/layout';
import { nextState, requireCapability } from '../domain/lifecycle';
import { instantToWall, parseWall, wallToInstant } from '../domain/time';
import { notFound, Refusal } from '../errors';
import { param, reply, textOf, type Route } from '../http';
import { newId } from '../ids';
import { beginBreakouts, extendBreakouts } from '../live/breakouts';
import { endRunningSession } from '../live/ending';
import { moveSession } from '../live/moves';
import { announce, claimSeat, freeSeat, isOnline, isUp, lowerHand, raiseHand, requireBus, seatsOf, seedLive, setLocked, setSlide, setSpotlight, takeHand } from '../live/valkey';
import { lessonFiles, lessonStateOf, loadLesson } from '../records';
import { sessionOf, snapshotOf, snapshotReply } from './common';

const BAD_TIME = 'Use a date and time like 2027-03-09T19:00.';

async function slideTotal(lessonId: string): Promise<number> {
  return count(pool, "SELECT count(*) AS n FROM lesson_files WHERE lesson_id = $1 AND kind = 'slide' AND status = 'confirmed'", [lessonId]);
}

async function nameOfLearner(learnerId: string): Promise<string> {
  return (await sole<{ display_name: string }>(pool, 'SELECT display_name FROM learners WHERE id = $1', [learnerId])).display_name;
}

export const sessionRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/classes/:id/sessions',
    handler: async (ctx) => {
      const caller = await authenticate(ctx.req);
      const { cls, role } = await openClass(caller, param(ctx.params, 'id'));
      requireOwner(role);
      const body = await ctx.json();
      const lesson = await loadLesson(textOf(body.lessonId) ?? '');
      if (lesson.class_id !== cls.id) throw notFound();
      const starts = parseWall(body.startsAt);
      const ends = parseWall(body.endsAt);
      if (!starts || !ends) throw new Refusal(422, BAD_TIME);
      const startsMs = wallToInstant(starts, cls.time_zone);
      const endsMs = wallToInstant(ends, cls.time_zone);
      if (startsMs === null || endsMs === null) throw new Refusal(422, `That time doesn't exist in ${cls.time_zone}.`);
      if (endsMs <= startsMs) throw new Refusal(422, 'End the session after it starts.');
      const id = newId('ses');
      await run(
        pool,
        `INSERT INTO sessions (id, class_id, lesson_id, state, starts_local, ends_local, starts_ms, ends_ms)
         VALUES ($1, $2, $3, 'scheduled', $4, $5, $6, $7)`,
        [id, cls.id, lesson.id, instantToWall(startsMs, cls.time_zone), instantToWall(endsMs, cls.time_zone), startsMs, endsMs],
      );
      return snapshotReply(await openSession(caller, id), 201);
    },
  },
  {
    method: 'GET',
    path: '/api/sessions/:id',
    handler: async (ctx) => snapshotReply(await sessionOf(ctx)),
  },
  {
    method: 'POST',
    path: '/api/sessions/:id/open',
    handler: async (ctx) => {
      const opened = await sessionOf(ctx);
      requireOwner(opened.role);
      const { session } = opened;
      try {
        await tx(async (client) => {
          await run(client, 'SELECT 1 FROM classes WHERE id = $1 FOR SHARE', [session.class_id]);
          await moveSession(client, session.id, 'open');
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new Refusal(409, 'This class already has a session running.');
        throw error;
      }
      if (isUp()) {
        await seedLive(session.id, { seats: {}, slide: session.current_slide, locked: false, hands: [], online: [], poll: null });
        await announce(session.id, 'state');
      }
      return snapshotReply(opened);
    },
  },
  {
    method: 'POST',
    path: '/api/sessions/:id/start',
    handler: async (ctx) => {
      const opened = await sessionOf(ctx);
      requireOwner(opened.role);
      const { session } = opened;
      await tx(async (client) => {
        await moveSession(client, session.id, 'start');
        const lesson = await loadLesson(session.lesson_id, client);
        const files = await lessonFiles(session.lesson_id, client);
        if (lessonStateOf(lesson.ready, files) !== 'ready') throw new Refusal(409, "The lesson isn't ready to teach.");
      });
      if (isUp()) {
        await setSlide(session.id, session.current_slide);
        await announce(session.id, 'state');
      }
      return snapshotReply(opened);
    },
  },
  {
    method: 'POST',
    path: '/api/sessions/:id/end',
    handler: async (ctx) => {
      const opened = await sessionOf(ctx);
      requireOwner(opened.role);
      nextState(opened.session.state, 'end');
      await endRunningSession(opened.session.id);
      return snapshotReply(opened);
    },
  },
  {
    method: 'POST',
    path: '/api/sessions/:id/seat',
    handler: async (ctx) => {
      const opened = await sessionOf(ctx);
      const learnerId = requireLearner(opened);
      requireCapability(opened.session.state, 'seat');
      const seatId = textOf((await ctx.json()).seatId);
      if (!seatId || !derivePlaces(opened.session.layout).seats.some((seat) => seat.seatId === seatId)) throw new Refusal(422, 'No such seat.');
      const claim = await claimSeat(opened.session.id, learnerId, seatId);
      if (claim === 'taken') throw new Refusal(409, `Seat ${seatId} was just taken. Pick another seat.`);
      if (claim === 'ok') await announce(opened.session.id, 'seat');
      return snapshotReply(opened);
    },
  },
  {
    method: 'DELETE',
    path: '/api/sessions/:id/seat',
    handler: async (ctx) => {
      const opened = await sessionOf(ctx);
      const learnerId = requireLearner(opened);
      requireCapability(opened.session.state, 'seat');
      await freeSeat(opened.session.id, learnerId);
      await announce(opened.session.id, 'seat');
      return snapshotReply(opened);
    },
  },
  {
    method: 'POST',
    path: '/api/sessions/:id/slide',
    handler: async (ctx) => {
      const opened = await sessionOf(ctx);
      requireTeaching(opened.role);
      requireCapability(opened.session.state, 'slide');
      const slide = (await ctx.json()).slide;
      const total = await slideTotal(opened.session.lesson_id);
      if (typeof slide !== 'number' || !Number.isInteger(slide) || slide < 1 || slide > total) throw new Refusal(422, 'No such slide.');
      requireBus();
      await setSlide(opened.session.id, slide);
      await announce(opened.session.id, 'slide');
      return snapshotReply(opened);
    },
  },
  {
    method: 'POST',
    path: '/api/sessions/:id/hand',
    handler: async (ctx) => {
      const opened = await sessionOf(ctx);
      const learnerId = requireLearner(opened);
      requireCapability(opened.session.state, 'hand');
      const raised = (await ctx.json()).raised === true;
      if (raised) {
        const raising = await raiseHand(opened.session.id, learnerId);
        if (raising === 'noseat') throw new Refusal(409, 'Take a seat to raise your hand.');
        if (raising === 'added') await announce(opened.session.id, 'hand-raised', { displayName: opened.caller.displayName });
      } else if (await lowerHand(opened.session.id, learnerId)) {
        await announce(opened.session.id, 'hand-lowered', { displayName: opened.caller.displayName });
      }
      return snapshotReply(opened);
    },
  },
  {
    method: 'POST',
    path: '/api/sessions/:id/hands/next',
    handler: async (ctx) => {
      const opened = await sessionOf(ctx);
      requireTeaching(opened.role);
      requireCapability(opened.session.state, 'hand');
      const learnerId = await takeHand(opened.session.id);
      if (!learnerId) throw new Refusal(409, 'No hands are raised.');
      await run(pool, 'INSERT INTO hand_takes (session_id, learner_id, taken_ms) VALUES ($1, $2, $3)', [opened.session.id, learnerId, Date.now()]);
      const displayName = await nameOfLearner(learnerId);
      await announce(opened.session.id, 'hand-taken', { displayName });
      return reply(200, { took: { learnerId, displayName }, snapshot: await snapshotOf(opened) });
    },
  },
  {
    method: 'POST',
    path: '/api/sessions/:id/spotlight',
    handler: async (ctx) => {
      const opened = await sessionOf(ctx);
      requireTeaching(opened.role);
      requireCapability(opened.session.state, 'spotlight');
      const target = (await ctx.json()).learnerId;
      if (target === null) {
        await setSpotlight(opened.session.id, null);
        await announce(opened.session.id, 'spotlight', { displayName: null });
        return snapshotReply(opened);
      }
      const learnerId = textOf(target) ?? '';
      const listed = await one(pool, 'SELECT 1 AS found FROM session_learners WHERE session_id = $1 AND learner_id = $2', [opened.session.id, learnerId]);
      if (!listed) throw notFound();
      if (!(await isOnline(opened.session.id, learnerId))) throw new Refusal(409, "That learner isn't in the room.");
      await setSpotlight(opened.session.id, learnerId);
      await announce(opened.session.id, 'spotlight', { displayName: await nameOfLearner(learnerId) });
      return snapshotReply(opened);
    },
  },
  {
    method: 'POST',
    path: '/api/sessions/:id/lock',
    handler: async (ctx) => {
      const opened = await sessionOf(ctx);
      requireOwner(opened.role);
      requireCapability(opened.session.state, 'lock');
      const locked = (await ctx.json()).locked === true;
      requireBus();
      await run(pool, 'UPDATE sessions SET locked = $2 WHERE id = $1', [opened.session.id, locked]);
      await setLocked(opened.session.id, locked);
      await announce(opened.session.id, 'lock');
      return snapshotReply(opened);
    },
  },
  {
    method: 'POST',
    path: '/api/sessions/:id/breakouts',
    handler: async (ctx) => {
      const opened = await sessionOf(ctx);
      requireOwner(opened.role);
      requireCapability(opened.session.state, 'breakouts');
      const available = derivePlaces(opened.session.layout).tables.length;
      const tables = (await ctx.json()).tables;
      if (!tablesInRange(tables, available)) throw new Refusal(422, `Choose 2 to ${available} tables.`);
      const seated = await seatsOf(opened.session.id);
      const learnerIds = Object.entries(seated)
        .sort(([a], [b]) => compareSeatIds(a, b))
        .map(([, learnerId]) => learnerId);
      await beginBreakouts(opened.session, tables, learnerIds);
      return snapshotReply(opened, 201);
    },
  },
  {
    method: 'POST',
    path: '/api/sessions/:id/breakouts/extend',
    handler: async (ctx) => {
      const opened = await sessionOf(ctx);
      requireOwner(opened.role);
      requireCapability(opened.session.state, 'extend');
      requireBus();
      await extendBreakouts(opened.session);
      return snapshotReply(opened);
    },
  },
];


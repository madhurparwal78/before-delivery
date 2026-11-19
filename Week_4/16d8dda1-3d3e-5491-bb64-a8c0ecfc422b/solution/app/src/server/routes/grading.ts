import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { compareSeatIds } from '../../shared/seats';
import type { Layout } from '../../shared/wire';
import { createAuthSession } from '../access';
import { config } from '../config';
import { isUniqueViolation, one, pool, run, tx } from '../db';
import { tablesInRange } from '../domain/breakout';
import { checkLayout, derivePlaces, STARTING_LAYOUT } from '../domain/layout';
import { instantToWall, isTimeZone, parseWall, wallToInstant } from '../domain/time';
import { notFound, Refusal, STORAGE_LOAD } from '../errors';
import { gemGlb, slidePng } from '../generate';
import { isRecord, reply, sessionCookie, textOf, type Ctx, type Route } from '../http';
import { newId } from '../ids';
import { beginBreakouts } from '../live/breakouts';
import { closePoll, finalizeSession } from '../live/ending';
import { processDue } from '../live/due';
import { putObject, lessonFileKey, setStorageOutage, storageIsUp } from '../objects';
import { isUp, requireBus, seedLive, setBusOutage } from '../live/valkey';
import { loadSession } from '../records';
import { newClassCode } from './classes';
import { emailKey, hashPassword } from './accounts';
import { DEFAULT_WORLD, worldNow } from '../world';

type Rec = Record<string, unknown>;

function problem(path: string, text: string): Refusal {
  return new Refusal(422, `${path}: ${text}`);
}

function items(spec: Rec, name: string): Rec[] {
  const found = spec[name];
  if (found === undefined) return [];
  if (!Array.isArray(found)) throw problem(name, 'must be a list');
  return found.map((item: unknown, index: number) => {
    if (!isRecord(item)) throw problem(`${name}[${index}]`, 'must be an object');
    return item;
  });
}

function text(item: Rec, name: string, path: string): string {
  const value = textOf(item[name]);
  if (value === undefined || value === '') throw problem(`${path}.${name}`, 'is required text');
  return value;
}

function whole(item: Rec, name: string, path: string): number {
  const value = item[name];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw problem(`${path}.${name}`, 'must be a whole number from 0');
  return value;
}

function instantOf(value: unknown, path: string): number {
  const parsed = typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw problem(path, 'must be an ISO time with an offset');
  return parsed;
}

interface Teacher { id: string; key: string; email: string; password: string; displayName: string }
interface ClassSpec { id: string; key: string; teacher: Teacher; coTeachers: Teacher[]; title: string; timeZone: string; code: string | null; layout: Layout }
interface LessonSpec { id: string; key: string; class: ClassSpec; title: string; slideCount: number; modelCount: number }
interface SessionSpec { id: string; key: string; class: ClassSpec; lesson: LessonSpec; state: string; startsMs: number; endsMs: number; currentSlide: number; locked: boolean }
interface LearnerSpec { id: string; key: string; displayName: string; session: SessionSpec; seat: string | null; presence: { joinedMs: number; leftMs: number | null }[] }
/** `answers` maps a learner id to the option number. */
interface PollSpec { id: string; key: string; session: SessionSpec; question: string; options: string[]; answers: Record<string, number>; closed: boolean }
interface WorldSpec {
  nowMs: number | null;
  teachers: Teacher[];
  classes: ClassSpec[];
  lessons: LessonSpec[];
  sessions: SessionSpec[];
  learners: LearnerSpec[];
  hands: { session: SessionSpec; learners: LearnerSpec[] }[];
  polls: PollSpec[];
  breakouts: { session: SessionSpec; tables: number }[];
}

const SESSION_STATES = ['scheduled', 'open', 'live', 'ended'];
const CODE = /^[A-HJKMNP-Z2-9]{6}$/;

function parseWorld(body: Rec): WorldSpec {
  const seen = new Set<string>();
  const claim = (key: string, path: string): string => {
    if (seen.has(key)) throw problem(path, `key "${key}" is used twice`);
    seen.add(key);
    return key;
  };
  const known = <T extends { key: string }>(list: T[], key: string, path: string): T => {
    const found = list.find((item) => item.key === key);
    if (!found) throw problem(path, `no such key "${key}"`);
    return found;
  };
  const nowMs = body.now === undefined || body.now === null ? null : instantOf(body.now, 'now');
  const teachers = items(body, 'teachers').map((item, index): Teacher => {
    const path = `teachers[${index}]`;
    return { id: newId('tch'), key: claim(text(item, 'key', path), `${path}.key`), email: text(item, 'email', path), password: text(item, 'password', path), displayName: text(item, 'displayName', path) };
  });
  const classes = items(body, 'classes').map((item, index): ClassSpec => {
    const path = `classes[${index}]`;
    const key = claim(text(item, 'key', path), `${path}.key`);
    const owner = known(teachers, text(item, 'teacher', path), `${path}.teacher`);
    const helpers = Array.isArray(item.coTeachers) ? item.coTeachers : [];
    const coTeachers = helpers.map((helper: unknown) => known(teachers, textOf(helper) ?? '', `${path}.coTeachers`));
    if (!isTimeZone(item.timeZone)) throw problem(`${path}.timeZone`, 'is not an IANA time zone');
    const code = item.code === undefined ? null : text(item, 'code', path);
    if (code !== null && !CODE.test(code)) throw problem(`${path}.code`, 'must be 6 characters from A-Z without I, L, O and 2-9');
    let layout: Layout;
    try {
      layout = checkLayout(item.layout ?? STARTING_LAYOUT);
    } catch (error) {
      throw problem(`${path}.layout`, error instanceof Error ? error.message : 'is not a room');
    }
    return { id: newId('cls'), key, teacher: owner, coTeachers, title: text(item, 'title', path), timeZone: item.timeZone, code, layout };
  });
  const lessons = items(body, 'lessons').map((item, index): LessonSpec => {
    const path = `lessons[${index}]`;
    return {
      id: newId('les'),
      key: claim(text(item, 'key', path), `${path}.key`),
      class: known(classes, text(item, 'class', path), `${path}.class`),
      title: text(item, 'title', path),
      slideCount: whole(item, 'slideCount', path),
      modelCount: whole(item, 'modelCount', path),
    };
  });
  const sessions = items(body, 'sessions').map((item, index): SessionSpec => {
    const path = `sessions[${index}]`;
    const cls = known(classes, text(item, 'class', path), `${path}.class`);
    const lesson = known(lessons, text(item, 'lesson', path), `${path}.lesson`);
    if (lesson.class !== cls) throw problem(`${path}.lesson`, 'belongs to another class');
    const state = text(item, 'state', path);
    if (!SESSION_STATES.includes(state)) throw problem(`${path}.state`, 'must be scheduled, open, live or ended');
    const starts = parseWall(item.startsAt);
    const ends = parseWall(item.endsAt);
    const startsMs = starts ? wallToInstant(starts, cls.timeZone) : null;
    const endsMs = ends ? wallToInstant(ends, cls.timeZone) : null;
    if (startsMs === null) throw problem(`${path}.startsAt`, 'is not a time in the class zone');
    if (endsMs === null || endsMs <= startsMs) throw problem(`${path}.endsAt`, 'is not a time after the start in the class zone');
    return {
      id: newId('ses'),
      key: claim(text(item, 'key', path), `${path}.key`),
      class: cls,
      lesson,
      state,
      startsMs,
      endsMs,
      currentSlide: item.currentSlide === undefined ? 1 : whole(item, 'currentSlide', path),
      locked: item.locked === true,
    };
  });
  const learners = items(body, 'learners').map((item, index): LearnerSpec => {
    const path = `learners[${index}]`;
    const session = known(sessions, text(item, 'session', path), `${path}.session`);
    const seat = item.seat === null || item.seat === undefined ? null : text(item, 'seat', path);
    if (seat !== null && !derivePlaces(session.class.layout).seats.some((place) => place.seatId === seat)) throw problem(`${path}.seat`, `no seat ${seat} in the room`);
    const presence = (Array.isArray(item.presence) ? item.presence : []).map((entry: unknown, at: number) => {
      const here = `${path}.presence[${at}]`;
      if (!isRecord(entry)) throw problem(here, 'must be an object');
      return { joinedMs: instantOf(entry.joinedAt, `${here}.joinedAt`), leftMs: entry.leftAt === null || entry.leftAt === undefined ? null : instantOf(entry.leftAt, `${here}.leftAt`) };
    });
    return { id: newId('lrn'), key: claim(text(item, 'key', path), `${path}.key`), displayName: text(item, 'displayName', path), session, seat, presence };
  });
  const seatsTaken = new Set<string>();
  for (const learner of learners.filter((entry) => entry.seat !== null)) {
    const mark = `${learner.session.key}/${learner.seat}`;
    if (seatsTaken.has(mark)) throw problem(`learners.${learner.key}.seat`, `seat ${learner.seat} is taken twice`);
    seatsTaken.add(mark);
  }
  const hands = items(body, 'hands').map((item, index) => {
    const path = `hands[${index}]`;
    const listed = Array.isArray(item.learners) ? item.learners : [];
    return {
      session: known(sessions, text(item, 'session', path), `${path}.session`),
      learners: listed.map((key: unknown) => known(learners, textOf(key) ?? '', `${path}.learners`)),
    };
  });
  const polls = items(body, 'polls').map((item, index): PollSpec => {
    const path = `polls[${index}]`;
    const options = (Array.isArray(item.options) ? item.options : []).map((option: unknown) => textOf(option) ?? '');
    if (options.length < 2 || options.length > 6) throw problem(`${path}.options`, 'needs 2 to 6 options');
    const answered = isRecord(item.answers) ? item.answers : {};
    const answers = Object.fromEntries(
      Object.entries(answered).map(([learner, option]) => {
        if (typeof option !== 'number' || !Number.isInteger(option) || option < 1 || option > options.length) throw problem(`${path}.answers.${learner}`, 'is not an option number');
        return [known(learners, learner, `${path}.answers`).id, option];
      }),
    );
    return {
      id: newId('pol'),
      key: claim(text(item, 'key', path), `${path}.key`),
      session: known(sessions, text(item, 'session', path), `${path}.session`),
      question: text(item, 'question', path),
      options,
      answers,
      closed: item.state === 'closed',
    };
  });
  const breakouts = items(body, 'breakouts').map((item, index) => {
    const path = `breakouts[${index}]`;
    const session = known(sessions, text(item, 'session', path), `${path}.session`);
    if (session.state !== 'live') throw problem(`${path}.session`, 'must be a live session');
    const tables = whole(item, 'tables', path);
    const available = derivePlaces(session.class.layout).tables.length;
    if (!tablesInRange(tables, available)) throw problem(`${path}.tables`, `must be 2 to ${available}`);
    return { session, tables };
  });
  return { nowMs, teachers, classes, lessons, sessions, learners, hands, polls, breakouts };
}

function pollCounts(poll: PollSpec): number[] {
  return poll.options.map((_, index) => Object.values(poll.answers).filter((option) => option === index + 1).length);
}

/** Who sits where in a session, seats in seat-id order. */
function seatedIn(spec: WorldSpec, session: SessionSpec): { seat: string; learnerId: string }[] {
  return spec.learners
    .flatMap((learner) => (learner.session === session && learner.seat !== null ? [{ seat: learner.seat, learnerId: learner.id }] : []))
    .sort((a, b) => compareSeatIds(a.seat, b.seat));
}

const entries = (specs: { key: string; id: string }[]): Record<string, string> => Object.fromEntries(specs.map((spec) => [spec.key, spec.id]));

async function createWorld(spec: WorldSpec): Promise<Rec> {
  for (const cls of spec.classes) {
    if (cls.code && (await one(pool, 'SELECT 1 AS found FROM classes WHERE code = $1', [cls.code]))) {
      throw new Refusal(409, `Class code ${cls.code} is already in use.`);
    }
  }
  for (const [index, teacher] of spec.teachers.entries()) {
    if (await one(pool, 'SELECT 1 AS found FROM teachers WHERE email_key = $1', [emailKey(teacher.email)])) {
      throw problem(`teachers[${index}].email`, 'an account with that email already exists');
    }
  }
  if (!(await storageIsUp())) throw new Refusal(503, STORAGE_LOAD);
  if (spec.sessions.some((session) => session.state === 'open' || session.state === 'live')) requireBus();

  const worldId = newId('wld');
  const codes: Record<string, string> = {};
  const lessonFileIds: Record<string, { slides: string[]; models: string[] }> = {};
  const tokens: Record<string, string> = {};

  try {
    await tx(async (client: PoolClient) => {
      await run(client, 'INSERT INTO worlds (id, clock_ms) VALUES ($1, $2)', [worldId, spec.nowMs]);
      for (const teacher of spec.teachers) {
        await run(client, 'INSERT INTO teachers (id, world_id, email, email_key, password_hash, display_name) VALUES ($1, $2, $3, $4, $5, $6)', [
          teacher.id, worldId, teacher.email, emailKey(teacher.email), await hashPassword(teacher.password), teacher.displayName,
        ]);
        tokens[teacher.key] = randomBytes(16).toString('hex');
        await run(client, "INSERT INTO grading_tokens (token, kind, person_id) VALUES ($1, 'teacher', $2)", [tokens[teacher.key], teacher.id]);
      }
      for (const cls of spec.classes) {
        let code = cls.code ?? newClassCode();
        while (!cls.code && (await one(client, 'SELECT 1 AS found FROM classes WHERE code = $1', [code]))) code = newClassCode();
        codes[cls.key] = code;
        await run(client, 'INSERT INTO classes (id, world_id, owner_id, title, time_zone, code, layout) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
          cls.id, worldId, cls.teacher.id, cls.title, cls.timeZone, code, JSON.stringify(cls.layout),
        ]);
        for (const helper of cls.coTeachers) {
          await run(client, 'INSERT INTO co_teachers (class_id, teacher_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [cls.id, helper.id]);
        }
      }
      for (const lesson of spec.lessons) {
        await run(client, 'INSERT INTO lessons (id, class_id, title, ready) VALUES ($1, $2, $3, $4)', [lesson.id, lesson.class.id, lesson.title, lesson.slideCount > 0]);
        const made = { slides: [] as string[], models: [] as string[] };
        const store = async (kind: 'slide' | 'model', position: number, name: string, data: Buffer, contentType: string): Promise<void> => {
          const fileId = newId('fil');
          await putObject(lessonFileKey(lesson.id, fileId), data, contentType);
          await run(client, "INSERT INTO lesson_files (id, lesson_id, name, kind, position, bytes, status, content_type) VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', $7)", [
            fileId, lesson.id, name, kind, position, data.length, contentType,
          ]);
          (kind === 'slide' ? made.slides : made.models).push(fileId);
        };
        for (let n = 1; n <= lesson.slideCount; n += 1) await store('slide', n - 1, `slide-${n}.png`, slidePng(n), 'image/png');
        for (let n = 1; n <= lesson.modelCount; n += 1) await store('model', n - 1, `model-${n}.glb`, gemGlb(), 'model/gltf-binary');
        lessonFileIds[lesson.key] = made;
      }
      for (const session of spec.sessions) {
        await run(
          client,
          `INSERT INTO sessions (id, class_id, lesson_id, state, starts_local, ends_local, starts_ms, ends_ms, current_slide, locked)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [session.id, session.class.id, session.lesson.id, session.state, instantToWall(session.startsMs, session.class.timeZone),
           instantToWall(session.endsMs, session.class.timeZone), session.startsMs, session.endsMs, session.currentSlide, session.locked],
        );
      }
      for (const learner of spec.learners) {
        await run(client, 'INSERT INTO learners (id, world_id, display_name) VALUES ($1, $2, $3)', [learner.id, worldId, learner.displayName]);
        await run(client, 'INSERT INTO enrolments (class_id, learner_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [learner.session.class.id, learner.id]);
        await run(client, 'INSERT INTO session_learners (session_id, learner_id, joined) VALUES ($1, $2, false)', [learner.session.id, learner.id]);
        for (const stay of learner.presence) {
          await run(client, 'INSERT INTO presence_intervals (session_id, learner_id, joined_ms, left_ms) VALUES ($1, $2, $3, $4)', [learner.session.id, learner.id, stay.joinedMs, stay.leftMs]);
        }
        tokens[learner.key] = randomBytes(16).toString('hex');
        await run(client, "INSERT INTO grading_tokens (token, kind, person_id) VALUES ($1, 'learner', $2)", [tokens[learner.key], learner.id]);
      }
      for (const poll of spec.polls) {
        await run(client, "INSERT INTO polls (id, session_id, question, options, state) VALUES ($1, $2, $3, $4, 'open')", [poll.id, poll.session.id, poll.question, JSON.stringify(poll.options)]);
        if (poll.closed || poll.session.state === 'ended') await closePoll(client, poll, pollCounts(poll), poll.answers);
      }
      for (const session of spec.sessions.filter((entry) => entry.state === 'ended')) {
        const seats = Object.fromEntries(seatedIn(spec, session).map(({ seat, learnerId }) => [seat, learnerId]));
        await finalizeSession(client, session.id, { seats, slide: session.currentSlide, pollCounts: [], answers: {} });
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new Refusal(422, 'sessions: a class has at most one open or live session, and one open poll per session');
    throw error;
  }

  for (const session of spec.sessions.filter((entry) => entry.state === 'open' || entry.state === 'live')) {
    const here = spec.learners.filter((learner) => learner.session === session);
    const open = spec.polls.find((poll) => poll.session === session && !poll.closed);
    await seedLive(session.id, {
      seats: Object.fromEntries(seatedIn(spec, session).map(({ seat, learnerId }) => [seat, learnerId])),
      slide: session.currentSlide,
      locked: session.locked,
      hands: (spec.hands.find((entry) => entry.session === session)?.learners ?? []).map((learner) => learner.id),
      online: here.filter((learner) => learner.presence.some((stay) => stay.leftMs === null)).map((learner) => learner.id),
      poll: open
        ? {
            pollId: open.id,
            counts: Object.fromEntries(pollCounts(open).map((count, index) => [String(index + 1), count])),
            answers: open.answers,
          }
        : null,
    });
  }
  for (const round of spec.breakouts) {
    await beginBreakouts(await loadSession(round.session.id), round.tables, seatedIn(spec, round.session).map(({ learnerId }) => learnerId));
  }

  return {
    worldId,
    teachers: entries(spec.teachers),
    classes: Object.fromEntries(spec.classes.map((cls) => [cls.key, { id: cls.id, code: codes[cls.key] }])),
    lessons: Object.fromEntries(spec.lessons.map((lesson) => [lesson.key, { id: lesson.id, ...lessonFileIds[lesson.key] }])),
    sessions: entries(spec.sessions),
    learners: entries(spec.learners),
    polls: entries(spec.polls),
    signInTokens: tokens,
  };
}

function gated(ctx: Ctx): void {
  if (!config.gradingKey || ctx.req.headers['x-grading-key'] !== config.gradingKey) throw notFound();
}

export const gradingRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/grading/setup',
    handler: async (ctx) => {
      gated(ctx);
      return reply(201, await createWorld(parseWorld(await ctx.json())));
    },
  },
  {
    method: 'POST',
    path: '/api/grading/sign-in',
    handler: async (ctx) => {
      gated(ctx);
      const token = textOf((await ctx.json()).token) ?? '';
      const used = await one<{ kind: 'teacher' | 'learner'; person_id: string }>(
        pool,
        'UPDATE grading_tokens SET used = true WHERE token = $1 AND used = false RETURNING kind, person_id',
        [token],
      );
      if (!used) throw notFound();
      const cookie = sessionCookie(await createAuthSession(used.kind, used.person_id));
      return reply(200, { role: used.kind, id: used.person_id }, { 'Set-Cookie': cookie });
    },
  },
  {
    method: 'POST',
    path: '/api/grading/clock',
    handler: async (ctx) => {
      gated(ctx);
      const body = await ctx.json();
      const worldId = textOf(body.worldId) ?? '';
      if (worldId === DEFAULT_WORLD || !(await one(pool, 'SELECT 1 AS found FROM worlds WHERE id = $1', [worldId]))) throw notFound();
      const nowMs = body.now === null ? null : instantOf(body.now, 'now');
      await run(pool, 'UPDATE worlds SET clock_ms = $2 WHERE id = $1', [worldId, nowMs]);
      if (isUp()) await processDue(worldId);
      return reply(200, { worldId, now: new Date(await worldNow(worldId)).toISOString() });
    },
  },
  {
    method: 'POST',
    path: '/api/grading/outage',
    handler: async (ctx) => {
      gated(ctx);
      const body = await ctx.json();
      if (body.service !== 'valkey' && body.service !== 'minio') throw new Refusal(422, 'Choose valkey or minio.');
      const down = body.down === true;
      if (body.service === 'valkey') setBusOutage(down);
      else setStorageOutage(down);
      return reply(200, { service: body.service, down });
    },
  },
];

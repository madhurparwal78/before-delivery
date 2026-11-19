import type { LayoutJson, SessionState } from '../../shared/types.js';
import { ApiError, asString, errors, readJsonBody, sendJson } from '../http.js';
import { config } from '../config.js';
import { query, queryOne } from '../db.js';
import { newId, newToken } from '../ids.js';
import { createWorld, setWorldClock, worldExists, worldNow } from '../clock.js';
import { hashPassword, startLearnerSession, startTeacherSession } from '../auth.js';
import { planRoom } from '../domain/layout.js';
import { dealTables } from '../domain/breakouts.js';
import { tally } from '../domain/polls.js';
import { formatWallTime, isValidTimeZone, parseWallTime, toUtcIso, wallTimeToInstant } from '../timezone.js';
import { makeModelGlb, makeSlidePng } from '../media.js';
import { objectKeyFor, store, StorageError } from '../storage.js';
import { bus } from '../valkey.js';
import { endSession, pushWorldClock, runDue } from '../sessionflow.js';
import { sessionById } from '../access.js';
import { uniqueClassCode } from './classes.js';
import { sessionCookie } from '../http.js';
import type { Router } from '../router.js';

function refuse(problem: string): never {
  throw new ApiError(422, problem);
}

function list(value: unknown, field: string): Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) refuse(`${field} must be a list.`);
  return value.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) refuse(`${field}[${index}] must be an object.`);
    return entry as Record<string, unknown>;
  });
}

function text(entry: Record<string, unknown>, field: string, where: string): string {
  const value = entry[field];
  if (typeof value !== 'string' || value.trim() === '') refuse(`${where}.${field} is required.`);
  return value;
}

function count(entry: Record<string, unknown>, field: string, where: string): number {
  const value = entry[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) refuse(`${where}.${field} must be a whole number.`);
  return value;
}

function instant(value: unknown, where: string): Date {
  if (typeof value !== 'string') refuse(`${where} must be an ISO instant.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) refuse(`${where} must be an ISO instant.`);
  return parsed;
}

interface Built {
  worldId: string;
  teachers: Record<string, string>;
  classes: Record<string, { id: string; code: string }>;
  lessons: Record<string, { id: string; slides: string[]; models: string[] }>;
  sessions: Record<string, string>;
  learners: Record<string, string>;
  polls: Record<string, string>;
  signInTokens: Record<string, string>;
}

async function buildWorld(body: Record<string, unknown>): Promise<Built> {
  const worldId = newId('wld');
  const clock = body.now === undefined || body.now === null ? null : instant(body.now, 'now');
  const built: Built = {
    worldId,
    teachers: {},
    classes: {},
    lessons: {},
    sessions: {},
    learners: {},
    polls: {},
    signInTokens: {}
  };

  const teacherEntries = list(body.teachers, 'teachers');
  const classEntries = list(body.classes, 'classes');
  const lessonEntries = list(body.lessons, 'lessons');
  const sessionEntries = list(body.sessions, 'sessions');
  const learnerEntries = list(body.learners, 'learners');
  const handEntries = list(body.hands, 'hands');
  const pollEntries = list(body.polls, 'polls');
  const breakoutEntries = list(body.breakouts, 'breakouts');

  const codes = new Map<string, string>();
  for (const [index, entry] of classEntries.entries()) {
    const code = entry.code;
    if (code === undefined) continue;
    if (typeof code !== 'string' || code.trim() === '') refuse(`classes[${index}].code must be text.`);
    const clash = await queryOne<{ code: string }>('SELECT code FROM classes WHERE code = $1', [code]);
    if (clash !== null) throw new ApiError(409, `Class code ${code} is already in use.`);
    codes.set(text(entry, 'key', `classes[${index}]`), code);
  }

  await createWorld(worldId, clock);
  const now = clock ?? new Date();

  for (const [index, entry] of teacherEntries.entries()) {
    const where = `teachers[${index}]`;
    const key = text(entry, 'key', where);
    const email = text(entry, 'email', where);
    const password = text(entry, 'password', where);
    const displayName = text(entry, 'displayName', where);
    const id = newId('tch');
    await query(
      `INSERT INTO teachers (id, world_id, email, email_lower, password_hash, display_name, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, worldId, email, email.toLowerCase(), await hashPassword(password), displayName, now]
    );
    built.teachers[key] = id;
  }

  for (const [index, entry] of classEntries.entries()) {
    const where = `classes[${index}]`;
    const key = text(entry, 'key', where);
    const ownerKey = text(entry, 'teacher', where);
    const ownerId = built.teachers[ownerKey];
    if (ownerId === undefined) refuse(`${where}.teacher names no teacher in this request.`);
    const timeZone = text(entry, 'timeZone', where);
    if (!isValidTimeZone(timeZone)) refuse(`${where}.timeZone must be an IANA zone name.`);
    const layout: LayoutJson =
      entry.layout === undefined
        ? { columns: 8, rows: 6, pieces: [{ kind: 'board', column: 2, row: 0 }] }
        : planRoom(entry.layout).layout;
    const id = newId('cls');
    const code = codes.get(key) ?? (await uniqueClassCode());
    await query(
      `INSERT INTO classes (id, world_id, owner_id, title, time_zone, code, layout, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, worldId, ownerId, text(entry, 'title', where), timeZone, code, JSON.stringify(layout), now]
    );
    const coTeachers = Array.isArray(entry.coTeachers) ? entry.coTeachers : [];
    for (const coTeacher of coTeachers) {
      const coId = built.teachers[String(coTeacher)];
      if (coId === undefined) refuse(`${where}.coTeachers names no teacher in this request.`);
      await query('INSERT INTO class_co_teachers (class_id, teacher_id, created_at) VALUES ($1, $2, $3)', [
        id,
        coId,
        now
      ]);
    }
    built.classes[key] = { id, code };
  }

  for (const [index, entry] of lessonEntries.entries()) {
    const where = `lessons[${index}]`;
    const key = text(entry, 'key', where);
    const classKey = text(entry, 'class', where);
    const cls = built.classes[classKey];
    if (cls === undefined) refuse(`${where}.class names no class in this request.`);
    const slideCount = count(entry, 'slideCount', where);
    const modelCount = count(entry, 'modelCount', where);
    const lessonId = newId('les');
    const state = slideCount > 0 ? 'ready' : 'draft';
    await query(
      'INSERT INTO lessons (id, world_id, class_id, title, state, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [lessonId, worldId, cls.id, text(entry, 'title', where), state, now]
    );
    const slides: string[] = [];
    const models: string[] = [];
    try {
      for (let number = 1; number <= slideCount; number += 1) {
        const fileId = newId('fil');
        const bytes = makeSlidePng(number);
        await store.put(objectKeyFor(lessonId, fileId), bytes, 'image/png');
        await query(
          `INSERT INTO lesson_files (id, lesson_id, kind, name, content_type, bytes, status, position, created_at)
             VALUES ($1, $2, 'slide', $3, 'image/png', $4, 'confirmed', $5, $6)`,
          [fileId, lessonId, `slide-${number}.png`, bytes.byteLength, number, now]
        );
        slides.push(fileId);
      }
      for (let number = 1; number <= modelCount; number += 1) {
        const fileId = newId('fil');
        const bytes = makeModelGlb(number);
        await store.put(objectKeyFor(lessonId, fileId), bytes, 'model/gltf-binary');
        await query(
          `INSERT INTO lesson_files (id, lesson_id, kind, name, content_type, bytes, status, position, created_at)
             VALUES ($1, $2, 'model', $3, 'model/gltf-binary', $4, 'confirmed', $5, $6)`,
          [fileId, lessonId, `model-${number}.glb`, bytes.byteLength, number, now]
        );
        models.push(fileId);
      }
    } catch (error) {
      if (error instanceof StorageError) throw errors.filesUnreadable();
      throw error;
    }
    built.lessons[key] = { id: lessonId, slides, models };
  }

  const endedSessions: { id: string; endsAt: Date }[] = [];
  for (const [index, entry] of sessionEntries.entries()) {
    const where = `sessions[${index}]`;
    const key = text(entry, 'key', where);
    const cls = built.classes[text(entry, 'class', where)];
    if (cls === undefined) refuse(`${where}.class names no class in this request.`);
    const lesson = built.lessons[text(entry, 'lesson', where)];
    if (lesson === undefined) refuse(`${where}.lesson names no lesson in this request.`);
    const classRow = await queryOne<{ time_zone: string }>('SELECT time_zone FROM classes WHERE id = $1', [cls.id]);
    const zone = classRow?.time_zone as string;
    const startsWall = parseWallTime(text(entry, 'startsAt', where));
    const endsWall = parseWallTime(text(entry, 'endsAt', where));
    if (startsWall === null || endsWall === null) refuse(`${where}.startsAt must look like 2027-03-09T19:00.`);
    const startsAt = wallTimeToInstant(zone, startsWall);
    const endsAt = wallTimeToInstant(zone, endsWall);
    if (startsAt === null || endsAt === null) refuse(`${where}.startsAt does not exist in ${zone}.`);
    const state = text(entry, 'state', where) as SessionState;
    if (!['scheduled', 'open', 'live', 'ended'].includes(state)) {
      refuse(`${where}.state must be scheduled, open, live or ended.`);
    }
    const id = newId('ses');
    await query(
      `INSERT INTO sessions (id, world_id, class_id, lesson_id, state, starts_at_local, ends_at_local,
                             starts_at, ends_at, current_slide, locked, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        worldId,
        cls.id,
        lesson.id,
        state === 'ended' ? 'live' : state,
        formatWallTime(startsWall),
        formatWallTime(endsWall),
        startsAt,
        endsAt,
        entry.currentSlide === undefined ? 1 : count(entry, 'currentSlide', where),
        entry.locked === true,
        now
      ]
    );
    built.sessions[key] = id;
    if (state === 'ended') endedSessions.push({ id, endsAt });
  }

  for (const [index, entry] of learnerEntries.entries()) {
    const where = `learners[${index}]`;
    const key = text(entry, 'key', where);
    const sessionId = built.sessions[text(entry, 'session', where)];
    if (sessionId === undefined) refuse(`${where}.session names no session in this request.`);
    const learnerId = newId('lrn');
    await query('INSERT INTO learners (id, world_id, display_name, created_at) VALUES ($1, $2, $3, $4)', [
      learnerId,
      worldId,
      text(entry, 'displayName', where),
      now
    ]);
    const session = await sessionById(sessionId);
    if (session !== null) {
      await query('INSERT INTO enrolments (class_id, learner_id, created_at) VALUES ($1, $2, $3)', [
        session.class_id,
        learnerId,
        now
      ]);
    }
    await query('INSERT INTO session_learners (session_id, learner_id, via_join) VALUES ($1, $2, false)', [
      sessionId,
      learnerId
    ]);
    for (const [slot, interval] of list(entry.presence, `${where}.presence`).entries()) {
      const joinedAt = instant(interval.joinedAt, `${where}.presence[${slot}].joinedAt`);
      const leftAt = interval.leftAt === undefined || interval.leftAt === null
        ? null
        : instant(interval.leftAt, `${where}.presence[${slot}].leftAt`);
      await query('INSERT INTO presence (session_id, learner_id, joined_at, left_at) VALUES ($1, $2, $3, $4)', [
        sessionId,
        learnerId,
        joinedAt,
        leftAt
      ]);
    }
    const seat = entry.seat;
    if (typeof seat === 'string' && seat !== '') {
      await query('INSERT INTO session_seats (session_id, seat_id, learner_id) VALUES ($1, $2, $3)', [
        sessionId,
        seat,
        learnerId
      ]);
    }
    built.learners[key] = learnerId;
  }

  for (const [index, entry] of handEntries.entries()) {
    const where = `hands[${index}]`;
    const sessionId = built.sessions[text(entry, 'session', where)];
    if (sessionId === undefined) refuse(`${where}.session names no session in this request.`);
    const queue = Array.isArray(entry.learners) ? entry.learners : [];
    for (const [position, learnerKey] of queue.entries()) {
      const learnerId = built.learners[String(learnerKey)];
      if (learnerId === undefined) refuse(`${where}.learners names no learner in this request.`);
      await query('INSERT INTO session_hands (session_id, learner_id, raised_at) VALUES ($1, $2, $3)', [
        sessionId,
        learnerId,
        position + 1
      ]);
    }
  }

  for (const [index, entry] of pollEntries.entries()) {
    const where = `polls[${index}]`;
    const key = text(entry, 'key', where);
    const sessionId = built.sessions[text(entry, 'session', where)];
    if (sessionId === undefined) refuse(`${where}.session names no session in this request.`);
    const options = Array.isArray(entry.options) ? entry.options.map((option) => String(option)) : [];
    if (options.length < 2) refuse(`${where}.options needs at least two options.`);
    const pollId = newId('pol');
    const state = entry.state === 'closed' ? 'closed' : 'open';
    await query(
      'INSERT INTO polls (id, session_id, question, options, state, opened_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [pollId, sessionId, text(entry, 'question', where), JSON.stringify(options), state, now]
    );
    const answers = (entry.answers ?? {}) as Record<string, unknown>;
    const counts = options.map(() => 0);
    for (const [learnerKey, option] of Object.entries(answers)) {
      const learnerId = built.learners[learnerKey];
      if (learnerId === undefined) refuse(`${where}.answers names no learner in this request.`);
      const optionNumber = Number(option);
      if (!Number.isInteger(optionNumber) || optionNumber < 1 || optionNumber > options.length) {
        refuse(`${where}.answers has no option ${String(option)}.`);
      }
      await query('INSERT INTO poll_answers (poll_id, learner_id, option) VALUES ($1, $2, $3)', [
        pollId,
        learnerId,
        optionNumber
      ]);
      counts[optionNumber - 1] = (counts[optionNumber - 1] ?? 0) + 1;
    }
    if (state === 'closed') {
      const final = tally(options, counts);
      await query('UPDATE polls SET closed_at = $2, total = $3, results = $4 WHERE id = $1', [
        pollId,
        now,
        final.total,
        JSON.stringify(final.results)
      ]);
    }
    built.polls[key] = pollId;
  }

  for (const [index, entry] of breakoutEntries.entries()) {
    const where = `breakouts[${index}]`;
    const sessionId = built.sessions[text(entry, 'session', where)];
    if (sessionId === undefined) refuse(`${where}.session names no session in this request.`);
    const tables = count(entry, 'tables', where);
    const session = await sessionById(sessionId);
    if (session === null) refuse(`${where}.session names no session in this request.`);
    const cls = await queryOne<{ layout: LayoutJson }>('SELECT layout FROM classes WHERE id = $1', [session.class_id]);
    const plan = planRoom(cls?.layout);
    const seated = await query<{ seat_id: string; learner_id: string }>(
      'SELECT seat_id, learner_id FROM session_seats WHERE session_id = $1',
      [sessionId]
    );
    const dealt = dealTables(
      seated.map((row) => ({ seatId: row.seat_id, learnerId: row.learner_id })),
      tables,
      plan.tables.length
    );
    const roundId = newId('brk');
    const deadline = new Date(now.getTime() + config.breakoutSeconds * 1_000);
    await query(
      `INSERT INTO breakout_rounds (id, session_id, tables, started_at, deadline, length_seconds, warning_seconds)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [roundId, sessionId, dealt.length, now, deadline, config.breakoutSeconds, config.breakoutWarningSeconds]
    );
    for (const table of dealt) {
      for (const learnerId of table.learnerIds) {
        await query('INSERT INTO breakout_members (round_id, learner_id, table_id) VALUES ($1, $2, $3)', [
          roundId,
          learnerId,
          table.tableId
        ]);
      }
    }
    await query("UPDATE sessions SET state = 'breakouts', breakout_rounds = breakout_rounds + 1 WHERE id = $1", [
      sessionId
    ]);
  }

  for (const ended of endedSessions) {
    const session = await sessionById(ended.id);
    if (session !== null) await endSession(session, ended.endsAt);
  }

  for (const [key, id] of Object.entries(built.teachers)) {
    const token = newToken();
    await query('INSERT INTO sign_in_tokens (token, teacher_id) VALUES ($1, $2)', [token, id]);
    built.signInTokens[key] = token;
  }
  for (const [key, id] of Object.entries(built.learners)) {
    const token = newToken();
    await query('INSERT INTO sign_in_tokens (token, learner_id) VALUES ($1, $2)', [token, id]);
    built.signInTokens[key] = token;
  }
  return built;
}

export function gradingRoutes(router: Router): void {
  router.add('POST', '/api/grading/setup', async ({ req, res }) => {
    const body = await readJsonBody(req);
    sendJson(res, 201, await buildWorld(body));
  });

  router.add('POST', '/api/grading/sign-in', async ({ req, res }) => {
    const body = await readJsonBody(req);
    const token = asString(body.token);
    const row = await queryOne<{ teacher_id: string | null; learner_id: string | null; used: boolean }>(
      'SELECT teacher_id, learner_id, used FROM sign_in_tokens WHERE token = $1',
      [token]
    );
    if (row === null || row.used) throw errors.notFound();
    await query('UPDATE sign_in_tokens SET used = true WHERE token = $1', [token]);
    if (row.teacher_id !== null) {
      res.setHeader('set-cookie', sessionCookie(await startTeacherSession(row.teacher_id)));
      sendJson(res, 200, { role: 'teacher', id: row.teacher_id });
      return;
    }
    const learnerId = row.learner_id as string;
    res.setHeader('set-cookie', sessionCookie(await startLearnerSession(learnerId)));
    sendJson(res, 200, { role: 'learner', id: learnerId });
  });

  router.add('POST', '/api/grading/clock', async ({ req, res }) => {
    const body = await readJsonBody(req);
    const worldId = asString(body.worldId);
    if (!(await worldExists(worldId))) throw errors.notFound();
    const next = body.now === null || body.now === undefined ? null : instant(body.now, 'now');
    await setWorldClock(worldId, next);
    await runDue(worldId);
    await pushWorldClock(worldId);
    sendJson(res, 200, { worldId, now: toUtcIso(await worldNow(worldId)) });
  });

  router.add('POST', '/api/grading/outage', async ({ req, res }) => {
    const body = await readJsonBody(req);
    const service = asString(body.service);
    if (service !== 'valkey' && service !== 'minio') throw new ApiError(422, 'Choose valkey or minio.');
    const down = body.down === true;
    if (service === 'valkey') bus.setForcedDown(down);
    else store.setForcedDown(down);
    sendJson(res, 200, { service, down });
  });
}

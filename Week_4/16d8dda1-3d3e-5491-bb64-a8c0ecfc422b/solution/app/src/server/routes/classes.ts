import { randomInt } from 'node:crypto';
import type { ClassDetail, ClassListItem, ClassSessionItem, CoTeacherBody } from '../../shared/wire';
import { authenticate, classRoleOf, openClass, requireOwner } from '../access';
import { isUniqueViolation, one, pool, rows, run, tx } from '../db';
import { checkLayout, describeLayout, STARTING_LAYOUT } from '../domain/layout';
import { isTimeZone } from '../domain/time';
import { RUNNING_STATES } from '../../shared/states';
import { notFound, Refusal } from '../errors';
import { characters, param, reply, textOf, type Route } from '../http';
import { newId } from '../ids';
import { lessonStateOf, type ClassRow } from '../records';
import { emailKey } from './accounts';

/** The letters A to Z without I, L and O, and the digits 2 to 9. */
const CODE_ALPHABET = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].filter((letter) => !'ILO'.includes(letter)).join('') + '23456789';

export function newClassCode(): string {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

async function detailOf(cls: ClassRow, role: ClassDetail['role']): Promise<ClassDetail> {
  const [coTeachers, lessons, sessions] = await Promise.all([
    rows<{ id: string; display_name: string; email: string }>(
      pool,
      `SELECT t.id, t.display_name, t.email FROM co_teachers c JOIN teachers t ON t.id = c.teacher_id
        WHERE c.class_id = $1 ORDER BY t.display_name`,
      [cls.id],
    ),
    rows<{ id: string; title: string; ready: boolean; statuses: string[] }>(
      pool,
      `SELECT l.id, l.title, l.ready, COALESCE(array_agg(f.status) FILTER (WHERE f.status IS NOT NULL), '{}') AS statuses
         FROM lessons l LEFT JOIN lesson_files f ON f.lesson_id = l.id WHERE l.class_id = $1 GROUP BY l.id ORDER BY l.created_seq`,
      [cls.id],
    ),
    rows<{ id: string; lesson_id: string; state: ClassSessionItem['state']; starts_local: string; ends_local: string }>(
      pool,
      'SELECT id, lesson_id, state, starts_local, ends_local FROM sessions WHERE class_id = $1 ORDER BY starts_ms DESC, created_seq DESC',
      [cls.id],
    ),
  ]);
  return {
    id: cls.id,
    title: cls.title,
    timeZone: cls.time_zone,
    code: cls.code,
    role,
    ...describeLayout(cls.layout),
    coTeachers: coTeachers.map((teacher) => ({ id: teacher.id, displayName: teacher.display_name, email: teacher.email })),
    lessons: lessons.map((lesson) => ({
      id: lesson.id,
      title: lesson.title,
      state: lessonStateOf(
        lesson.ready,
        lesson.statuses.map((status) => ({ status })),
      ),
    })),
    sessions: sessions.map((session) => ({
      id: session.id,
      lessonId: session.lesson_id,
      state: session.state,
      startsAt: session.starts_local,
      endsAt: session.ends_local,
    })),
  };
}

export const classRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/classes',
    handler: async (ctx) => {
      const caller = await authenticate(ctx.req);
      if (caller.kind !== 'teacher') return reply(200, { classes: [] });
      const found = await rows<{ id: string; title: string; time_zone: string; code: string; owner_id: string }>(
        pool,
        `SELECT c.id, c.title, c.time_zone, c.code, c.owner_id FROM classes c
          WHERE c.owner_id = $1 OR EXISTS (SELECT 1 FROM co_teachers h WHERE h.class_id = c.id AND h.teacher_id = $1)
          ORDER BY c.created_seq`,
        [caller.id],
      );
      const classes: ClassListItem[] = found.map((row) => ({
        id: row.id,
        title: row.title,
        timeZone: row.time_zone,
        code: row.code,
        role: row.owner_id === caller.id ? 'owner' : 'co-teacher',
      }));
      return reply(200, { classes });
    },
  },
  {
    method: 'POST',
    path: '/api/classes',
    handler: async (ctx) => {
      const caller = await authenticate(ctx.req);
      if (caller.kind !== 'teacher') throw notFound();
      const body = await ctx.json();
      const title = textOf(body.title)?.trim() ?? '';
      if (characters(title) < 1 || characters(title) > 80) throw new Refusal(422, 'Give the class a title of 1 to 80 characters.');
      if (!isTimeZone(body.timeZone)) throw new Refusal(422, 'Choose a time zone from the list.');
      for (;;) {
        const id = newId('cls');
        const code = newClassCode();
        try {
          await run(pool, 'INSERT INTO classes (id, world_id, owner_id, title, time_zone, code, layout) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
            id,
            caller.worldId,
            caller.id,
            title,
            body.timeZone,
            code,
            JSON.stringify(STARTING_LAYOUT),
          ]);
          return reply(201, { id, title, timeZone: body.timeZone, code, layout: STARTING_LAYOUT });
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
        }
      }
    },
  },
  {
    method: 'GET',
    path: '/api/classes/:id',
    handler: async (ctx) => {
      const { cls, role } = await openClass(await authenticate(ctx.req), param(ctx.params, 'id'));
      return reply(200, await detailOf(cls, role));
    },
  },
  {
    method: 'PUT',
    path: '/api/classes/:id/layout',
    handler: async (ctx) => {
      const { cls, role } = await openClass(await authenticate(ctx.req), param(ctx.params, 'id'));
      requireOwner(role);
      // The class row is held while the check and the write run, and opening a session waits on it, so a
      // session cannot open between the two.
      const layout = await tx(async (client) => {
        await run(client, 'SELECT 1 FROM classes WHERE id = $1 FOR UPDATE', [cls.id]);
        const running = await one(client, 'SELECT 1 AS found FROM sessions WHERE class_id = $1 AND state = ANY($2)', [cls.id, RUNNING_STATES]);
        if (running) throw new Refusal(409, "The room can't change during a live session.");
        const checked = checkLayout(await ctx.json());
        await run(client, 'UPDATE classes SET layout = $2 WHERE id = $1', [cls.id, JSON.stringify(checked)]);
        return checked;
      });
      return reply(200, describeLayout(layout));
    },
  },
  {
    method: 'POST',
    path: '/api/classes/:id/co-teachers',
    handler: async (ctx) => {
      const { cls, role } = await openClass(await authenticate(ctx.req), param(ctx.params, 'id'));
      requireOwner(role);
      const body = await ctx.json();
      const email = emailKey(textOf(body.email) ?? '');
      const found = await one<{ id: string; display_name: string; email: string }>(
        pool,
        'SELECT id, display_name, email FROM teachers WHERE email_key = $1 AND world_id = $2',
        [email, cls.world_id],
      );
      if (!found) throw new Refusal(422, 'No teacher has that email.');
      if (found.id === cls.owner_id) throw new Refusal(422, 'You already own this class.');
      const existing = await classRoleOf(found.id, cls);
      const added: CoTeacherBody = { id: found.id, displayName: found.display_name, email: found.email };
      if (existing) return reply(200, added);
      // Only the request whose insert lands is the 201; a racing duplicate is "already added".
      const inserted = await run(pool, 'INSERT INTO co_teachers (class_id, teacher_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [cls.id, found.id]);
      return reply(inserted ? 201 : 200, added);
    },
  },
];

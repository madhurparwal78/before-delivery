import type { ClassDetail, ClassListItem, LayoutJson, LessonState, SessionState } from '../../shared/types.js';
import { ApiError, asString, errors, readJsonBody, sendJson } from '../http.js';
import { query, queryOne } from '../db.js';
import { newClassCode, newId } from '../ids.js';
import { isValidTimeZone } from '../timezone.js';
import { derivePlan, planRoom } from '../domain/layout.js';
import { openClass, requireClassOwner, requireViewer } from '../access.js';
import { teacherByEmail } from '../auth.js';
import type { Router } from '../router.js';

const startingLayout: LayoutJson = {
  columns: 8,
  rows: 6,
  pieces: [{ kind: 'board', column: 2, row: 0 }]
};

export async function uniqueClassCode(): Promise<string> {
  for (;;) {
    const code = newClassCode();
    const clash = await queryOne<{ id: string }>('SELECT id FROM classes WHERE code = $1', [code]);
    if (clash === null) return code;
  }
}

export function classRoutes(router: Router): void {
  router.add('GET', '/api/classes', async ({ res, viewer }) => {
    const signedIn = requireViewer(viewer);
    if (signedIn.kind !== 'teacher') throw errors.notFound();
    const rows = await query<{ id: string; title: string; time_zone: string; code: string; role: string }>(
      `SELECT c.id, c.title, c.time_zone, c.code,
              CASE WHEN c.owner_id = $1 THEN 'owner' ELSE 'co-teacher' END AS role
         FROM classes c
         LEFT JOIN class_co_teachers ct ON ct.class_id = c.id AND ct.teacher_id = $1
        WHERE c.world_id = $2 AND (c.owner_id = $1 OR ct.teacher_id = $1)
        ORDER BY c.created_at ASC`,
      [signedIn.id, signedIn.worldId]
    );
    const classes: ClassListItem[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      timeZone: row.time_zone,
      code: row.code,
      role: row.role === 'owner' ? 'owner' : 'co-teacher'
    }));
    sendJson(res, 200, { classes });
  });

  router.add('POST', '/api/classes', async ({ req, res, viewer }) => {
    const signedIn = requireViewer(viewer);
    if (signedIn.kind !== 'teacher') throw errors.notFound();
    const body = await readJsonBody(req);
    const title = asString(body.title).trim();
    const timeZone = asString(body.timeZone).trim();
    if (title.length < 1 || title.length > 80) throw new ApiError(422, 'Give the class a title of 1 to 80 characters.');
    if (!isValidTimeZone(timeZone)) throw new ApiError(422, 'Choose a time zone from the list.');
    const id = newId('cls');
    const code = await uniqueClassCode();
    await query(
      'INSERT INTO classes (id, world_id, owner_id, title, time_zone, code, layout) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, signedIn.worldId, signedIn.id, title, timeZone, code, JSON.stringify(startingLayout)]
    );
    sendJson(res, 201, { id, title, timeZone, code, layout: startingLayout });
  });

  router.add('GET', '/api/classes/:classId', async ({ res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { cls, role } = await openClass(signedIn, params.classId as string);
    const plan = derivePlan(cls.layout);
    const coTeachers = await query<{ id: string; display_name: string; email: string }>(
      `SELECT t.id, t.display_name, t.email FROM class_co_teachers ct
         JOIN teachers t ON t.id = ct.teacher_id
        WHERE ct.class_id = $1 ORDER BY ct.created_at ASC`,
      [cls.id]
    );
    const lessons = await query<{ id: string; title: string; state: LessonState }>(
      'SELECT id, title, state FROM lessons WHERE class_id = $1 ORDER BY created_at ASC',
      [cls.id]
    );
    const sessions = await query<{
      id: string;
      lesson_id: string;
      state: SessionState;
      starts_at_local: string;
      ends_at_local: string;
    }>(
      `SELECT id, lesson_id, state, starts_at_local, ends_at_local FROM sessions
        WHERE class_id = $1 ORDER BY starts_at ASC`,
      [cls.id]
    );
    const detail: ClassDetail = {
      id: cls.id,
      title: cls.title,
      timeZone: cls.time_zone,
      code: cls.code,
      role,
      layout: cls.layout,
      seats: plan.seats,
      tables: plan.tables,
      coTeachers: coTeachers.map((row) => ({ id: row.id, displayName: row.display_name, email: row.email })),
      lessons,
      sessions: sessions.map((row) => ({
        id: row.id,
        lessonId: row.lesson_id,
        state: row.state,
        startsAt: row.starts_at_local,
        endsAt: row.ends_at_local
      }))
    };
    sendJson(res, 200, detail);
  });

  router.add('PUT', '/api/classes/:classId/layout', async ({ req, res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { cls, role } = await openClass(signedIn, params.classId as string);
    requireClassOwner(role);
    const running = await queryOne<{ id: string }>(
      "SELECT id FROM sessions WHERE class_id = $1 AND state IN ('open', 'live', 'breakouts')",
      [cls.id]
    );
    if (running !== null) throw new ApiError(409, "The room can't change during a live session.");
    const body = await readJsonBody(req);
    const plan = planRoom(body);
    await query('UPDATE classes SET layout = $2 WHERE id = $1', [cls.id, JSON.stringify(plan.layout)]);
    sendJson(res, 200, { layout: plan.layout, seats: plan.seats, tables: plan.tables });
  });

  router.add('POST', '/api/classes/:classId/co-teachers', async ({ req, res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { cls, role } = await openClass(signedIn, params.classId as string);
    requireClassOwner(role);
    const body = await readJsonBody(req);
    const email = asString(body.email).trim();
    const teacher = await teacherByEmail(cls.world_id, email);
    if (teacher === null) throw new ApiError(422, 'No teacher has that email.');
    if (teacher.id === cls.owner_id) throw new ApiError(422, 'You already own this class.');
    const already = await queryOne<{ teacher_id: string }>(
      'SELECT teacher_id FROM class_co_teachers WHERE class_id = $1 AND teacher_id = $2',
      [cls.id, teacher.id]
    );
    const payload = { id: teacher.id, displayName: teacher.display_name, email: teacher.email };
    if (already !== null) {
      sendJson(res, 200, payload);
      return;
    }
    await query('INSERT INTO class_co_teachers (class_id, teacher_id) VALUES ($1, $2)', [cls.id, teacher.id]);
    sendJson(res, 201, payload);
  });
}

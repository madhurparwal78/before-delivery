import type { IncomingMessage } from 'node:http';
import type { ClassRole, LayoutJson, SessionState, ViewerRole } from '../shared/types.js';
import { errors, parseCookies } from './http.js';
import { queryOne } from './db.js';

export interface TeacherViewer {
  kind: 'teacher';
  id: string;
  worldId: string;
  email: string;
  displayName: string;
}

export interface LearnerViewer {
  kind: 'learner';
  id: string;
  worldId: string;
  displayName: string;
}

export type Viewer = TeacherViewer | LearnerViewer;

export interface ClassRecord {
  id: string;
  world_id: string;
  owner_id: string;
  title: string;
  time_zone: string;
  code: string;
  layout: LayoutJson;
}

export interface SessionRecord {
  id: string;
  world_id: string;
  class_id: string;
  lesson_id: string;
  state: SessionState;
  starts_at_local: string;
  ends_at_local: string;
  starts_at: Date;
  ends_at: Date;
  current_slide: number;
  locked: boolean;
  spotlight: string | null;
  hands_taken: number;
  breakout_rounds: number;
  ended_at: Date | null;
}

export async function viewerFromCookie(cookie: string | undefined): Promise<Viewer | null> {
  const token = parseCookies(cookie).get('slatehall_session');
  if (token === undefined) return null;
  const row = await queryOne<{
    teacher_id: string | null;
    learner_id: string | null;
    email: string | null;
    display_name: string | null;
    world_id: string | null;
  }>(
    `SELECT s.teacher_id, s.learner_id,
            COALESCE(t.email, '') AS email,
            COALESCE(t.display_name, l.display_name) AS display_name,
            COALESCE(t.world_id, l.world_id) AS world_id
       FROM auth_sessions s
       LEFT JOIN teachers t ON t.id = s.teacher_id
       LEFT JOIN learners l ON l.id = s.learner_id
      WHERE s.id = $1`,
    [token]
  );
  if (row === null || row.world_id === null || row.display_name === null) return null;
  if (row.teacher_id !== null) {
    return {
      kind: 'teacher',
      id: row.teacher_id,
      worldId: row.world_id,
      email: row.email ?? '',
      displayName: row.display_name
    };
  }
  if (row.learner_id !== null) {
    return { kind: 'learner', id: row.learner_id, worldId: row.world_id, displayName: row.display_name };
  }
  return null;
}

export async function viewerFromRequest(req: IncomingMessage): Promise<Viewer | null> {
  return viewerFromCookie(req.headers.cookie);
}

export function requireViewer(viewer: Viewer | null): Viewer {
  if (viewer === null) throw errors.signIn();
  return viewer;
}

/** DP-33, DP-34: only an owner or co-teacher can open a class; everyone else gets 404. */
export async function openClass(viewer: Viewer, classId: string): Promise<{ cls: ClassRecord; role: ClassRole }> {
  if (viewer.kind !== 'teacher') throw errors.notFound();
  const cls = await queryOne<ClassRecord>('SELECT * FROM classes WHERE id = $1 AND world_id = $2', [
    classId,
    viewer.worldId
  ]);
  if (cls === null) throw errors.notFound();
  if (cls.owner_id === viewer.id) return { cls, role: 'owner' };
  const co = await queryOne<{ teacher_id: string }>(
    'SELECT teacher_id FROM class_co_teachers WHERE class_id = $1 AND teacher_id = $2',
    [classId, viewer.id]
  );
  if (co === null) throw errors.notFound();
  return { cls, role: 'co-teacher' };
}

export async function openLesson(
  viewer: Viewer,
  lessonId: string
): Promise<{ lesson: { id: string; class_id: string; title: string; state: string }; cls: ClassRecord; role: ClassRole }> {
  const lesson = await queryOne<{ id: string; class_id: string; title: string; state: string }>(
    'SELECT id, class_id, title, state FROM lessons WHERE id = $1',
    [lessonId]
  );
  if (lesson === null) throw errors.notFound();
  const { cls, role } = await openClass(viewer, lesson.class_id);
  return { lesson, cls, role };
}

/**
 * DP-33: a learner can open a session they joined, or one the grading setup
 * listed them for with at least one presence interval.
 */
export async function openSession(
  viewer: Viewer,
  sessionId: string
): Promise<{ session: SessionRecord; cls: ClassRecord; role: ViewerRole }> {
  const session = await queryOne<SessionRecord>('SELECT * FROM sessions WHERE id = $1 AND world_id = $2', [
    sessionId,
    viewer.worldId
  ]);
  if (session === null) throw errors.notFound();
  if (viewer.kind === 'teacher') {
    const { cls, role } = await openClass(viewer, session.class_id);
    return { session, cls, role: role === 'owner' ? 'teacher' : 'co-teacher' };
  }
  const roster = await queryOne<{ learner_id: string }>(
    `SELECT sl.learner_id
       FROM session_learners sl
      WHERE sl.session_id = $1 AND sl.learner_id = $2
        AND (sl.via_join
             OR EXISTS (SELECT 1 FROM presence p WHERE p.session_id = sl.session_id AND p.learner_id = sl.learner_id))`,
    [sessionId, viewer.id]
  );
  if (roster === null) throw errors.notFound();
  const cls = await queryOne<ClassRecord>('SELECT * FROM classes WHERE id = $1', [session.class_id]);
  if (cls === null) throw errors.notFound();
  return { session, cls, role: 'learner' };
}

export function requireOwner(role: ViewerRole): void {
  if (role !== 'teacher') throw errors.onlyTeacher();
}

export function requireClassOwner(role: ClassRole): void {
  if (role !== 'owner') throw errors.onlyTeacher();
}

export function requireTeaching(role: ViewerRole): void {
  if (role === 'learner') throw errors.onlyTeacher();
}

export function requireLearner(role: ViewerRole): void {
  if (role !== 'learner') throw errors.onlyTeacher();
}

export async function sessionById(sessionId: string): Promise<SessionRecord | null> {
  return queryOne<SessionRecord>('SELECT * FROM sessions WHERE id = $1', [sessionId]);
}

export async function classById(classId: string): Promise<ClassRecord | null> {
  return queryOne<ClassRecord>('SELECT * FROM classes WHERE id = $1', [classId]);
}

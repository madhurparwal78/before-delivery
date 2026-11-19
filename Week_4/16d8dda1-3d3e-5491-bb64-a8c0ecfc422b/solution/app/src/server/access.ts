// Who a caller is and what they can open: the one place of 401, 404 and role refusals.
import type { IncomingMessage } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { ClassRole, Role } from '../shared/wire';
import { one, run, type Db, pool } from './db';
import { notFound, Refusal, SIGN_IN_FIRST, TEACHER_ONLY } from './errors';
import { cookieOf, SESSION_COOKIE } from './http';
import { loadClass, loadSession, type ClassRow, type SessionRow } from './records';

export type Caller =
  | { kind: 'teacher'; id: string; worldId: string; email: string; displayName: string }
  | { kind: 'learner'; id: string; worldId: string; displayName: string };

interface CallerRow {
  kind: 'teacher' | 'learner';
  id: string;
  world_id: string;
  email: string | null;
  display_name: string;
}

export async function createAuthSession(kind: 'teacher' | 'learner', personId: string, db: Db = pool): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await run(db, 'INSERT INTO auth_sessions (token, kind, person_id, created_ms) VALUES ($1, $2, $3, $4)', [token, kind, personId, Date.now()]);
  return token;
}

export async function callerFor(req: IncomingMessage): Promise<Caller | null> {
  const token = cookieOf(req.headers, SESSION_COOKIE);
  if (!token) return null;
  const found = await one<CallerRow>(
    pool,
    `SELECT a.kind, COALESCE(t.id, l.id) AS id, COALESCE(t.world_id, l.world_id) AS world_id, t.email,
            COALESCE(t.display_name, l.display_name) AS display_name
       FROM auth_sessions a
       LEFT JOIN teachers t ON a.kind = 'teacher' AND t.id = a.person_id
       LEFT JOIN learners l ON a.kind = 'learner' AND l.id = a.person_id
      WHERE a.token = $1`,
    [token],
  );
  if (!found?.id) return null;
  return found.kind === 'teacher' && found.email !== null
    ? { kind: 'teacher', id: found.id, worldId: found.world_id, email: found.email, displayName: found.display_name }
    : { kind: 'learner', id: found.id, worldId: found.world_id, displayName: found.display_name };
}

export async function authenticate(req: IncomingMessage): Promise<Caller> {
  const caller = await callerFor(req);
  if (!caller) throw new Refusal(401, SIGN_IN_FIRST);
  return caller;
}

export async function classRoleOf(teacherId: string, cls: Pick<ClassRow, 'id' | 'owner_id'>, db: Db = pool): Promise<ClassRole | null> {
  if (cls.owner_id === teacherId) return 'owner';
  const helper = await one(db, 'SELECT 1 AS found FROM co_teachers WHERE class_id = $1 AND teacher_id = $2', [cls.id, teacherId]);
  return helper ? 'co-teacher' : null;
}

/** A class a teacher owns or co-teaches; anyone else gets 404. */
export async function openClass(caller: Caller, classId: string): Promise<{ cls: ClassRow; role: ClassRole }> {
  if (caller.kind !== 'teacher') throw notFound();
  const cls = await loadClass(classId);
  const role = await classRoleOf(caller.id, cls);
  if (!role) throw notFound();
  return { cls, role };
}

/**
 * The one rule of what a learner can open (the session, its review and its files, DP-33 and DP-36): they are
 * enrolled in the class and listed for the session, with at least one presence interval. A session that is
 * still running also opens for a learner who has just joined and whose first interval is not written yet.
 */
export async function learnerCanOpen(sessionId: string, learnerId: string, db: Db = pool): Promise<boolean> {
  const found = await one(
    db,
    `SELECT 1 AS found FROM session_learners sl
       JOIN sessions s ON s.id = sl.session_id
       JOIN enrolments e ON e.class_id = s.class_id AND e.learner_id = sl.learner_id
      WHERE sl.session_id = $1 AND sl.learner_id = $2
        AND (EXISTS (SELECT 1 FROM presence_intervals p WHERE p.session_id = sl.session_id AND p.learner_id = sl.learner_id)
             OR (sl.joined AND s.state <> 'ended'))`,
    [sessionId, learnerId],
  );
  return found !== null;
}

export interface OpenedSession {
  caller: Caller;
  session: SessionRow;
  role: Role;
}

export async function openSession(caller: Caller, sessionId: string): Promise<OpenedSession> {
  const session = await loadSession(sessionId);
  if (caller.kind === 'learner') {
    if (!(await learnerCanOpen(session.id, caller.id))) throw notFound();
    return { caller, session, role: 'learner' };
  }
  const role = await classRoleOf(caller.id, { id: session.class_id, owner_id: session.owner_id });
  if (!role) throw notFound();
  return { caller, session, role: role === 'owner' ? 'teacher' : 'co-teacher' };
}

/** The owner and co-teachers; learners get the role refusal. */
export function requireTeaching(role: Role): void {
  if (role === 'learner') throw new Refusal(403, TEACHER_ONLY);
}

export function requireOwner(role: Role | ClassRole): void {
  if (role !== 'teacher' && role !== 'owner') throw new Refusal(403, TEACHER_ONLY);
}

/** The learner's id; teachers get the role refusal. */
export function requireLearner(opened: OpenedSession): string {
  if (opened.caller.kind !== 'learner') throw new Refusal(403, TEACHER_ONLY);
  return opened.caller.id;
}

export function learnerIdOf(caller: Caller): string | null {
  return caller.kind === 'learner' ? caller.id : null;
}

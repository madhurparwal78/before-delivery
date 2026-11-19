import type pg from 'pg';
import type { Classroom, ClassroomStateName, StudentSummary, EducatorSummary } from '../shared/types.js';
import { deriveClassroomState, secondsUntil } from '../shared/classroomState.js';
import { formatLocalField } from '../shared/util.js';
import { now } from './clock.js';

export interface ClassroomRow {
  id: string;
  name: string;
  timeZone: string;
  joinCode: string;
  joinOpensAt: Date;
  joinClosesAt: Date;
  handInAt: Date;
  archived: boolean;
  ownerId: string;
}

export async function classroomById(pool: pg.Pool, id: string): Promise<ClassroomRow | null> {
  const { rows } = await pool.query('SELECT id, name, time_zone, join_code, join_opens_at, join_closes_at, hand_in_at, archived, owner_id FROM classrooms WHERE id = $1', [id]);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id, name: row.name, timeZone: row.time_zone, joinCode: row.join_code,
    joinOpensAt: row.join_opens_at as Date, joinClosesAt: row.join_closes_at as Date,
    handInAt: row.hand_in_at as Date, archived: row.archived, ownerId: row.owner_id,
  };
}

export function classroomStateOf(row: ClassroomRow, at: Date): ClassroomStateName {
  return deriveClassroomState(at, row.joinOpensAt, row.joinClosesAt, row.handInAt, row.archived);
}

export async function educatorRole(pool: pg.Pool, classroomId: string, educatorId: string): Promise<'owner' | 'assistant' | null> {
  const { rows } = await pool.query('SELECT role FROM classroom_educators WHERE classroom_id = $1 AND educator_id = $2', [classroomId, educatorId]);
  return (rows[0]?.role as 'owner' | 'assistant') ?? null;
}

export async function listStudents(pool: pg.Pool, classroomId: string): Promise<StudentSummary[]> {
  const { rows } = await pool.query(`
    SELECT s.id, s.nickname, p.id AS pid, p.kind, p.name, p.revision, p.saved_at, p.handed_in
    FROM students s
    LEFT JOIN LATERAL (
      SELECT * FROM projects p WHERE p.owner_id = s.id ORDER BY p.saved_at DESC, p.id DESC LIMIT 1
    ) p ON TRUE
    WHERE s.classroom_id = $1
    ORDER BY s.created_at ASC, s.id ASC
  `, [classroomId]);
  return rows.map((r) => ({
    id: r.id as string,
    nickname: r.nickname as string,
    handedIn: Boolean(r.pid) && Boolean(r.handed_in),
    latestProject: r.pid ? {
      id: r.pid as string, kind: r.kind as '3d' | 'circuit' | 'blocks',
      name: r.name as string, revision: r.revision as number,
      savedAt: (r.saved_at as Date).toISOString(), state: r.handed_in ? 'handed_in' : 'editing',
    } : null,
  }));
}

export async function listEducators(pool: pg.Pool, classroomId: string): Promise<EducatorSummary[]> {
  const { rows } = await pool.query(`
    SELECT a.id, a.display_name, a.email, ce.role
    FROM classroom_educators ce JOIN accounts a ON a.id = ce.educator_id
    WHERE ce.classroom_id = $1 ORDER BY ce.role DESC, a.display_name ASC
  `, [classroomId]);
  return rows.map((r) => ({ id: r.id, displayName: r.display_name, email: r.email, role: r.role as 'owner' | 'assistant' }));
}

export function serializeClassroom(row: ClassroomRow, role: 'owner' | 'assistant', students: StudentSummary[], educators: EducatorSummary[], state: ClassroomStateName): Classroom {
  const t = now();
  const studentsWithHandIn = students.map((s) => ({
    ...s,
    handedIn: state === 'handed_in' || state === 'archived' || s.latestProject?.state === 'handed_in',
  }));
  return {
    id: row.id, name: row.name, timeZone: row.timeZone, state,
    joinCode: row.joinCode,
    joinOpensLocal: formatLocalField(row.joinOpensAt, row.timeZone),
    joinClosesLocal: formatLocalField(row.joinClosesAt, row.timeZone),
    handInLocal: formatLocalField(row.handInAt, row.timeZone),
    joinOpensAt: row.joinOpensAt.toISOString(), joinClosesAt: row.joinClosesAt.toISOString(), handInAt: row.handInAt.toISOString(),
    serverNow: t.toISOString(),
    secondsToHandIn: state === 'handed_in' || state === 'archived' ? 0 : secondsUntil(t, row.handInAt),
    ownerId: row.ownerId,
    role,
    students: studentsWithHandIn,
    educators,
  };
}

export async function fullClassroom(pool: pg.Pool, row: ClassroomRow, role: 'owner' | 'assistant'): Promise<Classroom> {
  const [students, educators] = await Promise.all([listStudents(pool, row.id), listEducators(pool, row.id)]);
  return serializeClassroom(row, role, students, educators, classroomStateOf(row, now()));
}

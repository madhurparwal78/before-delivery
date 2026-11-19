import { isHandedIn } from "../shared/rules";
import type { Account, Classroom, ClassroomEducator, LatestProject, RosterStudent, StudentClassroomView } from "../shared/types";
import { classroomClock, classroomState, projectState, type ClassroomTimes } from "./classroom-state";
import { serverNow } from "./clock";
import { first, pool, rows, type Queryable } from "./db";
import { ApiError } from "./errors";

export interface ClassroomRow extends ClassroomTimes {
  id: string;
  ownerId: string;
  name: string;
  timeZone: string;
  joinCode: string;
  joinOpensLocal: string;
  joinClosesLocal: string;
  handInLocal: string;
}

export const CLASSROOM_COLUMNS = `c.id, c.owner_id AS "ownerId", c.name, c.time_zone AS "timeZone", c.join_code AS "joinCode",
  c.join_opens_local AS "joinOpensLocal", c.join_closes_local AS "joinClosesLocal", c.hand_in_local AS "handInLocal",
  c.join_opens_at AS "joinOpensAt", c.join_closes_at AS "joinClosesAt", c.hand_in_at AS "handInAt", c.archived_at AS "archivedAt"`;

export function findClassroom(id: string, db: Queryable = pool): Promise<ClassroomRow | null> {
  return first<ClassroomRow>(db, `SELECT ${CLASSROOM_COLUMNS} FROM classrooms c WHERE c.id = $1`, [id]);
}

/** The classroom row, locked until the transaction ends: whoever decides on its state (join, hand-in, archive, rename) takes it first. */
export function lockClassroom(client: Queryable, id: string): Promise<ClassroomRow | null> {
  return first<ClassroomRow>(client, `SELECT ${CLASSROOM_COLUMNS} FROM classrooms c WHERE c.id = $1 FOR UPDATE OF c`, [id]);
}

type EducatorRole = "owner" | "assistant";

/** What an account may do in a classroom: educators by role, anyone else by not knowing it exists (a Student of it is forbidden). */
export async function classroomAccess(account: Account, id: string): Promise<{ classroom: ClassroomRow; role: EducatorRole }> {
  const classroom = await findClassroom(id);
  if (!classroom) throw new ApiError("not_found");
  if (account.kind === "student") throw new ApiError(account.classroomId === id ? "forbidden" : "not_found");
  if (account.kind !== "educator") throw new ApiError("not_found");
  if (classroom.ownerId === account.id) return { classroom, role: "owner" };
  const added = await first(pool, "SELECT 1 FROM classroom_educators WHERE classroom_id = $1 AND educator_id = $2", [id, account.id]);
  if (!added) throw new ApiError("not_found");
  return { classroom, role: "assistant" };
}

/** SQL: true when the account bound to `accountParam` owns or was added to the classroom named by `classroomExpr`. */
export function isEducatorOf(classroomExpr: string, accountParam: string): string {
  return `EXISTS (SELECT 1 FROM classrooms ec WHERE ec.id = ${classroomExpr} AND (ec.owner_id = ${accountParam}
    OR EXISTS (SELECT 1 FROM classroom_educators ce WHERE ce.classroom_id = ec.id AND ce.educator_id = ${accountParam})))`;
}

interface Members {
  educators: string[];
  students: string[];
}

/**
 * The accounts that follow each classroom: its owner and Assistants, and its Students. Not only those with a stream
 * open now: a page that opens its stream a moment later replays what was sent to its account meanwhile.
 */
export async function classroomAudiences(classroomIds: readonly string[]): Promise<Map<string, Members>> {
  const audiences = new Map<string, Members>();
  if (classroomIds.length === 0) return audiences;
  const found = await rows<{ classroomId: string; accountId: string; role: "educator" | "student" }>(pool,
    `SELECT * FROM (
       SELECT id AS "classroomId", owner_id AS "accountId", 'educator' AS role FROM classrooms WHERE id = ANY($1)
       UNION ALL SELECT classroom_id, educator_id, 'educator' FROM classroom_educators WHERE classroom_id = ANY($1)
       UNION ALL SELECT classroom_id, id, 'student' FROM accounts WHERE kind = 'student' AND classroom_id = ANY($1)
     ) m`, [classroomIds]);
  for (const { classroomId, accountId, role } of found) {
    const entry = audiences.get(classroomId) ?? { educators: [], students: [] };
    (role === "educator" ? entry.educators : entry.students).push(accountId);
    audiences.set(classroomId, entry);
  }
  return audiences;
}

export async function educatorAudience(classroomId: string): Promise<string[]> {
  return (await classroomAudiences([classroomId])).get(classroomId)?.educators ?? [];
}

export function studentClassroomView(classroom: ClassroomRow): StudentClassroomView {
  const now = serverNow();
  return {
    id: classroom.id, name: classroom.name, timeZone: classroom.timeZone, handInAt: classroom.handInAt.toISOString(),
    ...classroomClock(classroom, now),
  };
}

interface LatestRow {
  id: string;
  ownerId: string;
  kind: LatestProject["kind"];
  name: string;
  revision: number;
  savedAt: Date;
  handedInAt: Date | null;
}

function latestProject(project: LatestRow, classroom: ClassroomRow, now: Date): LatestProject {
  return {
    id: project.id, kind: project.kind, name: project.name, revision: project.revision, savedAt: project.savedAt.toISOString(),
    state: projectState(project.handedInAt, classroomState(classroom, now)),
  };
}

/** The educator's view of classrooms, loaded in three queries however many are asked for. */
export async function classroomViews(classrooms: ClassroomRow[], viewerId: string): Promise<Classroom[]> {
  if (classrooms.length === 0) return [];
  const ids = classrooms.map((c) => c.id);
  const now = serverNow();
  const [students, projects, educators] = await Promise.all([
    rows<{ id: string; classroomId: string; nickname: string }>(pool,
      `SELECT id, classroom_id AS "classroomId", nickname FROM accounts
       WHERE kind = 'student' AND classroom_id = ANY($1) ORDER BY created_at, id`, [ids]),
    rows<LatestRow>(pool,
      `SELECT DISTINCT ON (p.owner_id) p.id, p.owner_id AS "ownerId", p.kind, p.name, p.revision, p.saved_at AS "savedAt",
         p.handed_in_at AS "handedInAt" FROM projects p
       WHERE p.owner_id IN (SELECT id FROM accounts WHERE kind = 'student' AND classroom_id = ANY($1))
       ORDER BY p.owner_id, p.saved_at DESC, p.id`, [ids]),
    rows<ClassroomEducator & { classroomId: string }>(pool,
      `SELECT c.id AS "classroomId", a.id, a.display_name AS "displayName", a.email, 'owner' AS role
         FROM classrooms c JOIN accounts a ON a.id = c.owner_id WHERE c.id = ANY($1)
       UNION ALL
       SELECT ce.classroom_id, a.id, a.display_name, a.email, 'assistant'
         FROM classroom_educators ce JOIN accounts a ON a.id = ce.educator_id WHERE ce.classroom_id = ANY($1)
       ORDER BY 1, 5 DESC`, [ids]),
  ]);
  const latestByOwner = new Map(projects.map((p) => [p.ownerId, p]));

  return classrooms.map((classroom) => {
    const clock = classroomClock(classroom, now);
    const roster: RosterStudent[] = students.filter((s) => s.classroomId === classroom.id).map((s) => {
      const project = latestByOwner.get(s.id);
      const latest = project ? latestProject(project, classroom, now) : null;
      return { id: s.id, nickname: s.nickname, handedIn: isHandedIn(clock.state, latest), latestProject: latest };
    });
    return {
      id: classroom.id, name: classroom.name, timeZone: classroom.timeZone, joinCode: classroom.joinCode,
      joinOpensLocal: classroom.joinOpensLocal, joinClosesLocal: classroom.joinClosesLocal, handInLocal: classroom.handInLocal,
      joinOpensAt: classroom.joinOpensAt.toISOString(), joinClosesAt: classroom.joinClosesAt.toISOString(),
      handInAt: classroom.handInAt.toISOString(), ...clock,
      ownerId: classroom.ownerId, role: classroom.ownerId === viewerId ? "owner" : "assistant", students: roster,
      educators: educators.filter((e) => e.classroomId === classroom.id)
        .map(({ id, displayName, email, role }) => ({ id, displayName, email, role })),
    };
  });
}

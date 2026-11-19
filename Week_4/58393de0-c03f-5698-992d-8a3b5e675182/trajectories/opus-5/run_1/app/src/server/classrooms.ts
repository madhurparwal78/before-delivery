import { randomUUID } from 'node:crypto';
import type {
  Classroom,
  ClassroomEducator,
  ClassroomState,
  EducatorRole,
  ProjectKind,
  RosterStudent,
  StudentClassroomView,
} from '../shared/types.js';
import { FIELD_COPY, dstGapCopy } from '../shared/copy.js';
import { query, queryOne } from './db.js';
import { serverNowMs } from './clock.js';
import { validation } from './errors.js';
import { addDaysKeepingLocalTime, isValidZone, localToUtc, utcToLocal } from './zones.js';

export const MAX_STUDENTS = 40;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export interface ClassroomRow {
  id: string;
  name: string;
  time_zone: string;
  join_code: string;
  join_opens_local: string;
  join_closes_local: string;
  hand_in_local: string;
  join_opens_at: Date;
  join_closes_at: Date;
  hand_in_at: Date;
  archived: boolean;
  owner_id: string;
}

export const CLASSROOM_COLUMNS =
  'id, name, time_zone, join_code, join_opens_local, join_closes_local, hand_in_local, join_opens_at, join_closes_at, hand_in_at, archived, owner_id';

/** The one place a classroom's state is decided. */
export const classroomState = (row: ClassroomRow, nowMs: number = serverNowMs()): ClassroomState => {
  if (row.archived) return 'archived';
  if (nowMs >= row.hand_in_at.getTime()) return 'handed_in';
  if (nowMs >= row.join_closes_at.getTime()) return 'in_session';
  if (nowMs >= row.join_opens_at.getTime()) return 'open';
  return 'draft';
};

export const secondsToHandIn = (row: ClassroomRow, nowMs: number = serverNowMs()): number =>
  Math.max(0, Math.floor((row.hand_in_at.getTime() - nowMs) / 1000));

export const loadClassroom = async (id: string): Promise<ClassroomRow | null> => {
  if (!isUuid(id)) return null;
  return queryOne<ClassroomRow>(`select ${CLASSROOM_COLUMNS} from classrooms where id = $1`, [id]);
};

export const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export const loadClassroomByCode = async (code: string): Promise<ClassroomRow | null> =>
  queryOne<ClassroomRow>(
    `select ${CLASSROOM_COLUMNS} from classrooms where upper(join_code) = upper($1) and archived = false`,
    [code],
  );

export const freshJoinCode = async (): Promise<string> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = '';
    for (let index = 0; index < 6; index += 1) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    const clash = await loadClassroomByCode(code);
    if (!clash) return code;
  }
  throw new Error('Could not find a free join code');
};

export const educatorRoleIn = async (classroomId: string, educatorId: string): Promise<EducatorRole | null> => {
  const row = await queryOne<{ role: EducatorRole }>(
    'select role from classroom_educators where classroom_id = $1 and educator_id = $2',
    [classroomId, educatorId],
  );
  return row ? row.role : null;
};

export const countStudents = async (classroomId: string): Promise<number> => {
  const row = await queryOne<{ count: string }>(
    "select count(*)::text as count from accounts where classroom_id = $1 and kind = 'student'",
    [classroomId],
  );
  return row ? Number(row.count) : 0;
};

interface StudentProjectRow {
  id: string;
  nickname: string;
  project_id: string | null;
  project_kind: ProjectKind | null;
  project_name: string | null;
  revision: number | null;
  saved_at: Date | null;
  project_handed_in: boolean | null;
}

export const rosterOf = async (row: ClassroomRow, state: ClassroomState): Promise<RosterStudent[]> => {
  const rows = await query<StudentProjectRow>(
    `select a.id, a.nickname,
            p.id as project_id, p.kind as project_kind, p.name as project_name,
            p.revision, p.saved_at, p.handed_in as project_handed_in
       from accounts a
       left join lateral (
         select id, kind, name, revision, saved_at, handed_in
           from projects
          where owner_id = a.id
          order by saved_at desc, revision desc
          limit 1
       ) p on true
      where a.classroom_id = $1 and a.kind = 'student'
      order by a.created_at asc`,
    [row.id],
  );
  const classroomClosed = state === 'handed_in' || state === 'archived';
  return rows.map((student) => {
    const latestProject =
      student.project_id === null
        ? null
        : {
            id: student.project_id,
            kind: student.project_kind as ProjectKind,
            name: student.project_name as string,
            revision: student.revision as number,
            savedAt: (student.saved_at as Date).toISOString(),
            state: (classroomClosed || student.project_handed_in ? 'handed_in' : 'editing') as 'editing' | 'handed_in',
          };
    return {
      id: student.id,
      nickname: student.nickname ?? '',
      handedIn: latestProject !== null && latestProject.state === 'handed_in',
      latestProject,
    };
  });
};

export const educatorsOf = async (classroomId: string): Promise<ClassroomEducator[]> => {
  const rows = await query<{ id: string; display_name: string; email: string; role: EducatorRole }>(
    `select a.id, a.display_name, a.email, ce.role
       from classroom_educators ce
       join accounts a on a.id = ce.educator_id
      where ce.classroom_id = $1
      order by case when ce.role = 'owner' then 0 else 1 end, ce.added_at asc`,
    [classroomId],
  );
  return rows.map((row) => ({ id: row.id, displayName: row.display_name, email: row.email, role: row.role }));
};

export const classroomView = async (row: ClassroomRow, role: EducatorRole): Promise<Classroom> => {
  const nowMs = serverNowMs();
  const state = classroomState(row, nowMs);
  const [students, educators] = await Promise.all([rosterOf(row, state), educatorsOf(row.id)]);
  return {
    id: row.id,
    name: row.name,
    timeZone: row.time_zone,
    state,
    joinCode: row.join_code,
    joinOpensLocal: row.join_opens_local,
    joinClosesLocal: row.join_closes_local,
    handInLocal: row.hand_in_local,
    joinOpensAt: row.join_opens_at.toISOString(),
    joinClosesAt: row.join_closes_at.toISOString(),
    handInAt: row.hand_in_at.toISOString(),
    serverNow: new Date(nowMs).toISOString(),
    secondsToHandIn: secondsToHandIn(row, nowMs),
    ownerId: row.owner_id,
    role,
    students,
    educators,
  };
};

export const studentClassroomView = (row: ClassroomRow): StudentClassroomView => {
  const nowMs = serverNowMs();
  return {
    id: row.id,
    name: row.name,
    timeZone: row.time_zone,
    state: classroomState(row, nowMs),
    handInAt: row.hand_in_at.toISOString(),
    serverNow: new Date(nowMs).toISOString(),
    secondsToHandIn: secondsToHandIn(row, nowMs),
  };
};

export const validateClassroomName = (raw: unknown): string => {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (name.length < 1 || name.length > 60) throw validation({ name: FIELD_COPY.name });
  return name;
};

export interface ResolvedTimes {
  joinOpensLocal: string;
  joinClosesLocal: string;
  handInLocal: string;
  joinOpensAt: Date;
  joinClosesAt: Date;
  handInAt: Date;
}

interface TimeInput {
  joinOpensLocal?: unknown;
  joinClosesLocal?: unknown;
  handInLocal?: unknown;
}

const given = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** Decides the three instants of a classroom, on create and on edit, in one place. */
export const resolveTimes = (
  zone: string,
  input: TimeInput,
  current: ResolvedTimes | null,
  nowMs: number,
): ResolvedTimes => {
  const fields: Record<string, string> = {};
  const parse = (local: string, field: string): number | null => {
    const parsed = localToUtc(zone, local);
    if (!parsed.ok || parsed.utcMs === undefined) {
      fields[field] = parsed.reason === 'gap' ? dstGapCopy(zone) : FIELD_COPY.localFormat;
      return null;
    }
    return parsed.utcMs;
  };

  const opensGiven = given(input.joinOpensLocal);
  const closesGiven = given(input.joinClosesLocal);
  const handInGiven = given(input.handInLocal);

  let opensAt: number | null;
  let opensLocal: string;
  if (opensGiven !== null) {
    opensLocal = opensGiven.replace(' ', 'T');
    opensAt = parse(opensGiven, 'joinOpensLocal');
  } else if (current) {
    opensLocal = current.joinOpensLocal;
    opensAt = current.joinOpensAt.getTime();
  } else {
    opensAt = Math.floor(nowMs / 60_000) * 60_000;
    opensLocal = utcToLocal(zone, opensAt);
  }

  let closesAt: number | null;
  let closesLocal: string;
  if (closesGiven !== null) {
    closesLocal = closesGiven.replace(' ', 'T');
    closesAt = parse(closesGiven, 'joinClosesLocal');
  } else if (current) {
    closesLocal = current.joinClosesLocal;
    closesAt = current.joinClosesAt.getTime();
  } else if (opensAt !== null) {
    closesAt = addDaysKeepingLocalTime(zone, opensAt, 14);
    closesLocal = utcToLocal(zone, closesAt);
  } else {
    closesAt = null;
    closesLocal = '';
  }

  let handInAt: number | null;
  let handInLocal: string;
  if (handInGiven !== null) {
    handInLocal = handInGiven.replace(' ', 'T');
    handInAt = parse(handInGiven, 'handInLocal');
  } else if (current) {
    handInLocal = current.handInLocal;
    handInAt = current.handInAt.getTime();
  } else if (opensAt !== null) {
    handInAt = addDaysKeepingLocalTime(zone, opensAt, 70);
    handInLocal = utcToLocal(zone, handInAt);
  } else {
    handInAt = null;
    handInLocal = '';
  }

  if (opensAt !== null && closesAt !== null && closesAt <= opensAt && !fields.joinClosesLocal) {
    fields.joinClosesLocal = FIELD_COPY.joinOrder;
  }
  if (handInAt !== null && !fields.handInLocal) {
    const mustBeLaterThanNow = handInGiven !== null || current === null;
    if (mustBeLaterThanNow && handInAt <= nowMs) {
      fields.handInLocal = FIELD_COPY.handInNotLater;
    } else if (closesAt !== null && handInAt < closesAt) {
      fields.handInLocal = FIELD_COPY.handInBeforeJoinCloses;
    }
  }

  if (Object.keys(fields).length > 0) throw validation(fields);

  return {
    joinOpensLocal: opensLocal,
    joinClosesLocal: closesLocal,
    handInLocal,
    joinOpensAt: new Date(opensAt as number),
    joinClosesAt: new Date(closesAt as number),
    handInAt: new Date(handInAt as number),
  };
};

export const validateZone = (raw: unknown): string => {
  const zone = typeof raw === 'string' ? raw.trim() : '';
  if (!zone.includes('/') || !isValidZone(zone)) throw validation({ timeZone: FIELD_COPY.timeZone });
  return zone;
};

export const insertClassroom = async (input: {
  name: string;
  zone: string;
  times: ResolvedTimes;
  ownerId: string;
  joinCode: string;
}): Promise<ClassroomRow> => {
  const id = randomUUID();
  const rows = await query<ClassroomRow>(
    `insert into classrooms (id, name, time_zone, join_code, join_opens_local, join_closes_local, hand_in_local,
                             join_opens_at, join_closes_at, hand_in_at, owner_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     returning ${CLASSROOM_COLUMNS}`,
    [
      id,
      input.name,
      input.zone,
      input.joinCode,
      input.times.joinOpensLocal,
      input.times.joinClosesLocal,
      input.times.handInLocal,
      input.times.joinOpensAt,
      input.times.joinClosesAt,
      input.times.handInAt,
      input.ownerId,
    ],
  );
  await query('insert into classroom_educators (classroom_id, educator_id, role) values ($1, $2, $3)', [
    id,
    input.ownerId,
    'owner',
  ]);
  return rows[0];
};

export const timesOf = (row: ClassroomRow): ResolvedTimes => ({
  joinOpensLocal: row.join_opens_local,
  joinClosesLocal: row.join_closes_local,
  handInLocal: row.hand_in_local,
  joinOpensAt: row.join_opens_at,
  joinClosesAt: row.join_closes_at,
  handInAt: row.hand_in_at,
});

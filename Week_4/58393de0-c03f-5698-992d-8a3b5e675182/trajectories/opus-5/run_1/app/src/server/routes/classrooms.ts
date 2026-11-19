import type { EducatorRole } from '../../shared/types.js';
import { ApiError, conflict, emailUnverified, forbidden, notFound } from '../errors.js';
import { UI_COPY } from '../../shared/copy.js';
import { serverNowMs } from '../clock.js';
import { query, queryOne } from '../db.js';
import {
  CLASSROOM_COLUMNS,
  classroomState,
  classroomView,
  educatorRoleIn,
  freshJoinCode,
  insertClassroom,
  loadClassroom,
  resolveTimes,
  timesOf,
  validateClassroomName,
  validateZone,
  type ClassroomRow,
} from '../classrooms.js';
import { normaliseNickname } from '../nicknames.js';
import { endSessionsOfAccount, requireAccount, type Caller } from '../sessions.js';
import { sendEmpty, sendJson, type RequestContext } from '../http.js';
import { utcToLocal } from '../zones.js';
import { emitAccessEnded, emitClassroomState, emitStudentRemoved, emitStudentRenamed } from '../stream.js';
import { EXPORT_COLUMNS, exportView, type ExportRow } from '../exports.js';
import { forgetStoredObjects } from '../cleanup.js';
import type { AccountRow } from '../accounts.js';

interface Reach {
  account: AccountRow;
  classroom: ClassroomRow;
  role: EducatorRole;
}

const reachClassroom = async (caller: Caller, id: string): Promise<Reach> => {
  const account = requireAccount(caller);
  const classroom = await loadClassroom(id);
  if (!classroom) throw notFound();
  if (account.kind === 'student') {
    if (account.classroom_id === classroom.id) throw forbidden();
    throw notFound();
  }
  if (account.kind !== 'educator') throw notFound();
  const role = await educatorRoleIn(classroom.id, account.id);
  if (!role) throw notFound();
  return { account, classroom, role };
};

const requireOwner = (reach: Reach): Reach => {
  if (reach.role !== 'owner') throw forbidden();
  return reach;
};

export const listClassrooms = async (ctx: RequestContext, caller: Caller): Promise<void> => {
  const account = requireAccount(caller);
  if (account.kind !== 'educator') {
    sendJson(ctx, 200, { classrooms: [] });
    return;
  }
  const rows = await query<ClassroomRow & { role: EducatorRole }>(
    `select ${CLASSROOM_COLUMNS.split(', ').map((column) => `c.${column}`).join(', ')}, ce.role
       from classrooms c
       join classroom_educators ce on ce.classroom_id = c.id
      where ce.educator_id = $1
      order by c.created_at desc`,
    [account.id],
  );
  const classrooms = await Promise.all(rows.map((row) => classroomView(row, row.role)));
  sendJson(ctx, 200, { classrooms });
};

export const createClassroom = async (
  ctx: RequestContext,
  caller: Caller,
  body: Record<string, unknown>,
): Promise<void> => {
  const account = requireAccount(caller);
  if (account.kind !== 'educator') throw forbidden();
  if (!account.email_verified) throw emailUnverified(UI_COPY.verifyToCreate);
  const name = validateClassroomName(body.name);
  const zone = validateZone(body.timeZone);
  const times = resolveTimes(zone, body, null, serverNowMs());
  const classroom = await insertClassroom({
    name,
    zone,
    times,
    ownerId: account.id,
    joinCode: await freshJoinCode(),
  });
  sendJson(ctx, 201, await classroomView(classroom, 'owner'));
};

export const getClassroom = async (ctx: RequestContext, caller: Caller, params: Record<string, string>): Promise<void> => {
  const reach = await reachClassroom(caller, params.id);
  sendJson(ctx, 200, await classroomView(reach.classroom, reach.role));
};

export const patchClassroom = async (
  ctx: RequestContext,
  caller: Caller,
  params: Record<string, string>,
  body: Record<string, unknown>,
): Promise<void> => {
  const reach = requireOwner(await reachClassroom(caller, params.id));
  const state = classroomState(reach.classroom);
  if (state === 'archived') throw conflict('classroom_archived');
  if (state === 'handed_in') throw conflict('classroom_handed_in');
  const times = resolveTimes(reach.classroom.time_zone, body, timesOf(reach.classroom), serverNowMs());
  const rows = await query<ClassroomRow>(
    `update classrooms set join_opens_local = $2, join_closes_local = $3, hand_in_local = $4,
            join_opens_at = $5, join_closes_at = $6, hand_in_at = $7
      where id = $1 returning ${CLASSROOM_COLUMNS}`,
    [
      reach.classroom.id,
      times.joinOpensLocal,
      times.joinClosesLocal,
      times.handInLocal,
      times.joinOpensAt,
      times.joinClosesAt,
      times.handInAt,
    ],
  );
  emitClassroomState(rows[0]);
  sendJson(ctx, 200, await classroomView(rows[0], reach.role));
};

export const replaceJoinCode = async (
  ctx: RequestContext,
  caller: Caller,
  params: Record<string, string>,
): Promise<void> => {
  const reach = await reachClassroom(caller, params.id);
  if (classroomState(reach.classroom) === 'archived') throw conflict('classroom_archived');
  const joinCode = await freshJoinCode();
  await query('update classrooms set join_code = $2 where id = $1', [reach.classroom.id, joinCode]);
  sendJson(ctx, 200, { joinCode });
};

export const handInClassroom = async (
  ctx: RequestContext,
  caller: Caller,
  params: Record<string, string>,
): Promise<void> => {
  const reach = await reachClassroom(caller, params.id);
  const state = classroomState(reach.classroom);
  if (state === 'archived') throw conflict('classroom_archived');
  if (state === 'handed_in') throw conflict('classroom_handed_in');
  if (state === 'draft') throw conflict('classroom_not_started');
  const now = new Date(Math.floor(serverNowMs() / 1000) * 1000);
  const local = utcToLocal(reach.classroom.time_zone, now.getTime());
  const rows = await query<ClassroomRow>(
    `update classrooms set hand_in_at = $2, hand_in_local = $3 where id = $1 returning ${CLASSROOM_COLUMNS}`,
    [reach.classroom.id, now, local],
  );
  emitClassroomState(rows[0]);
  sendJson(ctx, 200, await classroomView(rows[0], reach.role));
};

export const archiveClassroom = async (
  ctx: RequestContext,
  caller: Caller,
  params: Record<string, string>,
): Promise<void> => {
  const reach = requireOwner(await reachClassroom(caller, params.id));
  const state = classroomState(reach.classroom);
  if (state === 'archived') throw conflict('classroom_archived');
  if (state !== 'handed_in') throw conflict('not_handed_in');
  const rows = await query<ClassroomRow>(
    `update classrooms set archived = true where id = $1 returning ${CLASSROOM_COLUMNS}`,
    [reach.classroom.id],
  );
  const students = await query<{ id: string }>(
    "select id from accounts where classroom_id = $1 and kind = 'student'",
    [reach.classroom.id],
  );
  for (const student of students) {
    await endSessionsOfAccount(student.id, 'signed_out');
    emitAccessEnded(student.id, reach.classroom.id, UI_COPY.handedInClassroom(reach.classroom.name));
  }
  emitClassroomState(rows[0]);
  sendJson(ctx, 200, await classroomView(rows[0], reach.role));
};

export const renameStudent = async (
  ctx: RequestContext,
  caller: Caller,
  params: Record<string, string>,
  body: Record<string, unknown>,
): Promise<void> => {
  const reach = await reachClassroom(caller, params.id);
  const student = await queryOne<{ id: string; nickname_key: string }>(
    "select id, nickname_key from accounts where id = $1 and classroom_id = $2 and kind = 'student'",
    [params.studentId, reach.classroom.id],
  );
  if (!student) throw notFound();
  const raw = typeof body.nickname === 'string' ? body.nickname.trim().replace(/ {2,}/g, ' ') : '';
  if (raw !== '' && raw.toLowerCase() !== student.nickname_key) {
    const clash = await query<{ id: string }>(
      "select id from accounts where classroom_id = $1 and kind = 'student' and nickname_key = $2",
      [reach.classroom.id, raw.toLowerCase()],
    );
    if (clash.length > 0) throw conflict('nickname_taken');
  }
  const nickname = normaliseNickname(body.nickname);
  await query('update accounts set nickname = $2, nickname_key = $3, display_name = $2 where id = $1', [
    student.id,
    nickname.display,
    nickname.key,
  ]);
  emitStudentRenamed(reach.classroom.id, student.id, nickname.display);
  sendJson(ctx, 200, { id: student.id, nickname: nickname.display });
};

export const removeStudent = async (
  ctx: RequestContext,
  caller: Caller,
  params: Record<string, string>,
): Promise<void> => {
  const reach = await reachClassroom(caller, params.id);
  const student = await queryOne<{ id: string; nickname: string }>(
    "select id, nickname from accounts where id = $1 and classroom_id = $2 and kind = 'student'",
    [params.studentId, reach.classroom.id],
  );
  if (!student) throw notFound();

  const projects = await query<{ id: string }>('select id from projects where owner_id = $1', [student.id]);
  const exportRows = await query<{ object_key: string }>('select object_key from exports where owner_id = $1', [student.id]);
  const keys = [
    ...(
      await query<{ object_key: string }>(
        'select object_key from project_revisions where project_id = any($1::uuid[])',
        [projects.map((project) => project.id)],
      )
    ).map((row) => row.object_key),
    ...exportRows.map((row) => row.object_key),
  ];
  await query('delete from project_revisions where project_id = any($1::uuid[])', [projects.map((p) => p.id)]);
  await query('delete from idempotency_keys where account_id = $1', [student.id]);
  await query('delete from exports where owner_id = $1', [student.id]);
  await query('delete from projects where owner_id = $1', [student.id]);
  await endSessionsOfAccount(student.id, `removed:${reach.classroom.name}`);
  await query('delete from accounts where id = $1', [student.id]);
  emitAccessEnded(student.id, reach.classroom.id, UI_COPY.removedNotice(reach.classroom.name));
  emitStudentRemoved(reach.classroom.id, student.id, student.nickname);
  await forgetStoredObjects(keys);
  sendEmpty(ctx, 204);
};

export const addEducator = async (
  ctx: RequestContext,
  caller: Caller,
  params: Record<string, string>,
  body: Record<string, unknown>,
): Promise<void> => {
  const reach = requireOwner(await reachClassroom(caller, params.id));
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const educator = await queryOne<{ id: string; display_name: string; email: string }>(
    "select id, display_name, email from accounts where email_lower = $1 and kind = 'educator' and email_verified = true",
    [email],
  );
  if (!educator) throw new ApiError(422, 'no_such_educator');
  if (await educatorRoleIn(reach.classroom.id, educator.id)) throw conflict('already_added');
  await query("insert into classroom_educators (classroom_id, educator_id, role) values ($1, $2, 'assistant')", [
    reach.classroom.id,
    educator.id,
  ]);
  sendJson(ctx, 201, {
    id: educator.id,
    displayName: educator.display_name,
    email: educator.email,
    role: 'assistant',
  });
};

export const removeEducator = async (
  ctx: RequestContext,
  caller: Caller,
  params: Record<string, string>,
): Promise<void> => {
  const reach = requireOwner(await reachClassroom(caller, params.id));
  const role = await educatorRoleIn(reach.classroom.id, params.educatorId);
  if (!role) throw notFound();
  if (role === 'owner') throw conflict('owner_cannot_leave');
  await query('delete from classroom_educators where classroom_id = $1 and educator_id = $2', [
    reach.classroom.id,
    params.educatorId,
  ]);
  emitAccessEnded(params.educatorId, reach.classroom.id, UI_COPY.removedNotice(reach.classroom.name));
  sendEmpty(ctx, 204);
};

export const classroomExports = async (
  ctx: RequestContext,
  caller: Caller,
  params: Record<string, string>,
): Promise<void> => {
  const reach = await reachClassroom(caller, params.id);
  const rows = await query<ExportRow & { nickname: string }>(
    `select ${EXPORT_COLUMNS.split(', ').map((column) => `e.${column}`).join(', ')}, a.nickname
       from exports e
       join accounts a on a.id = e.owner_id
      where a.classroom_id = $1 and a.kind = 'student'
      order by e.created_at desc`,
    [reach.classroom.id],
  );
  sendJson(ctx, 200, { exports: rows.map((row) => ({ ...exportView(row), nickname: row.nickname })) });
};

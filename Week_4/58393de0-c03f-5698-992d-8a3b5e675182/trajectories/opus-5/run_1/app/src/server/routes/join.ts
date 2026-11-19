import { randomUUID } from 'node:crypto';
import { ApiError, conflict, notFound } from '../errors.js';
import { config } from '../config.js';
import { serverNow, serverNowMs } from '../clock.js';
import { query } from '../db.js';
import {
  MAX_STUDENTS,
  classroomState,
  countStudents,
  loadClassroom,
  loadClassroomByCode,
  studentClassroomView,
} from '../classrooms.js';
import { normaliseNickname } from '../nicknames.js';
import { createPendingSession, createSession, deleteSession, signedOutError, type Caller } from '../sessions.js';
import { sendJson, setSessionCookie, type RequestContext } from '../http.js';
import { ACCOUNT_COLUMNS, toAccount, type AccountRow } from '../accounts.js';
import { emitStudentJoined } from '../stream.js';

const normaliseCode = (raw: unknown): string =>
  typeof raw === 'string' ? raw.replace(/[\s-]/g, '').toUpperCase() : '';

const recordFailedAttempt = async (clientIp: string): Promise<void> => {
  await query('insert into join_attempts (client_ip, attempted_at) values ($1, $2)', [clientIp, serverNow()]);
};

const checkJoinRateLimit = async (clientIp: string): Promise<void> => {
  const since = new Date(serverNowMs() - 60_000);
  const rows = await query<{ attempted_at: Date }>(
    'select attempted_at from join_attempts where client_ip = $1 and attempted_at > $2 order by attempted_at asc',
    [clientIp, since],
  );
  if (rows.length < config.joinRateLimit) return;
  const first = rows[0].attempted_at.getTime();
  const retryAfterSeconds = Math.max(1, Math.ceil((first + 60_000 - serverNowMs()) / 1000));
  throw new ApiError(429, 'too_many_attempts', { retryAfterSeconds });
};

export const joinWithCode = async (
  ctx: RequestContext,
  caller: Caller,
  body: Record<string, unknown>,
): Promise<void> => {
  await checkJoinRateLimit(ctx.clientIp);
  const code = normaliseCode(body.code);
  const classroom = code === '' ? null : await loadClassroomByCode(code);
  if (!classroom) {
    await recordFailedAttempt(ctx.clientIp);
    throw new ApiError(404, 'unknown_code');
  }
  if (classroomState(classroom) !== 'open') {
    await recordFailedAttempt(ctx.clientIp);
    throw conflict('join_closed');
  }
  if ((await countStudents(classroom.id)) >= MAX_STUDENTS) {
    await recordFailedAttempt(ctx.clientIp);
    throw conflict('classroom_full');
  }
  if (caller.token) await deleteSession(caller.token);
  setSessionCookie(ctx, await createPendingSession(classroom.id));
  sendJson(ctx, 200, { classroom: { name: classroom.name } });
};

export const joinWithNickname = async (
  ctx: RequestContext,
  caller: Caller,
  body: Record<string, unknown>,
): Promise<void> => {
  if (!caller.pendingClassroomId) throw signedOutError(caller);
  const classroom = await loadClassroom(caller.pendingClassroomId);
  if (!classroom) throw notFound();
  if (classroomState(classroom) !== 'open') throw conflict('join_closed');

  const raw = typeof body.nickname === 'string' ? body.nickname.trim().replace(/ {2,}/g, ' ') : '';
  if (raw !== '') {
    const clash = await query<{ id: string }>(
      "select id from accounts where classroom_id = $1 and kind = 'student' and nickname_key = $2",
      [classroom.id, raw.toLowerCase()],
    );
    if (clash.length > 0) throw conflict('nickname_taken');
  }
  if ((await countStudents(classroom.id)) >= MAX_STUDENTS) throw conflict('classroom_full');

  const nickname = normaliseNickname(body.nickname);
  let rows: AccountRow[];
  try {
    rows = await query<AccountRow>(
      `insert into accounts (id, kind, display_name, classroom_id, nickname, nickname_key, email_verified)
       values ($1, 'student', $2, $3, $2, $4, true)
       returning ${ACCOUNT_COLUMNS}`,
      [randomUUID(), nickname.display, classroom.id, nickname.key],
    );
  } catch (error) {
    if (typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505') {
      throw conflict('nickname_taken');
    }
    throw error;
  }
  const student = rows[0];
  if (caller.token) await deleteSession(caller.token);
  setSessionCookie(ctx, await createSession(student.id));
  emitStudentJoined(classroom.id, { id: student.id, nickname: nickname.display });
  sendJson(ctx, 201, { account: toAccount(student) });
};

export const studentClass = async (ctx: RequestContext, caller: Caller): Promise<void> => {
  const account = caller.account;
  if (!account) throw signedOutError(caller);
  if (account.kind !== 'student' || !account.classroom_id) throw notFound();
  const classroom = await loadClassroom(account.classroom_id);
  if (!classroom) throw notFound();
  sendJson(ctx, 200, studentClassroomView(classroom));
};

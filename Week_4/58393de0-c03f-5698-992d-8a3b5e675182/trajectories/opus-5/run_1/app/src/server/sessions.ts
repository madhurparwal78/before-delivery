import { randomBytes } from 'node:crypto';
import { ApiError } from './errors.js';
import { query, queryOne } from './db.js';
import { ACCOUNT_COLUMNS, type AccountRow } from './accounts.js';
import type { RequestContext } from './http.js';
import { SESSION_COOKIE } from './http.js';

export interface SessionRow {
  token: string;
  account_id: string | null;
  pending_classroom_id: string | null;
  ended_reason: string | null;
}

export interface Caller {
  token: string | null;
  account: AccountRow | null;
  pendingClassroomId: string | null;
  endedReason: string | null;
}

export const newSessionToken = (): string => randomBytes(24).toString('base64url');

export const createSession = async (accountId: string): Promise<string> => {
  const token = newSessionToken();
  await query('insert into sessions (token, account_id) values ($1, $2)', [token, accountId]);
  return token;
};

export const createPendingSession = async (classroomId: string): Promise<string> => {
  const token = newSessionToken();
  await query('insert into sessions (token, pending_classroom_id) values ($1, $2)', [token, classroomId]);
  return token;
};

export const deleteSession = async (token: string): Promise<void> => {
  await query('delete from sessions where token = $1', [token]);
};

export const endSessionsOfAccount = async (accountId: string, reason: string): Promise<void> => {
  await query('update sessions set ended_reason = $2, account_id = null where account_id = $1', [accountId, reason]);
};

export const loadCaller = async (ctx: RequestContext): Promise<Caller> => {
  const token = ctx.cookies[SESSION_COOKIE] ?? null;
  if (!token) return { token: null, account: null, pendingClassroomId: null, endedReason: null };
  const row = await queryOne<SessionRow>(
    'select token, account_id, pending_classroom_id, ended_reason from sessions where token = $1',
    [token],
  );
  if (!row) return { token, account: null, pendingClassroomId: null, endedReason: null };
  if (row.ended_reason) {
    return { token, account: null, pendingClassroomId: null, endedReason: row.ended_reason };
  }
  if (!row.account_id) {
    return { token, account: null, pendingClassroomId: row.pending_classroom_id, endedReason: null };
  }
  const account = await queryOne<AccountRow>(`select ${ACCOUNT_COLUMNS} from accounts where id = $1`, [row.account_id]);
  if (!account) return { token, account: null, pendingClassroomId: null, endedReason: null };
  return { token, account, pendingClassroomId: null, endedReason: null };
};

/** A pending join session, an ended session and no session all read as signed out. */
export const signedOutError = (caller: Caller): ApiError => {
  if (caller.endedReason?.startsWith('removed:')) {
    return new ApiError(401, 'removed', { message: `You were removed from ${caller.endedReason.slice('removed:'.length)}.` });
  }
  return new ApiError(401, 'signed_out');
};

export const requireAccount = (caller: Caller): AccountRow => {
  if (!caller.account) throw signedOutError(caller);
  return caller.account;
};

import type { SessionInfo } from '../../shared/types.js';
import { ApiError } from '../errors.js';
import { config } from '../config.js';
import {
  consumeVerificationToken,
  createAccount,
  findAccountByEmail,
  passwordMatches,
  secondsUntilResendAllowed,
  sendVerificationEmail,
  toAccount,
  validateSignup,
} from '../accounts.js';
import { createSession, deleteSession, requireAccount, type Caller } from '../sessions.js';
import { clearSessionCookie, sendEmpty, sendJson, setSessionCookie, type RequestContext } from '../http.js';
import { loadClassroom } from '../classrooms.js';

export const homeRouteFor = (kind: 'educator' | 'personal' | 'student'): string =>
  kind === 'educator' ? '/dashboard' : kind === 'personal' ? '/projects' : '/class';

export const signup = async (ctx: RequestContext, caller: Caller, body: Record<string, unknown>): Promise<void> => {
  const input = validateSignup(body.email, body.password, body.displayName, body.accountType);
  if (await findAccountByEmail(input.email)) throw new ApiError(409, 'email_taken');
  const account = await createAccount({
    email: input.email,
    password: input.password,
    displayName: input.displayName,
    kind: input.accountType,
  });
  const accepted = await sendVerificationEmail(account);
  if (caller.token) await deleteSession(caller.token);
  setSessionCookie(ctx, await createSession(account.id));
  sendJson(ctx, 201, { account: toAccount(account), verificationEmailSent: accepted });
};

export const signin = async (ctx: RequestContext, caller: Caller, body: Record<string, unknown>): Promise<void> => {
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const account = await findAccountByEmail(email);
  if (!account || account.kind === 'student' || !passwordMatches(password, account.password_hash)) {
    throw new ApiError(401, 'bad_credentials');
  }
  if (caller.token) await deleteSession(caller.token);
  setSessionCookie(ctx, await createSession(account.id));
  sendJson(ctx, 200, { account: toAccount(account) });
};

export const signout = async (ctx: RequestContext, caller: Caller): Promise<void> => {
  if (caller.token) await deleteSession(caller.token);
  clearSessionCookie(ctx);
  sendEmpty(ctx, 204);
};

export const session = async (ctx: RequestContext, caller: Caller): Promise<void> => {
  let info: SessionInfo = { account: null, pendingJoin: null };
  if (caller.account) {
    info = { account: toAccount(caller.account), pendingJoin: null };
  } else if (caller.pendingClassroomId) {
    const classroom = await loadClassroom(caller.pendingClassroomId);
    info = { account: null, pendingJoin: classroom ? { classroomName: classroom.name } : null };
  }
  sendJson(ctx, 200, info);
};

export const verify = async (ctx: RequestContext, _caller: Caller, body: Record<string, unknown>): Promise<void> => {
  const token = typeof body.token === 'string' ? body.token : '';
  const account = await consumeVerificationToken(token);
  sendJson(ctx, 200, { account: toAccount(account) });
};

export const resendVerification = async (ctx: RequestContext, caller: Caller): Promise<void> => {
  const account = requireAccount(caller);
  if (account.email_verified) throw new ApiError(409, 'already_verified');
  const wait = secondsUntilResendAllowed(account);
  if (wait > 0) throw new ApiError(429, 'rate_limited', { retryAfterSeconds: wait });
  const accepted = await sendVerificationEmail(account);
  if (!accepted) throw new ApiError(503, 'mail_unavailable');
  sendJson(ctx, 202, { sentTo: account.email });
};

export const clientConfig = (ctx: RequestContext): void => {
  sendJson(ctx, 200, config.timers);
};

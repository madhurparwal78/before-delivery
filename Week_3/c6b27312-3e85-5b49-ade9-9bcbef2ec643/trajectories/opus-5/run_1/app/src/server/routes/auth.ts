import { config } from '../config';
import { query } from '../db';
import { ApiError, invalid } from '../errors';
import { Ctx, clearCookie, redirect, sendJson, setCookie } from '../http';
import {
  createSession,
  createUser,
  createVerificationToken,
  deleteSession,
  findUserByEmail,
  safeNext,
  validEmail,
  verifyPassword,
} from '../auth';
import { MailUnavailable, sendVerificationMail } from '../mail';
import { mailUnavailableSignup } from '../errors';
import { graphemeLength, normaliseText } from '../../shared/order';
import { requireUser } from './helpers';

const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export async function signup(ctx: Ctx): Promise<void> {
  const email = typeof ctx.body.email === 'string' ? ctx.body.email.trim() : '';
  const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  const displayName =
    typeof ctx.body.displayName === 'string' ? normaliseText(ctx.body.displayName.trim()) : '';
  const next = safeNext(typeof ctx.body.next === 'string' ? ctx.body.next : '/dashboard');

  const errors: Record<string, string> = {};
  if (!validEmail(email)) errors.email = 'Enter a valid email address.';
  if (password.length < 10) errors.password = 'Use at least 10 characters.';
  if (graphemeLength(displayName) < 1 || graphemeLength(displayName) > 40) {
    errors.displayName = 'Use 1 to 40 characters.';
  }
  if (Object.keys(errors).length > 0) throw invalid(errors);

  const existing = await findUserByEmail(email);
  if (existing) {
    throw new ApiError(409, {
      error: 'email_taken',
      message: 'An account with this email already exists.',
    });
  }

  const user = await createUser(email, password, displayName, false, new Date());
  const token = await createVerificationToken(user.id, next);
  try {
    await sendVerificationMail(email, token, next);
  } catch (error) {
    await query('delete from verification_tokens where user_id = $1', [user.id]);
    await query('delete from users where id = $1', [user.id]);
    if (error instanceof MailUnavailable) throw mailUnavailableSignup();
    throw error;
  }
  sendJson(ctx, 201, { status: 'verification_sent' });
}

export async function verify(ctx: Ctx): Promise<void> {
  const token = ctx.url.searchParams.get('token') ?? '';
  const next = safeNext(ctx.url.searchParams.get('next'));
  const result = await query<{ user_id: string; created_at: Date; used_at: Date | null }>(
    'select user_id, created_at, used_at from verification_tokens where token = $1',
    [token],
  );
  const row = result.rows[0];
  const expired =
    !row ||
    row.used_at !== null ||
    (Date.now() - row.created_at.getTime()) / 1000 >= config.verifyTokenTtlSeconds;
  if (expired) {
    redirect(ctx, '/signin?expired=1');
    return;
  }
  await query('update verification_tokens set used_at = now() where token = $1', [token]);
  await query('update users set verified = true where id = $1', [row.user_id]);
  const session = await createSession(row.user_id);
  setCookie(ctx.res, 'tw_session', session, SESSION_MAX_AGE);
  redirect(ctx, next);
}

export async function signin(ctx: Ctx): Promise<void> {
  const email = typeof ctx.body.email === 'string' ? ctx.body.email.trim() : '';
  const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  const next = typeof ctx.body.next === 'string' ? ctx.body.next : null;
  const user = await findUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new ApiError(401, {
      error: 'invalid_credentials',
      message: 'Email or password is incorrect.',
    });
  }
  if (!user.verified) {
    throw new ApiError(403, {
      error: 'unverified',
      message: 'Confirm your email first; we sent you a link.',
    });
  }
  const session = await createSession(user.id);
  setCookie(ctx.res, 'tw_session', session, SESSION_MAX_AGE);
  sendJson(ctx, 200, {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    landing: next === null ? '/dashboard' : safeNext(next),
  });
}

export async function signout(ctx: Ctx): Promise<void> {
  const session = ctx.cookies.tw_session;
  if (session) await deleteSession(session);
  clearCookie(ctx.res, 'tw_session');
  ctx.res.writeHead(204).end();
}

export async function me(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  sendJson(ctx, 200, { id: user.id, email: user.email, displayName: user.displayName });
}

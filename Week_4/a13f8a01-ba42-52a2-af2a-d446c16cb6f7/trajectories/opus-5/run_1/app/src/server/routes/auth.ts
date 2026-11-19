import { copy } from '../../shared/copy';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  findUserByEmail,
  findUserByHandle,
  insertUser,
  requireUser,
  serializeSessionCookie,
  userShape,
  type UserRow,
} from '../auth';
import { config } from '../config';
import { one, query } from '../db';
import { apiError, ApiError, raiseFirst } from '../errors';
import { emitAccountVerified } from '../events';
import { isEmail, isHandle, isPassword } from '../domain/validate';
import { json, noContent, type Ctx, type Reply, type Router } from '../http';
import { sendVerification } from '../mail';
import { hashPassword, newToken, verifyPassword } from '../util';

interface TokenRow {
  token: string;
  user_id: string;
  expires_at: Date;
  used: boolean;
  invalidated: boolean;
}

const issueToken = async (userId: string): Promise<string> => {
  await query('update verify_tokens set invalidated = true where user_id = $1 and used = false', [
    userId,
  ]);
  const token = newToken();
  const issuedAt = new Date();
  await query(
    'insert into verify_tokens (token, user_id, issued_at, expires_at) values ($1, $2, $3, $4)',
    [token, userId, issuedAt, new Date(issuedAt.getTime() + config.verifyTtlSeconds * 1000)],
  );
  return token;
};

const signup = async (ctx: Ctx): Promise<Reply> => {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const handle = typeof body.handle === 'string' ? body.handle : '';
  const email = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';

  const duplicates: Record<string, string> = {};
  if (await findUserByHandle(handle)) duplicates.handle = copy.handleTaken;
  if (await findUserByEmail(email)) duplicates.email = copy.emailTaken;

  const invalid: Record<string, string> = {};
  if (!isHandle(handle)) invalid.handle = copy.handleFormat;
  if (!isEmail(email)) invalid.email = copy.emailFormat;
  if (!isPassword(password)) invalid.password = copy.passwordFormat;

  raiseFirst(
    Object.keys(duplicates).length > 0 ? apiError('duplicate', { fields: duplicates }) : null,
    Object.keys(invalid).length > 0 ? apiError('validation', { fields: invalid }) : null,
  );

  const user = await insertUser({
    handle,
    email,
    passwordHash: hashPassword(password),
    verified: false,
  });
  const token = await issueToken(user.id);
  const sent = await sendVerification(user.handle, user.email, token);
  return {
    status: 201,
    body: { user: userShape(user), verification: sent ? 'sent' : 'pending' },
    cookie: serializeSessionCookie(await createSession(user.id)),
  };
};

const signin = async (ctx: Ctx): Promise<Reply> => {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const email = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const user = await findUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) throw apiError('bad_credentials');
  return {
    status: 200,
    body: { user: userShape(user) },
    cookie: serializeSessionCookie(await createSession(user.id)),
  };
};

const signout = async (ctx: Ctx): Promise<Reply> => {
  if (ctx.sessionId) await destroySession(ctx.sessionId);
  return { ...noContent(), cookie: clearSessionCookie() };
};

const me = async (ctx: Ctx): Promise<Reply> => json(200, { user: userShape(requireUser(ctx.user)) });

const verify = async (ctx: Ctx): Promise<Reply> => {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const token = typeof body.token === 'string' ? body.token : '';
  const row = await one<TokenRow>('select * from verify_tokens where token = $1', [token]);
  if (!row || row.used || row.invalidated) throw apiError('token_invalid', { message: copy.verifyInvalid });
  if (row.expires_at.getTime() <= Date.now()) {
    throw apiError('token_expired', { message: copy.verifyExpired });
  }
  await query('update verify_tokens set used = true where token = $1', [token]);
  await query('update verify_tokens set invalidated = true where user_id = $1 and used = false', [
    row.user_id,
  ]);
  const rows = await query<UserRow>('update users set verified = true where id = $1 returning *', [
    row.user_id,
  ]);
  const user = rows[0]!;
  emitAccountVerified(user.id);
  return json(200, { user: userShape(user) });
};

const resend = async (ctx: Ctx): Promise<Reply> => {
  const user = requireUser(ctx.user);
  if (user.verified) throw apiError('already_verified');
  const token = await issueToken(user.id);
  const sent = await sendVerification(user.handle, user.email, token);
  if (!sent) throw new ApiError('mail_unavailable', { message: copy.resendMailDown });
  return json(202, { verification: 'sent' });
};

export const registerAuthRoutes = (router: Router): void => {
  router.add('POST', '/api/signup', signup);
  router.add('POST', '/api/signin', signin);
  router.add('POST', '/api/signout', signout);
  router.add('GET', '/api/me', me);
  router.add('POST', '/api/verify', verify);
  router.add('POST', '/api/verify/resend', resend);
};

import { pool, one, rows, tx, isUniqueViolation } from '../db.js';
import { config } from '../config.js';
import { now, secondsFromNow } from '../clock.js';
import { AppError, conflict, notFound, unauthenticated, validation } from '../errors.js';
import { created, noContent, ok, route, sessionCookie, type Ctx } from '../http.js';
import {
  SESSION_COOKIE, createSession, findUserByLogin, hashPassword, insertUser, ownAccount, passwordMatches, publicUser,
  revokeSession, revokeSessions, findUserByUsername, sessionUser,
} from '../accounts.js';
import { requireUser } from '../guards.js';
import { issueToken, consumeToken } from '../tokens.js';
import { mails, sendMail } from '../mail.js';
import { codeMatches, newSecret, otpauthUri } from '../totp.js';
import {
  COPY, asRecord, asString, failIfAny, isValidEmail, isValidPassword, isValidUsername, normaliseEmail, type Fields,
} from '../validate.js';
import { feedPage } from '../feed.js';

async function sendVerification(userId: string, email: string): Promise<void> {
  await sendMail(mails.verification(email, await issueToken(pool, userId, 'verify', config.limits.verifyLinkTtlSeconds)));
}

async function signup(ctx: Ctx) {
  const input = asRecord(ctx.body);
  const email = normaliseEmail(asString(input.email) ?? '');
  const username = asString(input.username) ?? '';
  const password = asString(input.password) ?? '';
  const fields: Fields = {};
  if (!isValidEmail(email)) fields.email = COPY.email;
  if (!isValidUsername(username)) fields.username = COPY.username;
  if (!isValidPassword(password)) fields.password = COPY.password;
  failIfAny(fields);
  const taken = await one<{ username_taken: boolean; email_taken: boolean }>(pool,
    `SELECT bool_or(username_key = lower($1)) AS username_taken, bool_or(email_key = lower($2)) AS email_taken
     FROM users WHERE username_key = lower($1) OR email_key = lower($2)`, [username, email]);
  const clashes: Fields = {};
  if (taken?.username_taken) clashes.username = COPY.usernameTaken;
  if (taken?.email_taken) clashes.email = COPY.emailTaken;
  const nameTaken = (): AppError => new AppError('NAME_TAKEN', 'That username or email is already in use', { fields: clashes });
  if (Object.keys(clashes).length > 0) throw nameTaken();
  const passwordHash = await hashPassword(password);
  const userId = await insertUser(pool, {
    username, email, passwordHash, emailVerified: false, role: 'user', totpSecret: null, createdAt: now(),
  }).catch(async (error: unknown) => {
    if (!isUniqueViolation(error)) throw error;
    // lost a race on a unique key: name the key that clashed (the constraint), not a guess
    const constraint = (error as { constraint?: string }).constraint ?? '';
    const late: Fields = {};
    if (constraint.includes('email')) late.email = COPY.emailTaken;
    else if (constraint.includes('username')) late.username = COPY.usernameTaken;
    else {
      const again = await one<{ username_taken: boolean; email_taken: boolean }>(pool,
        `SELECT COALESCE(bool_or(username_key = lower($1)), false) AS username_taken, COALESCE(bool_or(email_key = lower($2)), false) AS email_taken
         FROM users WHERE username_key = lower($1) OR email_key = lower($2)`, [username, email]);
      if (again?.username_taken) late.username = COPY.usernameTaken;
      if (again?.email_taken) late.email = COPY.emailTaken;
    }
    throw new AppError('NAME_TAKEN', 'That username or email is already in use', { fields: late });
  });
  const token = await createSession(pool, userId);
  const user = await findUserByUsername(pool, username);
  await sendVerification(userId, email);
  return created(ownAccount(sessionUser(user as NonNullable<typeof user>)), { 'Set-Cookie': sessionCookie(token, 30 * 86_400) });
}

async function verify(ctx: Ctx) {
  const token = asString(asRecord(ctx.body).token) ?? '';
  const userId = await consumeToken(pool, token, 'verify');
  if (!userId) throw validation({ token: COPY.token });
  await pool.query('UPDATE users SET email_verified = true WHERE id = $1', [userId]);
  return ok({ emailVerified: true });
}

async function resend(ctx: Ctx) {
  const user = requireUser(ctx);
  const window = secondsFromNow(-config.limits.verifyResendWindowSeconds);
  const recent = await rows<{ created_at: Date }>(pool,
    "SELECT created_at FROM email_tokens WHERE user_id = $1 AND kind = 'verify' AND created_at > $2 ORDER BY created_at",
    [user.id, window]);
  if (recent.length >= config.limits.verifyResendLimit) {
    const oldest = (recent[0] as { created_at: Date }).created_at;
    const retryAfter = Math.max(1, Math.ceil((oldest.getTime() + config.limits.verifyResendWindowSeconds * 1000 - now().getTime()) / 1000));
    throw new AppError('RATE_LIMITED', 'Too many emails sent. Try again later.', { retryAfter });
  }
  if (user.emailVerified) throw conflict('This email address is already confirmed');
  await sendVerification(user.id, user.email);
  return { status: 202, body: { sent: true } };
}

interface Locked { lockedFor: number }

async function recordFailure(userId: string): Promise<Locked | null> {
  return tx(async (client) => {
    await client.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId]);
    await client.query('INSERT INTO login_failures (user_id, at) VALUES ($1, $2)', [userId, now()]);
    const counted = await one<{ failures: number }>(client,
      'SELECT count(*)::int AS failures FROM login_failures WHERE user_id = $1 AND at > $2',
      [userId, secondsFromNow(-config.limits.loginLockoutSeconds)]);
    if ((counted?.failures ?? 0) < config.limits.loginLockoutAttempts) return null;
    await client.query('UPDATE users SET locked_until = $2 WHERE id = $1', [userId, secondsFromNow(config.limits.loginLockoutSeconds)]);
    return { lockedFor: config.limits.loginLockoutSeconds };
  });
}

const rateLimited = (seconds: number): AppError =>
  new AppError('RATE_LIMITED', 'Too many failed sign-ins. Try again later or reset your password.', { retryAfter: Math.max(1, seconds) });

async function login(ctx: Ctx) {
  const input = asRecord(ctx.body);
  const loginName = asString(input.login) ?? '';
  const password = asString(input.password) ?? '';
  const code = input.totp;
  const account = loginName ? await findUserByLogin(pool, loginName) : null;
  if (!account) throw unauthenticated('Email or password is incorrect');
  if (account.locked_until && account.locked_until > now()) {
    throw rateLimited(Math.ceil((account.locked_until.getTime() - now().getTime()) / 1000));
  }
  const failure = async (fields?: Fields): Promise<never> => {
    const locked = await recordFailure(account.id);
    if (locked) {
      void sendMail(mails.lockout(account.email));
      throw rateLimited(locked.lockedFor);
    }
    throw new AppError('UNAUTHENTICATED', 'Email or password is incorrect', fields ? { fields } : {});
  };
  if (!(await passwordMatches(account.password_hash, password))) return failure();
  if (account.suspended_at) throw new AppError('SUSPENDED', 'This account is suspended');
  if (account.totp_enabled && account.totp_secret) {
    if (code === undefined || code === null || code === '') {
      throw new AppError('TOTP_REQUIRED', COPY.totp, { status: 401 });
    }
    if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code)) throw validation({ totp: COPY.totp });
    if (!codeMatches(account.totp_secret, code, now())) return failure({ totp: COPY.totpMismatch });
  }
  await pool.query('DELETE FROM login_failures WHERE user_id = $1', [account.id]);
  await pool.query('UPDATE users SET locked_until = NULL WHERE id = $1', [account.id]);
  const token = await createSession(pool, account.id);
  return ok(ownAccount(sessionUser(account)), { 'Set-Cookie': sessionCookie(token, 30 * 86_400) });
}

async function requestReset(ctx: Ctx) {
  const email = normaliseEmail(asString(asRecord(ctx.body).email) ?? '');
  const account = await one<{ id: string; email: string }>(pool, 'SELECT id, email FROM users WHERE email_key = lower($1)', [email]);
  if (account) {
    await sendMail(mails.passwordReset(account.email, await issueToken(pool, account.id, 'reset', config.limits.resetLinkTtlSeconds)));
  }
  return { status: 202, body: { sent: true } };
}

async function confirmReset(ctx: Ctx) {
  const input = asRecord(ctx.body);
  const token = asString(input.token) ?? '';
  const newPassword = asString(input.newPassword) ?? '';
  const fields: Fields = {};
  if (!isValidPassword(newPassword)) fields.newPassword = COPY.password;
  const passwordHash = fields.newPassword ? '' : await hashPassword(newPassword);
  await tx(async (client) => {
    const userId = await consumeToken(client, token, 'reset');
    if (!userId) fields.token = COPY.token;
    failIfAny(fields);
    await client.query('UPDATE users SET password_hash = $2, locked_until = NULL WHERE id = $1', [userId, passwordHash]);
    await client.query('DELETE FROM login_failures WHERE user_id = $1', [userId]);
    await revokeSessions(client, userId as string);
  });
  return ok({ reset: true });
}

async function logout(ctx: Ctx) {
  if (ctx.token) await revokeSession(pool, ctx.token);
  return noContent({ 'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` });
}

async function setupTotp(ctx: Ctx) {
  const user = requireUser(ctx);
  if (user.totpEnabled) throw conflict('Two-factor authentication is already on');
  const pending = await one<{ totp_secret: string | null }>(pool, 'SELECT totp_secret FROM users WHERE id = $1', [user.id]);
  const secret = pending?.totp_secret ?? newSecret();
  await pool.query('UPDATE users SET totp_secret = $2 WHERE id = $1', [user.id, secret]);
  return ok({ secret, otpauthUri: otpauthUri(user.username, secret) });
}

async function enableTotp(ctx: Ctx) {
  const user = requireUser(ctx);
  const code = asString(asRecord(ctx.body).code) ?? '';
  const pending = await one<{ totp_secret: string | null }>(pool, 'SELECT totp_secret FROM users WHERE id = $1', [user.id]);
  if (user.totpEnabled || !pending?.totp_secret) throw conflict('Set up two-factor authentication first');
  if (!/^[0-9]{6}$/.test(code) || !codeMatches(pending.totp_secret, code, now())) throw validation({ code: COPY.totpMismatch });
  await pool.query('UPDATE users SET totp_enabled = true WHERE id = $1', [user.id]);
  return ok({ totpEnabled: true });
}

export function registerAuthRoutes(): void {
  route('POST', '/api/auth/signup', signup);
  route('POST', '/api/auth/verify', verify);
  route('POST', '/api/auth/verify/resend', resend);
  route('POST', '/api/auth/login', login);
  route('POST', '/api/auth/logout', logout);
  route('POST', '/api/auth/password-reset', requestReset);
  route('POST', '/api/auth/password-reset/confirm', confirmReset);
  route('GET', '/api/me', async (ctx) => ok(ownAccount(requireUser(ctx))));
  route('POST', '/api/me/totp/setup', setupTotp);
  route('POST', '/api/me/totp/enable', enableTotp);
  route('GET', '/api/users/:username', async (ctx) => {
    const found = await findUserByUsername(pool, ctx.params.username as string);
    if (!found) throw notFound('No such member');
    return ok(publicUser(found));
  });
  route('GET', '/api/users/:username/posts', async (ctx) => {
    const found = await findUserByUsername(pool, ctx.params.username as string);
    if (!found) throw notFound('No such member');
    return ok(await feedPage(pool, ctx.session.user, 'new', ctx.query.get('cursor'), 'p.author_id = $4', [found.id]));
  });
}

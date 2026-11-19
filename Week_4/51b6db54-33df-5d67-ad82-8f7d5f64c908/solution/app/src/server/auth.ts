import { randomInt, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { one, pool, rows } from './db';
import { invalid, notFound } from './errors';
import { decodePart, newToken, route, type SessionUser, type Ctx } from './http';
import { enqueueMail } from './mailer';
import { NUMBER_FORMATS, TIME_ZONES } from '../shared/rules';

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(password, salt, 32).toString('hex')}`;
}

function passwordMatches(password: string, stored: string): boolean {
  const [salt = '', hash = ''] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, Buffer.from(salt, 'hex'), 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

interface UserRow {
  id: number;
  email: string;
  name: string;
  number_format: SessionUser['number_format'];
  time_zone: SessionUser['time_zone'];
}

export async function lookupSession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const user = await one<UserRow>(
    pool,
    'SELECT u.id, u.email, u.name, u.number_format, u.time_zone FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1',
    [token],
  );
  return user ?? null;
}

const COOKIE = (token: string): string => `sid=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`;

async function startSession(userId: number): Promise<string> {
  const token = newToken(32);
  await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, userId]);
  return COOKIE(token);
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const bodyOf = (ctx: Ctx): Record<string, unknown> => (typeof ctx.body === 'object' && ctx.body !== null ? (ctx.body as Record<string, unknown>) : {});

route('POST', '/api/auth/signup', async (ctx) => {
  const { email: rawEmail, password, name } = bodyOf(ctx);
  const email = text(rawEmail).trim().toLowerCase();
  const errors: Record<string, string> = {};
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = 'Use a valid email address';
  else if (await one(pool, 'SELECT 1 FROM users WHERE email = $1', [email])) errors.email = 'Already registered';
  if (text(password).length < 8) errors.password = 'Use at least 8 characters';
  if (text(name).trim() === '') errors.name = 'Enter your name';
  if (Object.keys(errors).length > 0) throw invalid(errors);
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await pool.query('INSERT INTO users (email, name, password_hash, confirmed, code) VALUES ($1, $2, $3, false, $4)', [
    email,
    text(name).trim(),
    hashPassword(text(password)),
    code,
  ]);
  await enqueueMail(pool, { to: email, subject: `Your Celmate code: ${code}`, body: `Your Celmate code: ${code}\n\nEnter it to confirm your email.` });
  return { status: 201, body: { status: 'pending' } };
});

route('POST', '/api/auth/confirm', async (ctx) => {
  const email = text(bodyOf(ctx).email).trim().toLowerCase();
  const code = text(bodyOf(ctx).code).trim();
  const user = await one<UserRow & { code: string | null }>(pool, 'SELECT id, email, name, code FROM users WHERE email = $1 AND confirmed = false', [email]);
  if (!user || user.code !== code) throw invalid({ code: 'That code is not right' });
  await pool.query('UPDATE users SET confirmed = true, code = NULL WHERE id = $1', [user.id]);
  return { status: 200, body: { id: user.id, email: user.email, name: user.name }, headers: { 'set-cookie': await startSession(user.id) } };
});

route('POST', '/api/auth/login', async (ctx) => {
  const email = text(bodyOf(ctx).email).trim().toLowerCase();
  const user = await one<UserRow & { password_hash: string; confirmed: boolean }>(
    pool,
    'SELECT id, email, name, password_hash, confirmed FROM users WHERE email = $1',
    [email],
  );
  if (!user || !passwordMatches(text(bodyOf(ctx).password), user.password_hash)) throw invalid({ password: 'Email or password is incorrect' });
  if (!user.confirmed) throw invalid({ email: 'Confirm your email first' });
  return { status: 200, body: { id: user.id, email: user.email, name: user.name }, headers: { 'set-cookie': await startSession(user.id) } };
});

route('POST', '/api/auth/logout', async (ctx) => {
  const cookie = /sid=([^;]+)/.exec(ctx.req.headers.cookie ?? '')?.[1];
  if (cookie) await pool.query('DELETE FROM sessions WHERE token = $1', [decodeURIComponent(cookie)]);
  return { status: 204, headers: { 'set-cookie': 'sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0' } };
});

const profile = (user: SessionUser): Record<string, unknown> => ({
  id: user.id,
  email: user.email,
  name: user.name,
  number_format: user.number_format,
  time_zone: user.time_zone,
});

route('GET', '/api/me', (ctx) => profile(ctx.need()));

route('PATCH', '/api/me', async (ctx) => {
  const user = ctx.need();
  const { number_format: format, time_zone: zone } = bodyOf(ctx);
  const errors: Record<string, string> = {};
  if (format !== undefined && !(NUMBER_FORMATS as readonly unknown[]).includes(format)) errors.number_format = `Use ${NUMBER_FORMATS.join(' or ')}`;
  if (zone !== undefined && !(TIME_ZONES as readonly unknown[]).includes(zone)) errors.time_zone = `Use ${TIME_ZONES.join(', ')}`;
  if (Object.keys(errors).length > 0) throw invalid(errors);
  const updated = await one<UserRow>(
    pool,
    'UPDATE users SET number_format = COALESCE($2, number_format), time_zone = COALESCE($3, time_zone) WHERE id = $1 RETURNING id, email, name, number_format, time_zone',
    [user.id, format ?? null, zone ?? null],
  );
  if (!updated) throw notFound();
  return profile(updated);
});

export async function userNames(ids: readonly number[]): Promise<Map<number, string>> {
  const found = await rows<{ id: number; name: string }>(pool, 'SELECT id, name FROM users WHERE id = ANY($1)', [ids]);
  return new Map(found.map((row) => [row.id, row.name]));
}


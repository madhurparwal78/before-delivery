import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Role } from '../shared/types.js';
import { config } from './config.js';
import { one, pool, type Queryable } from './db.js';
import { dateInZone } from './domain/zones.js';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export interface User {
  id: string;
  role: Role;
  name: string;
  email: string;
  tz: string;
  coach_code: string | null;
  series_start: string | null;
  start_ctl: number;
  start_atl: number;
}

export const SESSION_COOKIE = 'sid';

const USER_COLUMNS = 'id, role, name, email, tz, coach_code, series_start, start_ctl, start_atl';

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt = '', hash = ''] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const actual = await scryptAsync(password, Buffer.from(salt, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

const digest = (token: string): string => createHash('sha256').update(token).digest('hex');
const newToken = (): string => randomBytes(32).toString('base64url');

export async function createSession(userId: string, q: Queryable = pool): Promise<string> {
  const token = newToken();
  await q.query('INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)', [digest(token), userId]);
  return token;
}

export async function endSession(token: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [digest(token)]);
}

async function userForSession(token: string): Promise<User | null> {
  const { rows } = await pool.query<User>(
    `SELECT ${USER_COLUMNS.split(', ').map((c) => `u.${c}`).join(', ')} FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`,
    [digest(token)]
  );
  return rows[0] ?? null;
}

/** The signed-in user of a request, from its session cookie. */
export async function userOfRequest(c: Context): Promise<User | null> {
  const token = getCookie(c, SESSION_COOKIE);
  return token ? userForSession(token) : null;
}

/** A one-time sign-in link's path; the token is valid for one use. */
export async function issueSignInLink(userId: string, q: Queryable): Promise<string> {
  const token = newToken();
  await q.query('INSERT INTO sign_in_links (token_hash, user_id) VALUES ($1, $2)', [digest(token), userId]);
  return `/auth/one-time/${token}`;
}

export async function redeemSignInLink(token: string): Promise<string | null> {
  const { rows } = await pool.query<{ user_id: string }>(
    'UPDATE sign_in_links SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL RETURNING user_id',
    [digest(token)]
  );
  return rows[0]?.user_id ?? null;
}

export async function userByEmail(email: string): Promise<(User & { password_hash: string }) | null> {
  const { rows } = await pool.query<User & { password_hash: string }>(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = $1`, [email]);
  return rows[0] ?? null;
}

/** A user that is known to exist, such as one just written. */
export async function requireUser(id: string, q: Queryable = pool): Promise<User> {
  return one(await q.query<User>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]));
}

/** The athlete the user may open: themselves, or an athlete with an accepted link to the coach. */
export async function openableAthlete(user: User, athleteId: string, q: Queryable = pool): Promise<User | null> {
  if (user.role === 'athlete') return user.id === athleteId ? user : null;
  const { rows } = await q.query<User>(
    `SELECT ${USER_COLUMNS.split(', ').map((c) => `u.${c}`).join(', ')} FROM users u
       JOIN links l ON l.athlete_id = u.id AND l.coach_id = $1 AND l.status = 'accepted'
      WHERE u.id = $2 AND u.role = 'athlete'`,
    [user.id, athleteId]
  );
  return rows[0] ?? null;
}

export async function linkedCoachIds(athleteId: string, q: Queryable = pool): Promise<string[]> {
  const { rows } = await q.query<{ coach_id: string }>("SELECT coach_id FROM links WHERE athlete_id = $1 AND status = 'accepted'", [athleteId]);
  return rows.map((row) => row.coach_id);
}

export async function audienceOf(athleteId: string, q: Queryable = pool): Promise<string[]> {
  return [athleteId, ...(await linkedCoachIds(athleteId, q))];
}

export const newId = (): string => randomUUID();

/** The server's today: the grading seed's override, else APP_TODAY, else the date in APP_TZ. */
export async function todayDate(q: Queryable = pool): Promise<string> {
  const { rows } = await q.query<{ value: string }>("SELECT value FROM meta WHERE key = 'today'");
  return rows[0]?.value ?? config.appToday ?? dateInZone(new Date(), config.appTz);
}

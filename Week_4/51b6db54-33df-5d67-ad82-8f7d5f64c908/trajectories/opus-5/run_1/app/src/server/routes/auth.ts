import type { NumberFormat, TimeZone } from '../../shared/types.js';
import { requirePerson } from '../access.js';
import { now } from '../clock.js';
import { one, query } from '../db.js';
import { unprocessable } from '../errors.js';
import { SESSION_COOKIE, type Route } from '../http.js';
import { closeStream, openStream } from '../live.js';
import { enqueueMail } from '../mail.js';
import { hashPassword, passwordMatches, signupCode, token } from '../secrets.js';
import { fieldError } from '../validate.js';

interface UserRow {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  password_salt: string;
  confirmed: boolean;
  code: string | null;
  number_format: NumberFormat;
  time_zone: TimeZone;
}

export async function startSession(userId: number): Promise<string> {
  const value = token(32);
  await query('INSERT INTO sessions (token, user_id, created_at) VALUES ($1, $2, $3)', [
    value,
    userId,
    await now(),
  ]);
  return value;
}

export function sessionCookie(value: string): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
}

const NUMBER_FORMATS: NumberFormat[] = ['en-US', 'en-IN'];
const TIME_ZONES: TimeZone[] = ['UTC', 'Asia/Kolkata', 'America/New_York'];

export const authRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/auth/signup',
    handler: async (ctx) => {
      const email = String(ctx.body.email ?? '').trim().toLowerCase();
      const password = String(ctx.body.password ?? '');
      const name = String(ctx.body.name ?? '').trim();
      const errors: Record<string, string> = {};
      if (email === '' || !email.includes('@')) errors.email = 'Use an email address';
      if (name === '') errors.name = 'Write your name';
      if (password.length < 8) errors.password = 'Use at least 8 characters';
      if (errors.email === undefined) {
        const taken = await one('SELECT id FROM users WHERE email = $1', [email]);
        if (taken !== null) errors.email = 'Already registered';
      }
      if (Object.keys(errors).length > 0) throw unprocessable(errors);
      const { hash, salt } = hashPassword(password);
      const code = signupCode();
      await query(
        `INSERT INTO users (email, name, password_hash, password_salt, confirmed, code, created_at)
         VALUES ($1, $2, $3, $4, false, $5, $6)`,
        [email, name, hash, salt, code, await now()],
      );
      await enqueueMail(email, `Your Celmate code: ${code}`, [code]);
      return { status: 201, body: { status: 'pending' } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/auth/confirm',
    handler: async (ctx) => {
      const email = String(ctx.body.email ?? '').trim().toLowerCase();
      const code = String(ctx.body.code ?? '').trim();
      const user = await one<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
      if (user === null || user.code !== code) fieldError('code', 'That code is not right');
      const person = user as UserRow;
      await query('UPDATE users SET confirmed = true, code = NULL WHERE id = $1', [person.id]);
      ctx.setCookie(sessionCookie(await startSession(person.id)));
      return { status: 200, body: { id: person.id, email: person.email, name: person.name } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/auth/login',
    handler: async (ctx) => {
      const email = String(ctx.body.email ?? '').trim().toLowerCase();
      const password = String(ctx.body.password ?? '');
      const user = await one<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
      if (user === null || !passwordMatches(password, user.password_hash, user.password_salt)) {
        fieldError('password', 'Email or password is incorrect');
      }
      const person = user as UserRow;
      if (!person.confirmed) fieldError('email', 'Confirm your email first');
      ctx.setCookie(sessionCookie(await startSession(person.id)));
      return { status: 200, body: { id: person.id, email: person.email, name: person.name } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/auth/logout',
    handler: async (ctx) => {
      const cookie = ctx.req.headers.cookie ?? '';
      const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
      if (match !== null) await query('DELETE FROM sessions WHERE token = $1', [match[1]]);
      ctx.setCookie(`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
      return { status: 204 };
    },
  },
  {
    method: 'GET',
    pattern: '/api/me',
    handler: async (ctx) => {
      const person = requirePerson(ctx);
      return {
        status: 200,
        body: {
          id: person.id,
          email: person.email,
          name: person.name,
          number_format: person.number_format,
          time_zone: person.time_zone,
        },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/me/live',
    raw: true,
    handler: async (ctx) => {
      const person = requirePerson(ctx);
      const stream = openStream(ctx.res, { personId: person.id });
      ctx.req.on('close', () => closeStream(stream));
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/me',
    handler: async (ctx) => {
      const person = requirePerson(ctx);
      let numberFormat = person.number_format;
      let timeZone = person.time_zone;
      if (ctx.body.number_format !== undefined) {
        const value = String(ctx.body.number_format) as NumberFormat;
        if (!NUMBER_FORMATS.includes(value)) fieldError('number_format', 'Choose en-US or en-IN');
        numberFormat = value;
      }
      if (ctx.body.time_zone !== undefined) {
        const value = String(ctx.body.time_zone) as TimeZone;
        if (!TIME_ZONES.includes(value)) {
          fieldError('time_zone', 'Choose UTC, Asia/Kolkata or America/New_York');
        }
        timeZone = value;
      }
      await query('UPDATE users SET number_format = $2, time_zone = $3 WHERE id = $1', [
        person.id,
        numberFormat,
        timeZone,
      ]);
      return {
        status: 200,
        body: {
          id: person.id,
          email: person.email,
          name: person.name,
          number_format: numberFormat,
          time_zone: timeZone,
        },
      };
    },
  },
];

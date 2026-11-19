import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { MeBody, TeacherBody } from '../../shared/wire';
import { authenticate, createAuthSession } from '../access';
import { isUniqueViolation, one, pool, run } from '../db';
import { Refusal } from '../errors';
import { characters, cookieOf, reply, SESSION_COOKIE, sessionCookie, textOf, type Route } from '../http';
import { newId } from '../ids';
import { DEFAULT_WORLD } from '../world';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailTaken = (): Refusal => new Refusal(409, 'An account with that email already exists.');

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${(await derive(password, salt)).toString('hex')}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = await derive(password, Buffer.from(salt, 'hex'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const emailKey = (email: string): string => email.trim().toLowerCase();

interface TeacherRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
}

export const accountRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/teachers',
    handler: async (ctx) => {
      const body = await ctx.json();
      const email = textOf(body.email)?.trim() ?? '';
      const password = textOf(body.password) ?? '';
      const displayName = textOf(body.displayName)?.trim() ?? '';
      if (await one(pool, 'SELECT 1 AS found FROM teachers WHERE email_key = $1', [emailKey(email)])) {
        throw emailTaken();
      }
      if (!EMAIL.test(email) || email.length > 254) throw new Refusal(422, 'Enter a valid email address.');
      if (characters(password) < 10) throw new Refusal(422, 'Use at least 10 characters for your password.');
      if (characters(displayName) < 1 || characters(displayName) > 60) throw new Refusal(422, 'Enter a name of 1 to 60 characters.');
      const id = newId('tch');
      try {
        await run(pool, 'INSERT INTO teachers (id, world_id, email, email_key, password_hash, display_name) VALUES ($1, $2, $3, $4, $5, $6)', [
          id,
          DEFAULT_WORLD,
          email,
          emailKey(email),
          await hashPassword(password),
          displayName,
        ]);
      } catch (error) {
        throw isUniqueViolation(error) ? emailTaken() : error;
      }
      const created: TeacherBody = { id, email, displayName };
      return reply(201, created, { 'Set-Cookie': sessionCookie(await createAuthSession('teacher', id)) });
    },
  },
  {
    method: 'POST',
    path: '/api/sign-in',
    handler: async (ctx) => {
      const body = await ctx.json();
      const email = textOf(body.email) ?? '';
      const password = textOf(body.password) ?? '';
      const teacher = await one<TeacherRow>(pool, 'SELECT id, email, display_name, password_hash FROM teachers WHERE email_key = $1', [emailKey(email)]);
      if (!teacher || !(await passwordMatches(password, teacher.password_hash))) {
        throw new Refusal(401, 'Email or password is wrong.');
      }
      const signedIn: TeacherBody = { id: teacher.id, email: teacher.email, displayName: teacher.display_name };
      return reply(200, signedIn, { 'Set-Cookie': sessionCookie(await createAuthSession('teacher', teacher.id)) });
    },
  },
  {
    method: 'POST',
    path: '/api/sign-out',
    handler: async (ctx) => {
      const token = cookieOf(ctx.req.headers, SESSION_COOKIE);
      if (token) await run(pool, 'DELETE FROM auth_sessions WHERE token = $1', [token]);
      return reply(204, undefined, { 'Set-Cookie': sessionCookie('', 0) });
    },
  },
  {
    method: 'GET',
    path: '/api/me',
    handler: async (ctx) => {
      const caller = await authenticate(ctx.req);
      const me: MeBody =
        caller.kind === 'teacher'
          ? { role: 'teacher', id: caller.id, email: caller.email, displayName: caller.displayName }
          : { role: 'learner', id: caller.id, displayName: caller.displayName };
      return reply(200, me);
    },
  },
];

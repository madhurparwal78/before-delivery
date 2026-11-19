import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { now } from './clock.js';
import { maybeRow, pool, type Db } from './db.js';
import { unauthenticated } from './errors.js';

interface SessionMember {
  id: string;
  handle: string;
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    member?: SessionMember;
  }
}

const SESSION_COOKIE = 'pw_session';

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${(await derive(password, salt)).toString('hex')}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const expected = Buffer.from(key, 'hex');
  return timingSafeEqual(await derive(password, Buffer.from(salt, 'hex')), expected);
}

export async function createSession(db: Db, memberId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO sessions (token, member_id, created_at) VALUES ($1, $2, $3)', [token, memberId, now()]);
  return token;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`;
}

export const clearedSessionCookie = `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

export function sessionToken(request: FastifyRequest): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) return value.join('=');
  }
  return undefined;
}

/** preHandler for every member route. */
export async function requireMember(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = sessionToken(request);
  const member = token
    ? await maybeRow<SessionMember>(
        pool,
        `SELECT m.id, m.handle, m.name FROM sessions s JOIN members m ON m.id = s.member_id
          WHERE s.token = $1 AND m.confirmed`,
        [token],
      )
    : undefined;
  if (!member) throw unauthenticated();
  request.member = member;
}

export function memberOf(request: FastifyRequest): SessionMember {
  return request.member as SessionMember;
}

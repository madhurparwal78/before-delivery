import { db, transact } from '../db.js';
import { ApiError } from '../http/errors.js';
import { json, type Actor, type RouteContext, type RouteResult } from '../http/context.js';
import { route, type Route } from '../http/router.js';
import { newSessionId, verifyPassword } from '../ids.js';
import { bodyString } from '../http/context.js';
import type { Organisation, Role, SessionUser } from '../../shared/types.js';

export const SESSION_COOKIE = 'relay_session';

interface PersonRow {
  id: string;
  role: Role;
  display_name: string;
  full_name: string;
  email: string;
  password_hash: string;
  organisation_id: string | null;
  organisation_name: string | null;
  organisation_code: string | null;
}

const PERSON_COLUMNS = `p.id, p.role, p.display_name, p.full_name, p.email, p.password_hash,
  p.organisation_id, o.name AS organisation_name, o.code AS organisation_code`;

function organisationOf(row: PersonRow): Organisation | null {
  if (row.organisation_id === null || row.organisation_name === null || row.organisation_code === null) {
    return null;
  }
  return { id: row.organisation_id, name: row.organisation_name, code: row.organisation_code };
}

function actorOf(row: PersonRow): Actor {
  return {
    id: row.id,
    role: row.role,
    display_name: row.display_name,
    full_name: row.full_name,
    email: row.email,
    organisation: organisationOf(row),
  };
}

function userOf(actor: Actor): SessionUser {
  return {
    id: actor.id,
    role: actor.role,
    display_name: actor.display_name,
    email: actor.email,
    organisation: actor.organisation,
  };
}

export async function actorForSession(sessionId: string): Promise<Actor | null> {
  const result = await db.query<PersonRow>(
    `SELECT ${PERSON_COLUMNS} FROM sessions s
       JOIN people p ON p.id = s.person_id
       LEFT JOIN organisations o ON o.id = p.organisation_id
      WHERE s.id = $1`,
    [sessionId],
  );
  const row = result.rows[0];
  return row === undefined ? null : actorOf(row);
}

async function signIn(ctx: RouteContext): Promise<RouteResult> {
  ctx.requireSameOrigin();
  const body = ctx.body();
  const email = (bodyString(body, 'email') ?? '').trim().toLowerCase();
  const password = bodyString(body, 'password') ?? '';
  const result = await db.query<PersonRow>(
    `SELECT ${PERSON_COLUMNS} FROM people p
       LEFT JOIN organisations o ON o.id = p.organisation_id
      WHERE lower(p.email) = $1`,
    [email],
  );
  const row = result.rows[0];
  if (row === undefined || !verifyPassword(password, row.password_hash)) {
    throw new ApiError('invalid_credentials');
  }
  const sessionId = newSessionId();
  await transact(async (client) => {
    await client.query(`INSERT INTO sessions (id, person_id) VALUES ($1, $2)`, [sessionId, row.id]);
  });
  ctx.setCookie(`${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`);
  return json({ user: userOf(actorOf(row)) });
}

async function currentUser(ctx: RouteContext): Promise<RouteResult> {
  return json({ user: userOf(ctx.requireActor()) });
}

async function signOut(ctx: RouteContext): Promise<RouteResult> {
  ctx.requireActor();
  ctx.requireSameOrigin();
  const cookie = ctx.header('cookie') ?? '';
  const match = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(cookie);
  if (match !== null) {
    await transact(async (client) => {
      await client.query(`DELETE FROM sessions WHERE id = $1`, [match[1] as string]);
    });
  }
  ctx.setCookie(`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return { kind: 'empty', status: 204 };
}

export const sessionRoutes: Route[] = [
  route('POST', '/api/session', signIn),
  route('GET', '/api/me', currentUser),
  route('DELETE', '/api/session', signOut),
];

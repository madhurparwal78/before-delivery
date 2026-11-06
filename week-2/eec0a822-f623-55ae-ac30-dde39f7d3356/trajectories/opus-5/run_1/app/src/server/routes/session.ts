import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { query, queryOne } from '../db.js';
import { ApiError } from '../http/errors.js';
import { readJsonBody, type Ctx, type Reply, type Router } from '../http/router.js';
import { loadActor, SESSION_COOKIE, type Actor } from '../auth.js';
import { verifyPassword } from '../services/passwords.js';
import { HOME_PATHS, type Role } from '../../shared/roles.js';
import { json, noContent } from './helpers.js';

function memberJson(actor: Actor): Record<string, unknown> {
  return {
    member: {
      id: actor.id,
      name: actor.name,
      role: actor.role,
      workspaceSlug: actor.workspaceSlug,
      workspaceName: actor.workspaceName,
    },
    homePath: `/w/${actor.workspaceSlug}/${HOME_PATHS[actor.role]}`,
  };
}

interface MemberRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly password_hash: string;
  readonly role: Role;
  readonly workspace_slug: string;
  readonly workspace_name: string;
}

async function signIn(ctx: Ctx): Promise<Reply> {
  const body = readJsonBody(ctx);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const member = await queryOne<MemberRow>(
    `SELECT m.id, m.name, m.email, m.password_hash, m.role, w.slug AS workspace_slug, w.name AS workspace_name
       FROM members m JOIN workspaces w ON w.id = m.workspace_id
      WHERE lower(m.email) = $1`,
    [email],
  );
  const refusal = new ApiError(401, { error: 'invalid_credentials' });
  if (member === null) throw refusal;
  if (!(await verifyPassword(password, member.password_hash))) throw refusal;
  const sessionId = randomUUID();
  await query('INSERT INTO sessions (id, member_id, created_at) VALUES ($1, $2, $3)', [
    sessionId,
    member.id,
    ctx.now,
  ]);
  ctx.setCookies.push(
    `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${config.timers.sessionSeconds}`,
  );
  return json(200, {
    member: {
      id: member.id,
      name: member.name,
      role: member.role,
      workspaceSlug: member.workspace_slug,
      workspaceName: member.workspace_name,
    },
    homePath: `/w/${member.workspace_slug}/${HOME_PATHS[member.role]}`,
  });
}

async function readSession(ctx: Ctx): Promise<Reply> {
  return json(200, memberJson(await loadActor(ctx)));
}

async function signOut(ctx: Ctx): Promise<Reply> {
  const actor = await loadActor(ctx);
  await query('UPDATE sessions SET signed_out_at = $2 WHERE id = $1', [actor.sessionId, ctx.now]);
  ctx.setCookies.push(`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  return noContent();
}

export function registerSessionRoutes(router: Router): void {
  router.add('/api/session', { POST: signIn, GET: readSession, DELETE: signOut });
}

import { IncomingMessage, ServerResponse } from 'node:http';
import { one, query } from '../db.js';
import { Capability, ProjectRole, roleAllows } from '../domain/roles.js';
import { PersonRow } from '../domain/shapes.js';
import { forbidden, notFound, unauthenticated } from './errors.js';

export interface SessionUser extends PersonRow {
  password_hash: string;
}

export interface Reply {
  status: number;
  body?: unknown;
  bytes?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
}

export interface Ctx {
  request: IncomingMessage;
  response: ServerResponse;
  method: string;
  url: URL;
  params: Record<string, string>;
  raw: Buffer;
  body: Record<string, unknown>;
  user: SessionUser | null;
  sessionId: string | null;
}

export const SESSION_COOKIE = 'mg_session';

export function readCookie(request: IncomingMessage, name: string): string | null {
  const header = request.headers.cookie;
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1));
  }
  return null;
}

export async function loadSessionUser(sessionId: string): Promise<SessionUser | null> {
  return one<SessionUser>(
    `select u.* from sessions s join users u on u.id = s.user_id where s.id = $1`,
    [sessionId],
  );
}

export function requireUser(ctx: Ctx): SessionUser {
  if (ctx.user === null) throw unauthenticated();
  return ctx.user;
}

export interface ProjectRow {
  id: string;
  workspace_id: string;
  title: string;
  template: string;
  project_revision: number;
}

export interface ProjectAccess {
  project: ProjectRow;
  role: ProjectRole;
  user: SessionUser;
}

/** Reads the caller's current membership from the database on every request. */
export async function requireProject(ctx: Ctx, capability: Capability): Promise<ProjectAccess> {
  const user = requireUser(ctx);
  const projectId = ctx.params.pid;
  const rows = await query<ProjectRow & { role: ProjectRole }>(
    `select p.*, m.role from projects p
       join memberships m on m.project_id = p.id and m.user_id = $2
      where p.id = $1`,
    [projectId, user.id],
  );
  if (rows.length === 0) throw notFound();
  const row = rows[0];
  if (!roleAllows(row.role, capability)) throw forbidden();
  return {
    project: {
      id: row.id,
      workspace_id: row.workspace_id,
      title: row.title,
      template: row.template,
      project_revision: row.project_revision,
    },
    role: row.role,
    user,
  };
}

import { queryOne } from '../db/pool';
import { ApiError, failure } from '../http/errors';
import { passwordMatches } from '../domain/password';
import { clearedSessionCookie, endSession, sessionCookie, startSession } from '../http/session';
import { ALL_STAFF, define, MemberRecord, Registered, Role } from '../http/runtime';
import { asRecord } from '../http/validate';
import { ERROR_COPY } from '../../shared/copy';
import { findWorkspace } from '../store/workspace';

export function homeRouteFor(role: Role, slug: string): string {
  return role === 'finance_lead' ? `/w/${slug}/months` : `/w/${slug}/cases`;
}

function memberBody(member: MemberRecord): Record<string, unknown> {
  return { id: member.id, name: member.name, email: member.email, role: member.role };
}

async function sessionBody(member: MemberRecord): Promise<Record<string, unknown>> {
  const workspace = await findWorkspace(member.workspaceSlug);
  if (workspace === null) throw failure('access_removed');
  return {
    member: memberBody(member),
    workspace: { slug: workspace.slug, name: workspace.name },
    home: homeRouteFor(member.role, workspace.slug),
  };
}

interface MemberSignInRow {
  id: string;
  workspace_slug: string;
  name: string;
  email: string;
  role: string;
  password_hash: string;
}

export const sessionRoutes: readonly Registered[] = [
  define({
    kind: 'public',
    method: 'POST',
    path: '/api/session',
    content: 'json',
    handler: async (context) => {
      const body = asRecord(context.body);
      const email = typeof body.email === 'string' ? body.email : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const refusal = new ApiError(401, 'sign_in_failed', ERROR_COPY.sign_in_failed);
      const row = await queryOne<MemberSignInRow>(
        'SELECT * FROM members WHERE lower(email) = lower($1)',
        [email],
      );
      if (row === null) throw refusal;
      if (!(await passwordMatches(password, row.password_hash))) throw refusal;
      const member: MemberRecord = {
        id: row.id,
        workspaceSlug: row.workspace_slug,
        name: row.name,
        email: row.email,
        role: row.role as Role,
      };
      const id = await startSession(member, context.now);
      return { status: 200, json: await sessionBody(member), setCookie: sessionCookie(id) };
    },
  }),
  define({
    kind: 'staff',
    method: 'GET',
    path: '/api/session',
    roles: ALL_STAFF,
    handler: async (context) => ({ status: 200, json: await sessionBody(context.member) }),
  }),
  define({
    kind: 'staff',
    method: 'DELETE',
    path: '/api/session',
    roles: ALL_STAFF,
    handler: async (context) => {
      await endSession(context.sessionId);
      return { status: 204, setCookie: clearedSessionCookie() };
    },
  }),
];

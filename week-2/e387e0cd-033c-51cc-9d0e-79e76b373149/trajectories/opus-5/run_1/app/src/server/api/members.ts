import { toInstant } from '../../shared/businesstime';
import { query, queryOne } from '../db/pool';
import { newId } from '../db/seed';
import { hashPassword } from '../domain/password';
import { failure } from '../http/errors';
import { define, Registered, Role, ROLES } from '../http/runtime';
import { codePoints, FieldCheck, readText } from '../http/validate';

interface MemberRow {
  id: string;
  workspace_slug: string;
  name: string;
  email: string;
  role: string;
  created_at: Date;
}

const OFFICER: readonly Role[] = ['compliance_officer'];
const EMAIL_SHAPE = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;

function memberBody(row: MemberRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: toInstant(row.created_at),
  };
}

async function loadMember(workspaceSlug: string, id: string): Promise<MemberRow> {
  const row = await queryOne<MemberRow>(
    'SELECT * FROM members WHERE workspace_slug = $1 AND id = $2',
    [workspaceSlug, id],
  );
  if (row === null) throw failure('not_found');
  return row;
}

export const memberRoutes: readonly Registered[] = [
  define({
    kind: 'staff',
    method: 'GET',
    path: '/api/w/:slug/members',
    roles: OFFICER,
    handler: async (context) => {
      const rows = await query<MemberRow>(
        'SELECT * FROM members WHERE workspace_slug = $1 ORDER BY created_at, name',
        [context.workspace.slug],
      );
      return { status: 200, json: { members: rows.map(memberBody) } };
    },
  }),
  define({
    kind: 'staff',
    method: 'GET',
    path: '/api/w/:slug/members/:memberId',
    roles: OFFICER,
    load: (context) => loadMember(context.workspace.slug, context.params.memberId),
    handler: async (context) => ({ status: 200, json: { member: memberBody(context.loaded) } }),
  }),
  define({
    kind: 'staff',
    method: 'POST',
    path: '/api/w/:slug/members',
    roles: OFFICER,
    content: 'json',
    handler: async (context) => {
      const name = readText(context.body, 'name');
      const email = readText(context.body, 'email');
      const role = readText(context.body, 'role');
      const password = readText(context.body, 'password');
      const taken =
        email === null
          ? null
          : await queryOne<{ id: string }>('SELECT id FROM members WHERE lower(email) = lower($1)', [
              email,
            ]);
      if (taken !== null) throw failure('email_taken');
      const check = new FieldCheck();
      if (name === null || codePoints(name) < 1 || codePoints(name) > 120) {
        check.add('name', 'Enter a name of 1 to 120 characters.');
      }
      if (email === null || !EMAIL_SHAPE.test(email)) check.add('email', "Enter the member's email.");
      if (role === null || !ROLES.includes(role as Role)) check.add('role', 'Choose a role.');
      if (password === null || password.length < 12) {
        check.add('password', 'Use a starting password of at least 12 characters.');
      }
      check.settle();
      const id = newId('mem');
      await query(
        `INSERT INTO members (id, workspace_slug, name, email, role, password_hash, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          id,
          context.workspace.slug,
          name,
          email,
          role,
          await hashPassword(password as string),
          context.now,
        ],
      );
      return { status: 201, json: { member: memberBody(await loadMember(context.workspace.slug, id)) } };
    },
  }),
  define({
    kind: 'staff',
    method: 'PATCH',
    path: '/api/w/:slug/members/:memberId',
    roles: OFFICER,
    content: 'json',
    load: (context) => loadMember(context.workspace.slug, context.params.memberId),
    handler: async (context) => {
      if (context.loaded.id === context.member.id) throw failure('own_membership');
      const role = readText(context.body, 'role');
      const check = new FieldCheck();
      if (role === null || !ROLES.includes(role as Role)) check.add('role', 'Choose a role.');
      check.settle();
      await query('UPDATE members SET role = $2 WHERE id = $1', [context.loaded.id, role]);
      return {
        status: 200,
        json: { member: memberBody(await loadMember(context.workspace.slug, context.loaded.id)) },
      };
    },
  }),
  define({
    kind: 'staff',
    method: 'DELETE',
    path: '/api/w/:slug/members/:memberId',
    roles: OFFICER,
    load: (context) => loadMember(context.workspace.slug, context.params.memberId),
    handler: async (context) => {
      if (context.loaded.id === context.member.id) throw failure('own_membership');
      await query("UPDATE sessions SET ended_reason = 'access_removed' WHERE member_id = $1", [
        context.loaded.id,
      ]);
      await query('DELETE FROM members WHERE id = $1', [context.loaded.id]);
      return { status: 204 };
    },
  }),
];

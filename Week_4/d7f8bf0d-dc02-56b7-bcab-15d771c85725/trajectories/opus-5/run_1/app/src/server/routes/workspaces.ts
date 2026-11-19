import type { Role, StandardsProfile } from '../../shared/protocol.js';
import { pool, tx } from '../db/pool.js';
import { newId } from '../domain/hash.js';
import { parseStandards } from '../domain/standards.js';
import { errors } from '../errors.js';
import type { Route } from '../router.js';
import { hashPassword } from '../services/auth.js';
import { createWorkspace } from '../services/workspaceFactory.js';

const ROLES = ['manager', 'member', 'operator'] as const;

async function standardsOf(workspaceId: string): Promise<StandardsProfile & { revision: number }> {
  const { rows } = await pool.query<{ standards: StandardsProfile; revision: number }>(
    `select standards, standards_revision::int as revision from workspaces where id = $1`,
    [workspaceId],
  );
  const row = rows[0];
  if (!row) throw errors.notFound();
  return { ...row.standards, revision: row.revision };
}

export const workspaceRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/workspaces',
    auth: 'user',
    handle: async (ctx) => {
      const { rows } = await pool.query<{ id: string; name: string; role: Role }>(
        `select w.id, w.name, m.role from memberships m join workspaces w on w.id = m.workspace_id
         where m.user_id = $1 order by w.name`,
        [ctx.person.id],
      );
      return { status: 200, body: { workspaces: rows } };
    },
  },
  {
    method: 'POST',
    path: '/api/workspaces',
    auth: 'user',
    capability: 'found',
    handle: async (ctx) =>
      ctx.once(async () => {
        const name = ctx.text('name', 120);
        const template = ctx.choice('template', ['reference', 'empty'] as const);
        const created = await tx((client) => createWorkspace(client, name, template, ctx.person.id));
        return { status: 201, body: created };
      }),
  },
  {
    method: 'GET',
    path: '/api/workspaces/:workspaceId',
    auth: 'workspace',
    capability: 'read',
    handle: async (ctx) => {
      const { rows } = await pool.query<{ name: string; standards: StandardsProfile }>(
        `select name, standards from workspaces where id = $1`,
        [ctx.workspaceId],
      );
      const workspace = rows[0];
      if (!workspace) throw errors.notFound();
      const counts = await pool.query<{ members: string; layouts: string; sessions: string }>(
        `select
           (select count(*) from memberships where workspace_id = $1) as members,
           (select count(*) from layouts where workspace_id = $1) as layouts,
           (select count(*) from sessions where workspace_id = $1) as sessions`,
        [ctx.workspaceId],
      );
      const row = counts.rows[0];
      return {
        status: 200,
        body: {
          id: ctx.workspaceId,
          name: workspace.name,
          role: ctx.membership?.role,
          standards: workspace.standards,
          counts: {
            members: Number(row.members),
            layouts: Number(row.layouts),
            sessions: Number(row.sessions),
          },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/workspaces/:workspaceId/members',
    auth: 'workspace',
    capability: 'read',
    handle: async (ctx) => {
      const { rows } = await pool.query(
        `select m.user_id, u.display_name, u.email, m.role, m.revision::int as revision
         from memberships m join users u on u.id = m.user_id
         where m.workspace_id = $1 order by u.display_name`,
        [ctx.workspaceId],
      );
      return { status: 200, body: { members: rows } };
    },
  },
  {
    method: 'POST',
    path: '/api/workspaces/:workspaceId/members',
    auth: 'workspace',
    capability: 'manage',
    handle: async (ctx) =>
      ctx.once(async () => {
        const displayName = ctx.text('display_name', 120);
        const email = ctx.text('email', 320);
        const password = ctx.text('password', 200);
        const role = ctx.choice('role', ROLES);

        return tx(async (client) => {
          const existing = await client.query<{ id: string }>(
            `select id from users where lower(email) = lower($1)`,
            [email],
          );
          let userId = existing.rows[0]?.id;
          if (userId) {
            const member = await client.query(
              `select 1 from memberships where workspace_id = $1 and user_id = $2`,
              [ctx.workspaceId, userId],
            );
            if (member.rowCount && member.rowCount > 0) throw errors.memberExists();
          } else {
            userId = newId('u');
            await client.query(
              `insert into users (id, email, display_name, password_hash, walkthrough_done)
               values ($1, $2, $3, $4, false)`,
              [userId, email, displayName, await hashPassword(password)],
            );
          }
          await client.query(
            `insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)`,
            [ctx.workspaceId, userId, role],
          );
          return {
            status: 201,
            body: {
              member: {
                user_id: userId,
                display_name: displayName,
                email,
                role,
                revision: 0,
              },
            },
          };
        });
      }),
  },
  {
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/members/:userId',
    auth: 'workspace',
    capability: 'manage',
    handle: async (ctx) => {
      const { rows } = await pool.query<{ revision: number }>(
        `select revision::int as revision from memberships where workspace_id = $1 and user_id = $2`,
        [ctx.workspaceId, ctx.params['userId']],
      );
      const current = rows[0];
      if (!current) throw errors.notFound();
      return ctx.once(async () => {
        ctx.requireRevision(current.revision);
        const role = ctx.choice('role', ROLES);
        const updated = await pool.query(
          `update memberships set role = $3, revision = revision + 1
           where workspace_id = $1 and user_id = $2
           returning user_id, role, revision::int as revision`,
          [ctx.workspaceId, ctx.params['userId'], role],
        );
        const member = updated.rows[0];
        const person = await pool.query<{ display_name: string; email: string }>(
          `select display_name, email from users where id = $1`,
          [ctx.params['userId']],
        );
        return {
          status: 200,
          body: { member: { ...member, ...person.rows[0] } },
        };
      });
    },
  },
  {
    method: 'GET',
    path: '/api/workspaces/:workspaceId/standards',
    auth: 'workspace',
    capability: 'read',
    handle: async (ctx) => ({ status: 200, body: await standardsOf(ctx.workspaceId) }),
  },
  {
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/standards',
    auth: 'workspace',
    capability: 'manage',
    handle: async (ctx) => {
      const current = await standardsOf(ctx.workspaceId);
      return ctx.once(async () => {
        ctx.requireRevision(current.revision);
        const profile = parseStandards(ctx.body);
        if (!profile) throw errors.invalidFields();
        const { rows } = await pool.query<{ revision: number }>(
          `update workspaces set standards = $2, standards_revision = standards_revision + 1
           where id = $1 returning standards_revision::int as revision`,
          [ctx.workspaceId, JSON.stringify(profile)],
        );
        return { status: 200, body: { ...profile, revision: rows[0].revision } };
      });
    },
  },
];

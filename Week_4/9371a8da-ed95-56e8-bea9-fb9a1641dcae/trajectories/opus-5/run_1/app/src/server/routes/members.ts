import { query, transaction, Tx } from '../db.js';
import { isProjectRole } from '../domain/roles.js';
import { Member, personView, PersonRow } from '../domain/shapes.js';
import { allowedKeys, invalidRole } from '../domain/validation.js';
import { Ctx, Reply, requireProject } from '../http/context.js';
import { conflict, notFound } from '../http/errors.js';
import { Route } from '../http/router.js';

interface MemberRow extends PersonRow {
  role: Member['role'];
}

async function memberRows(projectId: string): Promise<MemberRow[]> {
  return query<MemberRow>(
    `select u.id, u.email, u.display_name, u.handle, m.role
       from memberships m join users u on u.id = m.user_id
      where m.project_id = $1
      order by u.display_name`,
    [projectId],
  );
}

function memberShape(row: MemberRow, asOwner: boolean): Member {
  return {
    user: asOwner ? personView.user(row) : personView.person(row),
    role: row.role,
  };
}

async function listMembers(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'read');
  const rows = await memberRows(access.project.id);
  return {
    status: 200,
    body: { members: rows.map((row) => memberShape(row, access.role === 'owner')) },
  };
}

/**
 * A request that passed the role check but whose caller has since stopped being
 * an owner changes nothing, so a project always keeps at least one owner.
 */
async function stillOwner(tx: Tx, projectId: string, userId: string): Promise<boolean> {
  const row = await tx.one(
    `select 1 from memberships where project_id = $1 and user_id = $2 and role = 'owner'`,
    [projectId, userId],
  );
  return row !== null;
}

async function ownerCount(tx: Tx, projectId: string): Promise<number> {
  const row = await tx.one<{ count: string }>(
    `select count(*)::text as count from memberships
      where project_id = $1 and role = 'owner'`,
    [projectId],
  );
  return Number((row as { count: string }).count);
}

async function changeRole(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'administer');
  const target = ctx.params.uid;
  allowedKeys(ctx.body, ['role']);
  const role = ctx.body.role;
  if (!isProjectRole(role)) throw invalidRole();

  return transaction(async (tx) => {
    await tx.lockProject(access.project.id);
    if (!(await stillOwner(tx, access.project.id, access.user.id))) throw conflict('last_owner');
    const current = await tx.one<{ role: string }>(
      `select role from memberships where project_id = $1 and user_id = $2`,
      [access.project.id, target],
    );
    if (current === null) throw notFound();
    if (current.role === 'owner' && role !== 'owner') {
      if ((await ownerCount(tx, access.project.id)) <= 1) throw conflict('last_owner');
    }
    await tx.query(
      `update memberships set role = $3 where project_id = $1 and user_id = $2`,
      [access.project.id, target, role],
    );
    const rows = await tx.query<MemberRow>(
      `select u.id, u.email, u.display_name, u.handle, m.role
         from memberships m join users u on u.id = m.user_id
        where m.project_id = $1 and m.user_id = $2`,
      [access.project.id, target],
    );
    return { status: 200, body: { member: memberShape(rows[0], true) } };
  });
}

async function removeMember(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'administer');
  const target = ctx.params.uid;

  return transaction(async (tx) => {
    await tx.lockProject(access.project.id);
    if (!(await stillOwner(tx, access.project.id, access.user.id))) throw conflict('last_owner');
    const current = await tx.one<{ role: string }>(
      `select role from memberships where project_id = $1 and user_id = $2`,
      [access.project.id, target],
    );
    if (current === null) throw notFound();
    if (current.role === 'owner' && (await ownerCount(tx, access.project.id)) <= 1) {
      throw conflict('last_owner');
    }
    await tx.query(`delete from memberships where project_id = $1 and user_id = $2`, [
      access.project.id,
      target,
    ]);
    return { status: 204 };
  });
}

export const memberRoutes: Route[] = [
  { method: 'GET', path: '/api/projects/:pid/members', keys: [], handler: listMembers },
  {
    method: 'PATCH',
    path: '/api/projects/:pid/members/:uid',
    keys: ['role'],
    handler: changeRole,
  },
  { method: 'DELETE', path: '/api/projects/:pid/members/:uid', keys: [], handler: removeMember },
];

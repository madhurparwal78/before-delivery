import { Router } from 'express';
import {
  alreadyInvited,
  alreadyMember,
  invalidField,
  invitationClosed,
  nameTaken,
  notFound,
  ownerRoleFixed,
} from '../../shared/errors';
import { Role, projectAccess, requireOwner, requireUser } from '../access';
import { newId } from '../collectionStore';
import { query, queryOne, withTransaction } from '../db';
import { body, handler } from '../httpUtil';
import { sendInvitation } from '../mail';

const COLLECTION_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readCollectionName(value: unknown, field: string): string {
  if (typeof value !== 'string' || !COLLECTION_NAME.test(value)) throw invalidField(field);
  return value;
}

function readRole(value: unknown): 'editor' | 'reader' {
  if (value !== 'editor' && value !== 'reader') throw invalidField('role');
  return value;
}

export const projectRoutes = Router();

projectRoutes.get(
  '/projects',
  handler(async (req, res) => {
    const user = await requireUser(req);
    const rows = await query<{ id: string; name: string; role: string }>(
      `select projects.id, projects.name, memberships.role
       from projects join memberships on memberships.project_id = projects.id
       where memberships.user_id = $1
       order by projects.name collate "C" asc`,
      [user.id],
    );
    res.json({ projects: rows });
  }),
);

projectRoutes.post(
  '/projects',
  handler(async (req, res) => {
    const user = await requireUser(req);
    const fields = body(req);
    const name = fields['name'];
    if (typeof name !== 'string' || name.length < 1 || name.length > 80) throw invalidField('name');
    const collectionName = readCollectionName(fields['collection'], 'collection');
    const taken = await queryOne('select 1 from projects where owner_id = $1 and name = $2', [user.id, name]);
    if (taken) throw nameTaken();
    const projectId = newId();
    const collectionId = newId();
    await withTransaction(async (client) => {
      await client.query('insert into projects (id, name, owner_id) values ($1, $2, $3)', [projectId, name, user.id]);
      await client.query('insert into memberships (project_id, user_id, role) values ($1, $2, $3)', [
        projectId,
        user.id,
        'owner',
      ]);
      await client.query('insert into collections (id, project_id, name) values ($1, $2, $3)', [
        collectionId,
        projectId,
        collectionName,
      ]);
    });
    res.status(201).json({
      project: { id: projectId, name },
      collection: { id: collectionId, name: collectionName, count: 0 },
    });
  }),
);

projectRoutes.get(
  '/projects/:pid',
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await projectAccess(user.id, req.params.pid);
    const owner = await queryOne<{ email: string; name: string }>('select email, name from users where id = $1', [
      access.project.owner_id,
    ]);
    res.json({
      id: access.project.id,
      name: access.project.name,
      role: access.role,
      owner: owner ?? { email: '', name: '' },
    });
  }),
);

projectRoutes.delete(
  '/projects/:pid',
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await projectAccess(user.id, req.params.pid);
    requireOwner(access.role);
    await query('delete from projects where id = $1', [access.project.id]);
    res.status(204).end();
  }),
);

projectRoutes.get(
  '/projects/:pid/members',
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await projectAccess(user.id, req.params.pid);
    const members = await query<{ user_id: string; email: string; name: string; role: string }>(
      `select users.id as user_id, users.email, users.name, memberships.role
       from memberships join users on users.id = memberships.user_id
       where memberships.project_id = $1
       order by (memberships.role = 'owner') desc, users.email collate "C" asc`,
      [access.project.id],
    );
    const invitations =
      access.role === 'owner'
        ? await query<{ id: string; email: string; role: string; state: string }>(
            `select id, email, role, state from invitations
             where project_id = $1 and state = 'pending'
             order by email collate "C" asc`,
            [access.project.id],
          )
        : [];
    res.json({ members, invitations });
  }),
);

projectRoutes.patch(
  '/projects/:pid/members/:uid',
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await projectAccess(user.id, req.params.pid);
    requireOwner(access.role);
    if (!UUID.test(req.params.uid)) throw notFound();
    const member = await queryOne<{ role: string }>(
      'select role from memberships where project_id = $1 and user_id = $2',
      [access.project.id, req.params.uid],
    );
    if (!member) throw notFound();
    if (member.role === 'owner') throw ownerRoleFixed();
    const role = readRole(body(req)['role']);
    await query('update memberships set role = $3 where project_id = $1 and user_id = $2', [
      access.project.id,
      req.params.uid,
      role,
    ]);
    const updated = await queryOne<{ user_id: string; email: string; name: string; role: string }>(
      `select users.id as user_id, users.email, users.name, memberships.role
       from memberships join users on users.id = memberships.user_id
       where memberships.project_id = $1 and memberships.user_id = $2`,
      [access.project.id, req.params.uid],
    );
    res.json(updated);
  }),
);

projectRoutes.delete(
  '/projects/:pid/members/:uid',
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await projectAccess(user.id, req.params.pid);
    requireOwner(access.role);
    if (!UUID.test(req.params.uid)) throw notFound();
    const member = await queryOne<{ role: string }>(
      'select role from memberships where project_id = $1 and user_id = $2',
      [access.project.id, req.params.uid],
    );
    if (!member) throw notFound();
    if (member.role === 'owner') throw ownerRoleFixed();
    await query('delete from memberships where project_id = $1 and user_id = $2', [
      access.project.id,
      req.params.uid,
    ]);
    res.status(204).end();
  }),
);

projectRoutes.post(
  '/projects/:pid/invitations',
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await projectAccess(user.id, req.params.pid);
    requireOwner(access.role);
    const fields = body(req);
    const rawEmail = fields['email'];
    if (typeof rawEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail.trim())) {
      throw invalidField('email');
    }
    const email = rawEmail.trim().toLowerCase();
    const role = readRole(fields['role']);
    const member = await queryOne(
      `select 1 from memberships join users on users.id = memberships.user_id
       where memberships.project_id = $1 and users.email = $2`,
      [access.project.id, email],
    );
    if (member) throw alreadyMember();
    const pending = await queryOne(
      "select 1 from invitations where project_id = $1 and email = $2 and state = 'pending'",
      [access.project.id, email],
    );
    if (pending) throw alreadyInvited();
    const id = newId();
    await query(
      "insert into invitations (id, project_id, email, role, state, inviter_id) values ($1, $2, $3, $4, 'pending', $5)",
      [id, access.project.id, email, role, user.id],
    );
    await sendInvitation(email, user.name, access.project.name, role);
    res.status(201).json({ invitation: { id, email, role, state: 'pending' } });
  }),
);

projectRoutes.delete(
  '/projects/:pid/invitations/:iid',
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await projectAccess(user.id, req.params.pid);
    requireOwner(access.role);
    if (!UUID.test(req.params.iid)) throw notFound();
    const invitation = await queryOne<{ id: string; email: string; role: string; state: string }>(
      'select id, email, role, state from invitations where id = $1 and project_id = $2',
      [req.params.iid, access.project.id],
    );
    if (!invitation) throw notFound();
    if (invitation.state !== 'pending') throw invitationClosed();
    await query("update invitations set state = 'revoked' where id = $1", [invitation.id]);
    res.json({ invitation: { ...invitation, state: 'revoked' } });
  }),
);

export const invitationRoutes = Router();

invitationRoutes.get(
  '/invitations',
  handler(async (req, res) => {
    const user = await requireUser(req);
    const rows = await query<{
      id: string;
      project_id: string;
      project_name: string;
      role: string;
      inviter_name: string;
    }>(
      `select invitations.id, projects.id as project_id, projects.name as project_name,
              invitations.role, users.name as inviter_name
       from invitations
       join projects on projects.id = invitations.project_id
       join users on users.id = invitations.inviter_id
       where invitations.email = $1 and invitations.state = 'pending'
       order by projects.name collate "C" asc`,
      [user.email],
    );
    res.json({
      invitations: rows.map((row) => ({
        id: row.id,
        project: { id: row.project_id, name: row.project_name },
        role: row.role,
        inviter: { name: row.inviter_name },
      })),
    });
  }),
);

invitationRoutes.post(
  '/invitations/:iid/accept',
  handler(async (req, res) => {
    const user = await requireUser(req);
    if (!UUID.test(req.params.iid)) throw notFound();
    const invitation = await queryOne<{ id: string; project_id: string; email: string; role: string; state: string }>(
      'select id, project_id, email, role, state from invitations where id = $1',
      [req.params.iid],
    );
    if (!invitation || invitation.email !== user.email) throw notFound();
    if (invitation.state !== 'pending') throw invitationClosed();
    await withTransaction(async (client) => {
      await client.query("update invitations set state = 'accepted' where id = $1", [invitation.id]);
      await client.query(
        `insert into memberships (project_id, user_id, role) values ($1, $2, $3)
         on conflict (project_id, user_id) do update set role = $3`,
        [invitation.project_id, user.id, invitation.role as Role],
      );
    });
    res.json({ project_id: invitation.project_id });
  }),
);

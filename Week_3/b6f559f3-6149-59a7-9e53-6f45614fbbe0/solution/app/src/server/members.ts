/** Members and invites: the owner invites by mail, and accepting the single-use link is the only way in. */
import { createHash } from 'node:crypto';
import { alreadyMember, alreadyPending, MESSAGES, wrongPerson } from '../shared/messages';
import type { InviteInfo, MemberInfo, Role } from '../shared/types';
import { assertActive, openProject, refuseTrashed, requireOwner } from './access';
import { addMs, now } from './clock';
import { config } from './config';
import { query, transaction } from './db';
import { announceMembers, broadcast, dropConnections } from './hub';
import { fail, invalid, json, newId, newToken, noContent, notFound, router, sessionCookie, type Ctx, type Reply } from './http';
import { deliverNow, enqueue, inviteMail, mailState } from './outbox';
import { hashPassword, verifyPassword } from './passwords';
import { createSession } from './sessions';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 10;
const INVITED_ROLES: readonly InviteInfo['role'][] = ['Editor', 'Viewer'];

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

interface InviteRow {
  id: string;
  project_id: string;
  project_name: string;
  email: string;
  role: InviteInfo['role'];
  expires_at: Date;
  accepted_at: Date | null;
}

const inviteInfo = async (row: InviteRow, at: Date): Promise<InviteInfo> => ({
  id: row.id,
  email: row.email,
  role: row.role,
  status: row.accepted_at ? 'accepted' : row.expires_at <= at ? 'expired' : await mailState('invite', row.id, row.project_id),
  expiresAt: row.expires_at.toISOString(),
});

async function listMembers(ctx: Ctx): Promise<Reply> {
  const { project } = await openProject(ctx, ctx.param('id'));
  const members = await query<MemberInfo>(
    `SELECT p.id AS "personId", p.name, p.email, m.role FROM members m JOIN people p ON p.id = m.person_id
     WHERE m.project_id = $1 ORDER BY (m.role = 'Owner') DESC, m.added_at, p.name`,
    [project.id],
  );
  const rows = await query<InviteRow>(
    `SELECT i.id, i.project_id, p.name AS project_name, i.email, i.role, i.expires_at, i.accepted_at
     FROM invites i JOIN projects p ON p.id = i.project_id WHERE i.project_id = $1 ORDER BY i.created_at, i.id`,
    [project.id],
  );
  const at = await now();
  const invites: InviteInfo[] = [];
  for (const row of rows) invites.push(await inviteInfo(row, at));
  return json(200, { members, invites });
}

async function postInvite(ctx: Ctx): Promise<Reply> {
  const { person, project } = await openProject(ctx, ctx.param('id'));
  requireOwner(project, MESSAGES.memberRefusal);
  refuseTrashed(project.status);
  const body = await ctx.jsonObject();
  const email = typeof body['email'] === 'string' ? body['email'].trim().toLowerCase() : '';
  if (!EMAIL.test(email)) invalid('email', MESSAGES.validEmail);
  const role = body['role'] as InviteInfo['role'];
  if (!INVITED_ROLES.includes(role)) invalid('role', MESSAGES.invalidValue);
  const token = newToken();
  const created = await transaction(async (client) => {
    await assertActive(client, project.id);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`invite:${project.id}:${email}`]);
    const at = await now(client);
    const member = await client.query(
      `SELECT 1 FROM members m JOIN people p ON p.id = m.person_id WHERE m.project_id = $1 AND lower(p.email) = $2`,
      [project.id, email],
    );
    if (member.rows.length > 0) invalid('email', alreadyMember(email));
    const pending = await client.query(
      `SELECT 1 FROM invites WHERE project_id = $1 AND email = $2 AND accepted_at IS NULL AND expires_at > $3`,
      [project.id, email, at.toISOString()],
    );
    if (pending.rows.length > 0) invalid('email', alreadyPending(email));
    const id = newId('i');
    const expiresAt = addMs(at, config.inviteTtlHours * 3_600_000);
    await client.query(
      `INSERT INTO invites (id, project_id, email, role, token_hash, invited_by, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, project.id, email, role, hashToken(token), person.id, at.toISOString(), expiresAt.toISOString()],
    );
    const mailIds = await enqueue(client, [
      inviteMail({ inviteId: id, projectId: project.id, projectName: project.name, inviter: person.name, email, role, token, expiresAt }),
    ]);
    return { id, expiresAt, mailIds };
  });
  await deliverNow(created.mailIds);
  announceMembers(project.id);
  const invite: InviteInfo = {
    id: created.id,
    email,
    role,
    status: await mailState('invite', created.id, project.id),
    expiresAt: created.expiresAt.toISOString(),
  };
  return json(201, { invite });
}

async function removeMember(ctx: Ctx): Promise<Reply> {
  const { project } = await openProject(ctx, ctx.param('id'));
  requireOwner(project, MESSAGES.memberRefusal);
  const personId = ctx.param('personId');
  const rows = await query<{ role: Role }>('SELECT role FROM members WHERE project_id = $1 AND person_id = $2', [project.id, personId]);
  const member = rows[0];
  if (!member) return notFound();
  if (member.role === 'Owner') return invalid('personId', MESSAGES.invalidValue);
  const released = await transaction(async (client) => {
    await client.query('DELETE FROM members WHERE project_id = $1 AND person_id = $2', [project.id, personId]);
    return (await client.query<{ layer_id: string }>('DELETE FROM layer_locks WHERE project_id = $1 AND person_id = $2 RETURNING layer_id', [project.id, personId])).rows;
  });
  dropConnections(project.id, personId);
  for (const { layer_id: layerId } of released) broadcast(project.id, { type: 'unlock', layerId });
  announceMembers(project.id);
  return noContent();
}

/** The invite behind a token that is still usable, or 410. */
async function openInvite(token: string): Promise<InviteRow> {
  const rows = await query<InviteRow>(
    `SELECT i.id, i.project_id, p.name AS project_name, i.email, i.role, i.expires_at, i.accepted_at
     FROM invites i JOIN projects p ON p.id = i.project_id WHERE i.token_hash = $1`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row || row.accepted_at || row.expires_at <= (await now())) return fail(410, 'invite_unavailable', MESSAGES.inviteGone);
  return row;
}

const accountExists = async (email: string): Promise<boolean> =>
  (await query('SELECT 1 FROM people WHERE lower(email) = lower($1)', [email])).length > 0;

async function getInvite(ctx: Ctx): Promise<Reply> {
  const invite = await openInvite(ctx.param('token'));
  return json(200, { projectName: invite.project_name, role: invite.role, email: invite.email, accountExists: await accountExists(invite.email) });
}

async function acceptInvite(ctx: Ctx): Promise<Reply> {
  const invite = await openInvite(ctx.param('token'));
  const body = await ctx.jsonObject();
  const signedIn = await ctx.person();
  if (signedIn && signedIn.email.toLowerCase() !== invite.email) return fail(409, 'wrong_person', wrongPerson(invite.email));
  const existing = (await query<{ id: string; password_hash: string }>('SELECT id, password_hash FROM people WHERE lower(email) = lower($1)', [invite.email]))[0];
  let personId = signedIn?.id ?? existing?.id ?? null;
  let newPerson: { name: string; hash: string } | null = null;
  if (!signedIn && existing) {
    const password = body['password'];
    if (typeof password !== 'string' || !(await verifyPassword(password, existing.password_hash))) invalid('password', MESSAGES.badCredentials);
  } else if (!signedIn) {
    const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
    if (name.length === 0) invalid('name', MESSAGES.enterName);
    const password = body['password'];
    if (typeof password !== 'string' || password.length < PASSWORD_MIN) invalid('password', MESSAGES.passwordShort);
    newPerson = { name, hash: await hashPassword(password as string) };
  }
  const token = await transaction(async (client) => {
    const at = await now(client);
    const claimed = await client.query(
      `UPDATE invites SET accepted_at = $2 WHERE id = $1 AND accepted_at IS NULL AND expires_at > $2 RETURNING id`,
      [invite.id, at.toISOString()],
    );
    if (claimed.rows.length === 0) return fail(410, 'invite_unavailable', MESSAGES.inviteGone);
    if (newPerson) {
      personId = newId('u');
      await client.query('INSERT INTO people (id, name, email, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)', [
        personId,
        newPerson.name,
        invite.email,
        newPerson.hash,
        at.toISOString(),
      ]);
    }
    await client.query('UPDATE invites SET accepted_by = $2 WHERE id = $1', [invite.id, personId]);
    await client.query(
      `INSERT INTO members (project_id, person_id, role, added_at) VALUES ($1, $2, $3, $4) ON CONFLICT (project_id, person_id) DO NOTHING`,
      [invite.project_id, personId, invite.role, at.toISOString()],
    );
    return createSession(personId as string, client);
  });
  announceMembers(invite.project_id);
  return json(200, { projectId: invite.project_id, role: invite.role }, { 'Set-Cookie': sessionCookie(token) });
}

export function registerMemberRoutes(): void {
  router.get('/api/projects/:id/members', listMembers);
  router.post('/api/projects/:id/invites', postInvite);
  router.delete('/api/projects/:id/members/:personId', removeMember);
  router.get('/api/invites/:token', getInvite);
  router.post('/api/invites/:token/accept', acceptInvite);
}

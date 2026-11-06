import { randomUUID } from 'node:crypto';
import { query, queryOne } from '../db.js';
import { conflict, notFound } from '../http/errors.js';
import { readJsonBody, type Ctx, type Reply, type Router } from '../http/router.js';
import { actorInWorkspace, requireAction } from '../auth.js';
import { Fields } from '../domain/validate.js';
import { FIELD_ERRORS } from '../../shared/copy.js';
import { hashPassword } from '../services/passwords.js';
import { ROLES, type Role } from '../../shared/roles.js';
import { findYacht } from '../records.js';
import { json, noContent } from './helpers.js';

interface MemberListRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly yacht_slug: string | null;
}

const MEMBER_SELECT = `SELECT m.id, m.name, m.email, m.role, y.slug AS yacht_slug
   FROM members m LEFT JOIN yachts y ON y.id = m.yacht_id`;

function toJson(member: MemberListRow): Record<string, unknown> {
  return {
    id: member.id,
    name: member.name,
    email: member.email,
    role: member.role,
    yachtSlug: member.role === 'crew_member' ? member.yacht_slug : null,
  };
}

async function listMembers(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  requireAction(actor, 'members');
  const members = await query<MemberListRow>(
    `${MEMBER_SELECT} WHERE m.workspace_id = $1 ORDER BY m.name`,
    [actor.workspaceId],
  );
  return json(200, { members: members.map(toJson) });
}

async function resolveYachtId(
  fields: Fields,
  workspaceId: string,
  role: Role,
  value: unknown,
): Promise<string | null> {
  if (role !== 'crew_member') return null;
  if (typeof value !== 'string' || value.trim() === '') {
    fields.fail('yachtSlug', FIELD_ERRORS.crewYacht);
    return null;
  }
  const yacht = await findYacht(workspaceId, value.trim());
  if (yacht === null) throw notFound();
  return yacht.id;
}

async function addMember(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  requireAction(actor, 'members');
  const body = readJsonBody(ctx);
  const fields = new Fields();
  const name = fields.text('name', body.name, 80);
  const email = fields.email('email', body.email);
  const password = fields.password('password', body.password);
  const role = fields.option('role', body.role, ROLES);
  const yachtId = await resolveYachtId(fields, actor.workspaceId, role, body.yachtSlug);
  const existing = await queryOne<{ id: string }>('SELECT id FROM members WHERE lower(email) = $1', [
    email.toLowerCase(),
  ]);
  if (existing !== null) throw conflict('email_in_use');
  fields.throwIfFailed();
  const id = randomUUID();
  await query(
    `INSERT INTO members (id, workspace_id, name, email, password_hash, role, yacht_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, actor.workspaceId, name, email, await hashPassword(password), role, yachtId],
  );
  const created = await queryOne<MemberListRow>(`${MEMBER_SELECT} WHERE m.id = $1`, [id]);
  return json(201, { member: toJson(created as MemberListRow) });
}

async function requireMember(workspaceId: string, memberId: string): Promise<MemberListRow> {
  const member = await queryOne<MemberListRow>(
    `${MEMBER_SELECT} WHERE m.id = $1 AND m.workspace_id = $2`,
    [memberId, workspaceId],
  );
  if (member === null) throw notFound();
  return member;
}

async function changeMember(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const member = await requireMember(actor.workspaceId, ctx.params.memberId);
  requireAction(actor, 'members');
  const body = readJsonBody(ctx);
  const fields = new Fields();
  const role = fields.option('role', body.role, ROLES);
  const yachtId = await resolveYachtId(fields, actor.workspaceId, role, body.yachtSlug);
  if (member.id === actor.id) throw conflict('cannot_change_self');
  fields.throwIfFailed();
  await query('UPDATE members SET role = $2, yacht_id = $3 WHERE id = $1', [
    member.id,
    role,
    yachtId,
  ]);
  const updated = await requireMember(actor.workspaceId, member.id);
  return json(200, { member: toJson(updated) });
}

async function removeMember(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const member = await requireMember(actor.workspaceId, ctx.params.memberId);
  requireAction(actor, 'members');
  if (member.id === actor.id) throw conflict('cannot_remove_self');
  await query('DELETE FROM members WHERE id = $1', [member.id]);
  return noContent();
}

export function registerMemberRoutes(router: Router): void {
  router.add('/api/w/:ws/members', { GET: listMembers, POST: addMember });
  router.add('/api/w/:ws/members/:memberId', { PATCH: changeMember, DELETE: removeMember });
}

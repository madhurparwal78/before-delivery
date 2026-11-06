import type { PoolClient } from '../db';
import { advisoryLock, query, row, rows } from '../db';
import { RateLimited, apiError } from '../errors';
import { isoSecond } from '../format';
import { hashToken, randomId, randomToken } from '../crypto/seal';
import { config } from '../config';
import { nowSecond } from '../http/core';
import type { Role } from './auth';
import { countCharacters } from './text';

export interface MemberRow {
  user_id: string;
  name: string;
  email: string;
  role: string;
}

export async function listMembers(slug: string): Promise<MemberRow[]> {
  return query<MemberRow>(
    `select u.id as user_id, u.name, u.email, m.role from memberships m join users u on u.id = m.user_id
     where m.workspace_slug = $1 order by u.name`,
    [slug],
  );
}

async function ownerCount(client: PoolClient, slug: string): Promise<number> {
  const found = await row<{ count: string }>(
    client,
    "select count(*)::text as count from memberships where workspace_slug = $1 and role = 'owner'",
    [slug],
  );
  return Number(found?.count ?? '0');
}

/** Membership changes are decided one at a time so a workspace always keeps at least one owner. */
export async function changeRole(client: PoolClient, slug: string, userId: string, role: Role): Promise<{ previous: Role; member: MemberRow }> {
  await advisoryLock(client, `members:${slug}`);
  const member = await row<MemberRow>(
    client,
    `select u.id as user_id, u.name, u.email, m.role from memberships m join users u on u.id = m.user_id
     where m.workspace_slug = $1 and m.user_id = $2`,
    [slug, userId],
  );
  if (!member) throw apiError('not_found');
  const previous = member.role as Role;
  if (previous === role) return { previous, member };
  if (previous === 'owner' && (await ownerCount(client, slug)) <= 1) throw apiError('last_owner');
  await client.query('update memberships set role = $3 where workspace_slug = $1 and user_id = $2', [slug, userId, role]);
  return { previous, member: { ...member, role } };
}

export async function removeMember(client: PoolClient, slug: string, userId: string): Promise<MemberRow> {
  await advisoryLock(client, `members:${slug}`);
  const member = await row<MemberRow>(
    client,
    `select u.id as user_id, u.name, u.email, m.role from memberships m join users u on u.id = m.user_id
     where m.workspace_slug = $1 and m.user_id = $2`,
    [slug, userId],
  );
  if (!member) throw apiError('not_found');
  if (member.role === 'owner' && (await ownerCount(client, slug)) <= 1) throw apiError('last_owner');
  await client.query('delete from memberships where workspace_slug = $1 and user_id = $2', [slug, userId]);
  return member;
}

export interface InviteRecord {
  id: string;
  workspace_slug: string;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
  state: string;
}

const inviteColumns = 'id, workspace_slug, email, role, created_at, expires_at, state';

export function inviteState(invite: InviteRecord, at: Date = new Date()): string {
  if (invite.state !== 'pending') return invite.state;
  return at.getTime() >= new Date(invite.expires_at).getTime() ? 'expired' : 'pending';
}

export function inviteJson(invite: InviteRecord, at: Date = new Date()): Record<string, unknown> {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    expires_at: isoSecond(invite.expires_at),
    state: inviteState(invite, at),
  };
}

export async function listInvites(slug: string): Promise<InviteRecord[]> {
  return query<InviteRecord>(`select ${inviteColumns} from invites where workspace_slug = $1 order by created_at desc`, [slug]);
}

export const emailMessage = 'Enter a valid email address.';
export const roleMessage = 'Choose developer or viewer.';

export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320;
}

/** Each workspace may create ten invites in any rolling sixty seconds. */
export async function checkInviteRate(client: PoolClient, slug: string): Promise<void> {
  const found = await rows<{ created_at: string }>(
    client,
    "select created_at from invites where workspace_slug = $1 and created_at > now() - interval '60 seconds' order by created_at",
    [slug],
  );
  if (found.length >= 10) {
    const oldest = new Date(found[0].created_at).getTime();
    const retryAfter = Math.max(1, Math.ceil((oldest + 60000 - Date.now()) / 1000));
    throw new RateLimited(retryAfter, `Too many invites right now. Try again in ${retryAfter} seconds.`);
  }
}

export async function createInvite(
  client: PoolClient,
  slug: string,
  email: string,
  role: 'developer' | 'viewer',
): Promise<{ invite: InviteRecord; token: string }> {
  const member = await row<{ user_id: string }>(
    client,
    `select m.user_id from memberships m join users u on u.id = m.user_id where m.workspace_slug = $1 and lower(u.email) = lower($2)`,
    [slug, email],
  );
  if (member) throw apiError('already_member');
  await client.query(
    `update invites set state = 'replaced' where workspace_slug = $1 and lower(email) = lower($2) and state = 'pending'`,
    [slug, email],
  );
  const token = randomToken();
  const at = nowSecond();
  const created = await row<InviteRecord>(
    client,
    `insert into invites (id, workspace_slug, email, role, token_hash, created_at, expires_at, state)
     values ($1, $2, $3, $4, $5, $6, $7, 'pending') returning ${inviteColumns}`,
    [
      randomId('inv'),
      slug,
      email,
      role,
      hashToken(token),
      at.toISOString(),
      new Date(at.getTime() + config.timing.inviteTtl * 1000).toISOString(),
    ],
  );
  return { invite: created as InviteRecord, token };
}

export async function findInviteByToken(client: PoolClient, token: string): Promise<InviteRecord | null> {
  return row<InviteRecord>(client, `select ${inviteColumns} from invites where token_hash = $1 for update`, [hashToken(token)]);
}

export const nameMessage = 'Names are 1 to 80 characters.';
export const passwordMessage = 'Use 12 to 128 characters, different from your current password.';

export function isValidName(value: unknown): value is string {
  return typeof value === 'string' && countCharacters(value) >= 1 && countCharacters(value) <= 80;
}

export function isValidNewPassword(value: unknown): value is string {
  return typeof value === 'string' && countCharacters(value) >= 12 && countCharacters(value) <= 128;
}

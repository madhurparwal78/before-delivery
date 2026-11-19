import { randomBytes } from 'node:crypto';
import { pool, withTransaction } from '../db.js';
import { ApiError, Err, fieldError } from '../errors.js';
import { asString } from '../input.js';
import type { Ctx, Reply } from '../http.js';
import { requireMembership, requireOwner, requireUser } from '../access.js';
import { writeActivity } from '../domain/activitylog.js';
import type { Role } from '../../shared/types.js';

export async function listMembers(ctx: Ctx): Promise<Reply> {
  const membership = await requireMembership(ctx, ctx.params['id'] ?? '');
  const result = await pool.query<{ user_id: string; display_name: string; email: string; role: Role }>(
    `select u.id as user_id, u.display_name, u.email, m.role
       from set_members m join users u on u.id = m.user_id
      where m.set_id = $1
      order by m.join_order`,
    [membership.setId],
  );
  return { status: 200, json: { members: result.rows } };
}

export async function createInvite(ctx: Ctx): Promise<Reply> {
  const membership = requireOwner(await requireMembership(ctx, ctx.params['id'] ?? ''));
  const role = asString(ctx.json['role']);
  if (role !== 'editor' && role !== 'viewer') throw fieldError('role', 'Choose the editor or viewer role');
  const token = randomBytes(18).toString('base64url');
  await pool.query(`insert into invites (token, set_id, role, created_by) values ($1, $2, $3, $4)`, [
    token,
    membership.setId,
    role,
    membership.user.id,
  ]);
  return { status: 201, json: { token, url: `/join/${token}`, role } };
}

export async function getInvite(ctx: Ctx): Promise<Reply> {
  const token = ctx.params['token'] ?? '';
  const result = await pool.query<{
    set_name: string;
    role: Role;
    owner_display_name: string;
    accepted_by: string | null;
  }>(
    `select s.name as set_name, i.role, u.display_name as owner_display_name, i.accepted_by
       from invites i join sets s on s.id = i.set_id join users u on u.id = s.owner_id
      where i.token = $1`,
    [token],
  );
  const row = result.rows[0];
  if (row === undefined) throw Err.notFound();
  return {
    status: 200,
    json: {
      set_name: row.set_name,
      role: row.role,
      owner_display_name: row.owner_display_name,
      used: row.accepted_by !== null,
    },
  };
}

export async function acceptInvite(ctx: Ctx): Promise<Reply> {
  const user = await requireUser(ctx);
  const token = ctx.params['token'] ?? '';
  return withTransaction(async (client) => {
    const found = await client.query<{ set_id: string; role: Role; accepted_by: string | null }>(
      `select set_id, role, accepted_by from invites where token = $1 for update`,
      [token],
    );
    const invite = found.rows[0];
    if (invite === undefined) throw Err.notFound();

    const existing = await client.query<{ role: Role }>(
      `select role from set_members where set_id = $1 and user_id = $2`,
      [invite.set_id, user.id],
    );
    const current = existing.rows[0];
    if (current !== undefined) {
      return { status: 200, json: { set_id: invite.set_id, role: current.role } };
    }
    if (invite.accepted_by !== null) {
      throw new ApiError(410, 'invite_used', 'This invite link has already been used');
    }
    const order = await client.query<{ next: number }>(
      `select coalesce(max(join_order), -1) + 1 as next from set_members where set_id = $1`,
      [invite.set_id],
    );
    await client.query(
      `insert into set_members (set_id, user_id, role, join_order) values ($1, $2, $3, $4)`,
      [invite.set_id, user.id, invite.role, order.rows[0]?.next ?? 1],
    );
    await client.query(`update invites set accepted_by = $2 where token = $1`, [token, user.id]);
    await writeActivity(
      client,
      invite.set_id,
      user.id,
      'member.join',
      user.id,
      `${user.display_name} joined as ${invite.role}`,
    );
    return { status: 200, json: { set_id: invite.set_id, role: invite.role } };
  });
}

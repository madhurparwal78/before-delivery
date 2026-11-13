import { randomBytes, randomUUID } from 'node:crypto';
import { MEMBERS_COPY, ROLE_LABELS } from '../../shared/copy';
import type { Role } from '../../shared/types';
import { emailError, normaliseEmail } from '../../shared/validate';
import { loadBoardRow, roleOf } from '../boards';
import { accessBoard, requireSignedIn } from '../context';
import { pool } from '../db';
import { env } from '../env';
import { forbidden, inviteExpired, invalid, notFound, serviceUnavailable } from '../errors';
import { flushBoard, recordEvent } from '../events';
import type { Ctx, Router } from '../http';
import { inviteMail, sendMail } from '../mail';
import { permissions } from '../../shared/permissions';
import { markService } from '../services';

const MEMBER_ROLES: Array<Exclude<Role, 'owner'>> = ['viewer', 'contributor', 'moderator'];

const ownerOnly = async (ctx: Ctx): Promise<{ boardId: string; boardTitle: string }> => {
  const { board, role } = await accessBoard(pool, ctx, ctx.params.id);
  requireSignedIn(ctx);
  if (!permissions.manageBoard(role)) throw forbidden();
  return { boardId: board.id, boardTitle: board.title };
};

const listMembers = async (ctx: Ctx): Promise<void> => {
  const { boardId } = await ownerOnly(ctx);
  const result = await pool.query<{ user_id: string; display_name: string; email: string; role: Role }>(
    `select user_id, display_name, email, role from (
       select u.id as user_id, u.display_name, u.email, 'owner' as role, 0 as rank
         from boards b join users u on u.id = b.owner_id where b.id = $1
       union all
       select u.id as user_id, u.display_name, u.email, m.role, 1 as rank
         from memberships m join users u on u.id = m.user_id where m.board_id = $1
     ) rows order by rank, display_name`,
    [boardId],
  );
  ctx.sendJson(200, { members: result.rows });
};

const setRole = async (ctx: Ctx): Promise<void> => {
  const { boardId, boardTitle } = await ownerOnly(ctx);
  const body = await ctx.json<{ role?: string }>();
  const board = await loadBoardRow(pool, boardId);
  if (board === null) throw notFound();
  if (board.owner_id === ctx.params.userId) throw invalid({ role: MEMBERS_COPY.ownerRole });
  const role = MEMBER_ROLES.find((candidate) => candidate === body.role);
  if (role === undefined) throw invalid({ role: 'Not a known value.' });
  const result = await pool.query<{ user_id: string; display_name: string; email: string; role: Role }>(
    `with changed as (
       update memberships set role = $3 where board_id = $1 and user_id = $2 returning user_id, role
     )
     select changed.user_id, u.display_name, u.email, changed.role
     from changed join users u on u.id = changed.user_id`,
    [boardId, ctx.params.userId, role],
  );
  const member = result.rows[0];
  if (member === undefined) throw notFound();
  await recordEvent(pool, boardId, { kind: 'role_changed', user_id: member.user_id, role, board_title: boardTitle });
  await flushBoard(boardId);
  ctx.sendJson(200, member);
};

const removeMember = async (ctx: Ctx): Promise<void> => {
  const { boardId, boardTitle } = await ownerOnly(ctx);
  const result = await pool.query('delete from memberships where board_id = $1 and user_id = $2', [
    boardId,
    ctx.params.userId,
  ]);
  if (result.rowCount === 0) throw notFound();
  await recordEvent(pool, boardId, {
    kind: 'role_changed',
    user_id: ctx.params.userId,
    role: null,
    board_title: boardTitle,
  });
  await flushBoard(boardId);
  ctx.sendEmpty(204);
};

const sendInvite = async (ctx: Ctx): Promise<void> => {
  const { boardId, boardTitle } = await ownerOnly(ctx);
  const userId = requireSignedIn(ctx);
  const body = await ctx.json<{ email?: string; role?: string }>();
  const email = normaliseEmail(body.email ?? '');
  const mailError = emailError(email);
  if (mailError !== null) throw invalid({ email: MEMBERS_COPY.emailRequired });
  const role = MEMBER_ROLES.find((candidate) => candidate === body.role);
  if (role === undefined) throw invalid({ role: 'Not a known value.' });

  const existing = await pool.query<{ id: string }>(
    `select u.id from users u
     where u.email = $2 and (
       exists(select 1 from memberships m where m.board_id = $1 and m.user_id = u.id)
       or exists(select 1 from boards b where b.id = $1 and b.owner_id = u.id))`,
    [boardId, email],
  );
  if ((existing.rowCount ?? 0) > 0) throw invalid({ email: MEMBERS_COPY.alreadyMember(email) });

  const inviter = await pool.query<{ display_name: string }>('select display_name from users where id = $1', [userId]);
  const token = randomBytes(16).toString('base64url');
  try {
    await sendMail(inviteMail(email, inviter.rows[0].display_name, boardTitle, ROLE_LABELS[role], token));
    markService('mail', true);
  } catch {
    markService('mail', false);
    throw serviceUnavailable('mail');
  }
  const created = await pool.query<{ created_at: Date }>(
    'insert into invites (id, board_id, token, email, role, inviter_id) values ($1, $2, $3, $4, $5, $6) returning created_at',
    [randomUUID(), boardId, token, email, role, userId],
  );
  const expiresAt = new Date(created.rows[0].created_at.getTime() + env.inviteTtlSeconds * 1000);
  ctx.sendJson(201, { invite: { email, role, expires_at: `${expiresAt.toISOString().slice(0, 19)}Z` } });
};

interface InviteRow {
  id: string;
  board_id: string;
  role: Exclude<Role, 'owner'>;
  used_at: Date | null;
  created_at: Date;
  board_title: string;
  inviter_name: string;
}

const loadInvite = async (token: string): Promise<InviteRow | null> => {
  const result = await pool.query<InviteRow>(
    `select i.id, i.board_id, i.role, i.used_at, i.created_at, b.title as board_title, u.display_name as inviter_name
     from invites i join boards b on b.id = i.board_id join users u on u.id = i.inviter_id
     where i.token = $1`,
    [token],
  );
  return result.rows[0] ?? null;
};

const isExpired = (invite: InviteRow): boolean =>
  invite.used_at !== null || invite.created_at.getTime() + env.inviteTtlSeconds * 1000 < Date.now();

const showInvite = async (ctx: Ctx): Promise<void> => {
  const invite = await loadInvite(ctx.params.token);
  if (invite === null) throw notFound();
  ctx.sendJson(200, {
    board_title: invite.board_title,
    inviter_name: invite.inviter_name,
    role: invite.role,
    expired: isExpired(invite),
  });
};

const RANK: Record<Exclude<Role, 'owner'>, number> = { viewer: 1, contributor: 2, moderator: 3 };

export const joinBoard = async (boardId: string, userId: string, role: Exclude<Role, 'owner'>): Promise<Role> => {
  const board = await loadBoardRow(pool, boardId);
  if (board === null) throw notFound();
  const current = await roleOf(pool, board, userId);
  if (current === 'owner') return 'owner';
  if (current !== null && RANK[current] >= RANK[role]) return current;
  await pool.query(
    `insert into memberships (board_id, user_id, role) values ($1, $2, $3)
     on conflict (board_id, user_id) do update set role = $3`,
    [boardId, userId, role],
  );
  await recordEvent(pool, boardId, { kind: 'role_changed', user_id: userId, role, board_title: board.title });
  await flushBoard(boardId);
  return role;
};

const acceptInvite = async (ctx: Ctx): Promise<void> => {
  const userId = requireSignedIn(ctx);
  const invite = await loadInvite(ctx.params.token);
  if (invite === null) throw notFound();
  if (isExpired(invite)) throw inviteExpired();
  await pool.query('update invites set used_at = now() where id = $1', [invite.id]);
  const role = await joinBoard(invite.board_id, userId, invite.role);
  ctx.sendJson(200, { board_id: invite.board_id, role });
};

export const registerMemberRoutes = (router: Router): void => {
  router.add('GET', '/api/boards/:id/members', listMembers);
  router.add('PATCH', '/api/boards/:id/members/:userId', setRole);
  router.add('DELETE', '/api/boards/:id/members/:userId', removeMember);
  router.add('POST', '/api/boards/:id/invites', sendInvite);
  router.add('GET', '/api/invites/:token', showInvite);
  router.add('POST', '/api/invites/:token/accept', acceptInvite);
};

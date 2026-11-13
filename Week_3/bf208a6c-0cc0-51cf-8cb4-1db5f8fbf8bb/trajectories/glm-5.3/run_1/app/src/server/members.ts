import type { App } from './app.js';
import type { RequestContext } from './http.js';
import { sendJson } from './http.js';
import { validation, notFound, forbidden, signInRequired, mailUnavailable, inviteExpired } from './errors.js';
import { trim, randomToken, isoPlusSeconds } from './util.js';
import { requireOwner } from './boards.js';
import type { Role } from '../shared/types.js';

const MEMBER_ROLES: Role[] = ['viewer', 'contributor', 'moderator'];

export async function handleListMembers(app: App, ctx: RequestContext): Promise<void> {
  await requireOwner(app, ctx, ctx.params.id);
  const res = await app.db.query(
    `SELECT u.id AS user_id, u.display_name, u.email, m.role
       FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.board_id = $1
      ORDER BY (m.role = 'owner') DESC, u.display_name`,
    [ctx.params.id],
  );
  sendJson(ctx.res, 200, {
    members: res.rows.map((r) => {
      const row = r as { user_id: string; display_name: string; email: string; role: Role };
      return { user_id: row.user_id, display_name: row.display_name, email: row.email, role: row.role };
    }),
  });
}

export async function handlePatchMember(app: App, ctx: RequestContext): Promise<void> {
  const board = await requireOwner(app, ctx, ctx.params.id);
  const body = ctx.jsonBody as Record<string, unknown>;
  const role = String(body.role ?? '');
  if (!MEMBER_ROLES.includes(role as Role)) throw validation({ role: 'Choose a role.' });
  const target = await app.db.query(
    'SELECT m.role, u.display_name, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.board_id = $1 AND m.user_id = $2',
    [board.id, ctx.params.userId],
  );
  const targetRow = target.rows[0] as { role: Role; display_name: string; email: string } | undefined;
  if (!targetRow) throw notFound();
  if (targetRow.role === 'owner') throw validation({ role: "The owner's role can't change." });
  await app.db.query('UPDATE memberships SET role = $1 WHERE board_id = $2 AND user_id = $3', [
    role,
    board.id,
    ctx.params.userId,
  ]);
  await app.events.publish(board.id, { type: 'role_changed', user_id: ctx.params.userId, role });
  sendJson(ctx.res, 200, {
    user_id: ctx.params.userId,
    display_name: targetRow.display_name,
    email: targetRow.email,
    role: role as Role,
  });
}

export async function handleRemoveMember(app: App, ctx: RequestContext): Promise<void> {
  const board = await requireOwner(app, ctx, ctx.params.id);
  const target = await app.db.query('SELECT role FROM memberships WHERE board_id = $1 AND user_id = $2', [
    board.id,
    ctx.params.userId,
  ]);
  const targetRow = target.rows[0] as { role: Role } | undefined;
  if (!targetRow || targetRow.role === 'owner') throw notFound();
  await app.db.query('DELETE FROM memberships WHERE board_id = $1 AND user_id = $2', [board.id, ctx.params.userId]);
  await app.events.publish(board.id, { type: 'role_changed', user_id: ctx.params.userId, role: null });
  ctx.res.writeHead(204);
  ctx.res.end();
}

export async function handleInvite(app: App, ctx: RequestContext): Promise<void> {
  const board = await requireOwner(app, ctx, ctx.params.id);
  const body = ctx.jsonBody as Record<string, unknown>;
  const email = trim(String(body.email ?? '')).toLowerCase();
  const role = String(body.role ?? 'viewer');
  if (!MEMBER_ROLES.includes(role as Role)) throw validation({ role: 'Choose a role.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw validation({ email: 'Enter an email address.' });
  const existingMember = await app.db.query(
    `SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.board_id = $1 AND u.email = $2`,
    [board.id, email],
  );
  if (existingMember.rows.length > 0) throw validation({ email: `${email} is already on this board.` });
  const inviter = await app.db.query('SELECT display_name FROM users WHERE id = $1', [ctx.userId]);
  const inviterName = (inviter.rows[0] as { display_name: string }).display_name;
  const token = randomToken(24);
  const sent = await app.services.mail.send({
    to: email,
    subject: `${inviterName} invited you to ${board.title} on Pinsheet`,
    text: `${inviterName} invited you to ${board.title} as a ${role}. Open ${app.config.publicUrl}/invite/${token} to join.`,
  });
  if (!sent) throw mailUnavailable();
  await app.db.query(
    'INSERT INTO invites (token, board_id, email, role, invited_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [token, board.id, email, role, ctx.userId, isoPlusSeconds(app.config.inviteTtl)],
  );
  sendJson(ctx.res, 201, { invite: { email, role, expires_at: isoPlusSeconds(app.config.inviteTtl) } });
}

export async function handleGetInvite(app: App, ctx: RequestContext): Promise<void> {
  const res = await app.db.query(
    `SELECT i.*, b.title AS board_title, b.deleted AS board_deleted, u.display_name AS inviter_name
       FROM invites i JOIN boards b ON b.id = i.board_id JOIN users u ON u.id = i.invited_by
      WHERE i.token = $1`,
    [ctx.params.token],
  );
  const row = res.rows[0] as
    | {
        board_id: string;
        board_title: string;
        board_deleted: boolean;
        inviter_name: string;
        role: Role;
        used: boolean;
        expires_at: Date;
      }
    | undefined;
  if (!row || row.board_deleted) throw notFound();
  const expired = row.used || row.expires_at.getTime() < Date.now();
  sendJson(ctx.res, 200, {
    board_title: row.board_title,
    inviter_name: row.inviter_name,
    role: row.role,
    expired,
  });
}

export async function handleAcceptInvite(app: App, ctx: RequestContext): Promise<void> {
  if (!ctx.userId) throw signInRequired();
  const res = await app.db.query(
    `SELECT i.*, b.deleted AS board_deleted FROM invites i JOIN boards b ON b.id = i.board_id WHERE i.token = $1`,
    [ctx.params.token],
  );
  const row = res.rows[0] as
    | { board_id: string; board_deleted: boolean; role: Role; used: boolean; expires_at: Date }
    | undefined;
  if (!row || row.board_deleted) throw notFound();
  if (row.used || row.expires_at.getTime() < Date.now()) throw inviteExpired();
  await app.db.query('UPDATE invites SET used = true, used_by = $1 WHERE token = $2', [ctx.userId, ctx.params.token]);
  const existing = await app.db.query('SELECT role FROM memberships WHERE board_id = $1 AND user_id = $2', [
    row.board_id,
    ctx.userId,
  ]);
  const existingRow = existing.rows[0] as { role: Role } | undefined;
  const order: Role[] = ['viewer', 'contributor', 'moderator', 'owner'];
  if (!existingRow) {
    await app.db.query('INSERT INTO memberships (board_id, user_id, role) VALUES ($1, $2, $3)', [
      row.board_id,
      ctx.userId,
      row.role,
    ]);
  } else if (order.indexOf(existingRow.role) < order.indexOf(row.role)) {
    await app.db.query('UPDATE memberships SET role = $1 WHERE board_id = $2 AND user_id = $3', [
      row.role,
      row.board_id,
      ctx.userId,
    ]);
  }
  sendJson(ctx.res, 200, { board_id: row.board_id, role: row.role });
}

export async function inviteBoardRow(app: App, token: string): Promise<string | null> {
  const res = await app.db.query('SELECT board_id FROM invites WHERE token = $1', [token]);
  const row = res.rows[0] as { board_id: string } | undefined;
  return row?.board_id ?? null;
}

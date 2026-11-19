import { query, queryOne } from '../db';
import { config } from '../config';
import { nowDate } from '../clock';
import { ApiError, FieldErrors, forbidden, notFound } from '../errors';
import { FIELD_COPY } from '../../shared/copy';
import { newToken } from '../passwords';
import { isOpsManager, projectUser, type UserRow } from '../domain/users';
import { revokeSessionsOf } from '../domain/sessions';
import { notifyChannelRevoked, notifySessionEnded } from '../domain/notify';
import { sendNow } from '../services/outbox';
import type { Role } from '../../shared/api';
import type { Route } from '../http/router';
import { queryParam, readJsonBody, requireUser, sendJson, viewerOf, type RequestContext } from '../http/context';

const ROLES: Role[] = ['dispatcher', 'field_technician', 'crew_lead', 'ops_manager'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

async function listMembers(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  const viewer = viewerOf(user);
  const term = (queryParam(ctx, 'q') ?? '').trim();
  const rows = await query<UserRow>(
    `SELECT id, workspace_id, name, handle, email, role, status FROM users
     WHERE workspace_id = $1 ORDER BY name ASC`,
    [user.workspace_id],
  );
  const lowered = term.toLowerCase();
  const filtered =
    term.length === 0
      ? rows
      : rows.filter((row) => {
          if (row.name.toLowerCase().startsWith(lowered)) return true;
          if (row.handle.toLowerCase().startsWith(lowered)) return true;
          return isOpsManager(viewer.role) && row.email.toLowerCase().startsWith(lowered);
        });
  sendJson(ctx, 200, { members: filtered.map((row) => projectUser(row, viewer)) });
}

function handleFor(name: string, email: string): string {
  const local = (email.split('@')[0] ?? name).toLowerCase().replace(/[^a-z0-9._-]/g, '');
  return local.length === 0 ? 'member' : local;
}

async function uniqueHandle(workspaceId: string, base: string): Promise<string> {
  let candidate = base;
  let suffix = 2;
  for (;;) {
    const clash = await queryOne<{ id: string }>(
      'SELECT id FROM users WHERE workspace_id = $1 AND lower(handle) = lower($2)',
      [workspaceId, candidate],
    );
    if (clash === null) return candidate;
    candidate = `${base}${suffix}`;
    suffix += 1;
  }
}

async function inviteMember(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  if (!isOpsManager(user.role)) throw forbidden();
  const body = await readJsonBody(ctx);

  const rawName = typeof body['name'] === 'string' ? (body['name'] as string) : '';
  const name = rawName.trim();
  const email = typeof body['email'] === 'string' ? (body['email'] as string).trim() : '';
  const role = body['role'];

  if (EMAIL_PATTERN.test(email)) {
    const taken = await queryOne<{ id: string }>('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
    if (taken !== null) throw new ApiError('email_taken');
  }

  const errors = new FieldErrors();
  if (name.length === 0) errors.add('name', FIELD_COPY.nameEmpty);
  else if (CONTROL_CHARACTERS.test(rawName)) errors.add('name', FIELD_COPY.nameControl);
  else if ([...name].length > 80) errors.add('name', FIELD_COPY.nameTooLong);
  if (!EMAIL_PATTERN.test(email)) errors.add('email', FIELD_COPY.email);
  if (typeof role !== 'string' || !ROLES.includes(role as Role)) errors.add('role', FIELD_COPY.role);
  errors.throwIfAny();

  const handle = await uniqueHandle(user.workspace_id, handleFor(name, email));
  const created = await queryOne<UserRow>(
    `INSERT INTO users (workspace_id, name, handle, email, role, status, password_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, 'invited', NULL, $6)
     RETURNING id, workspace_id, name, handle, email, role, status`,
    [user.workspace_id, name, handle, email, role, nowDate()],
  );
  if (created === null) throw new ApiError('internal_error');

  const token = newToken();
  await query('INSERT INTO invites (token, workspace_id, user_id, invited_by, created_at) VALUES ($1, $2, $3, $4, $5)', [
    token,
    user.workspace_id,
    created.id,
    user.id,
    nowDate(),
  ]);

  const workspace = await queryOne<{ name: string }>('SELECT name FROM workspaces WHERE id = $1', [user.workspace_id]);
  const sent = await sendNow({
    dedupeKey: `invite:${token}`,
    toAddress: created.email,
    toName: created.name,
    subject: `Join ${workspace?.name ?? ''} on Rimewire`,
    body: inviteBody(created.name, user.name, workspace?.name ?? '', token),
  });

  sendJson(ctx, 201, {
    member: projectUser(created, viewerOf(user)),
    invite_email: sent ? 'sent' : 'queued',
  });
}

function inviteBody(inviteeName: string, inviterName: string, workspaceName: string, token: string): string {
  return [
    `Hello ${inviteeName},`,
    '',
    `${inviterName} has invited you to join ${workspaceName} on Rimewire.`,
    '',
    'Set your password and join:',
    `${config.publicUrl}/join/${token}`,
    '',
  ].join('\n');
}

async function deactivateMember(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  if (!isOpsManager(user.role)) throw forbidden();
  const targetId = ctx.params['userId'] as string;
  const target = await queryOne<UserRow>(
    'SELECT id, workspace_id, name, handle, email, role, status FROM users WHERE id = $1 AND workspace_id = $2',
    [targetId, user.workspace_id],
  );
  if (target === null) throw notFound();
  if (target.id === user.id) throw new ApiError('cannot_deactivate_self');

  const channels = await query<{ channel_id: string }>('SELECT channel_id FROM channel_members WHERE user_id = $1', [
    target.id,
  ]);
  await query('DELETE FROM channel_members WHERE user_id = $1', [target.id]);
  await query("UPDATE users SET status = 'deactivated' WHERE id = $1", [target.id]);
  await revokeSessionsOf(target.id);

  sendJson(ctx, 200, { member: projectUser({ ...target, status: 'deactivated' }, viewerOf(user)) });
  for (const channel of channels) {
    await notifyChannelRevoked(user.workspace_id, channel.channel_id, target.id);
  }
  await notifySessionEnded(user.workspace_id, target.id);
}

export const workspaceRoutes: Route[] = [
  { method: 'GET', pattern: '/api/workspace/members', handler: listMembers },
  { method: 'POST', pattern: '/api/workspace/members', handler: inviteMember },
  { method: 'DELETE', pattern: '/api/workspace/members/:userId', handler: deactivateMember },
];

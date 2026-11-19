import { config } from '../config.js';
import { one, query, transaction } from '../db.js';
import { inviteEmail } from '../domain/emails.js';
import { freeHandle } from '../domain/handles.js';
import { hashPassword, newId, newToken, verifyPassword } from '../domain/ids.js';
import {
  checkHourlyAllowance,
  InviteRow,
  inviteShape,
  inviteStatus,
} from '../domain/invites.js';
import { isInviteRole } from '../domain/roles.js';
import { personView } from '../domain/shapes.js';
import {
  allowedKeys,
  checkEmail,
  FieldCheck,
  invalidRole,
  normaliseEmail,
} from '../domain/validation.js';
import { sendMail } from '../infra/mail.js';
import { Ctx, Reply, requireProject, SessionUser } from '../http/context.js';
import { ApiError, conflict, notFound } from '../http/errors.js';
import { Route } from '../http/router.js';
import { sessionCookie, startSession } from './session.js';

async function listInvites(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'administer');
  const rows = await query<InviteRow>(
    `select * from invites where project_id = $1 order by sent_at desc`,
    [access.project.id],
  );
  const now = new Date();
  return { status: 200, body: { invites: rows.map((row) => inviteShape(row, now)) } };
}

async function createInvite(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'administer');
  allowedKeys(ctx.body, ['email', 'role']);
  const role = ctx.body.role;
  if (!isInviteRole(role)) invalidRole();
  const email = checkEmail(ctx.body);
  const emailLower = normaliseEmail(email);

  const member = await one(
    `select 1 from memberships m join users u on u.id = m.user_id
      where m.project_id = $1 and u.email_lower = $2`,
    [access.project.id, emailLower],
  );
  if (member !== null) throw conflict('already_member');

  return transaction(async (tx) => {
    await tx.lockProject(access.project.id);
    const pending = await tx.query<InviteRow>(
      `select * from invites where project_id = $1 and email_lower = $2 and status = 'pending'`,
      [access.project.id, emailLower],
    );
    if (pending.some((row) => inviteStatus(row) === 'pending')) throw conflict('invite_pending');

    await checkHourlyAllowance(tx, access.project.id);

    const token = newToken();
    const sentAt = new Date();
    const expiresAt = new Date(sentAt.getTime() + config.inviteTtlSeconds * 1000);
    try {
      await sendMail(
        inviteEmail({
          to: email,
          inviterName: access.user.display_name,
          projectTitle: access.project.title,
          role,
          token,
          expiresAt: expiresAt.toISOString(),
        }),
      );
    } catch {
      throw new ApiError(503, 'mail_unavailable');
    }

    const row = (await tx.one<InviteRow>(
      `insert into invites
         (id, project_id, token, email, email_lower, role, status, sent_at, expires_at,
          inviter_id, inviter_name)
       values ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10) returning *`,
      [
        newId('i'),
        access.project.id,
        token,
        email,
        emailLower,
        role,
        sentAt,
        expiresAt,
        access.user.id,
        access.user.display_name,
      ],
    )) as InviteRow;
    return { status: 201, body: { invite: inviteShape(row) } };
  });
}

async function revokeInvite(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'administer');
  allowedKeys(ctx.body, []);
  const row = await one<InviteRow>(
    `select * from invites where project_id = $1 and id = $2`,
    [access.project.id, ctx.params.iid],
  );
  if (row === null) throw notFound();
  if (inviteStatus(row) !== 'pending') throw conflict('invite_not_pending');
  const updated = (await one<InviteRow>(
    `update invites set status = 'revoked' where id = $1 and status = 'pending' returning *`,
    [row.id],
  )) as InviteRow | null;
  if (updated === null) throw conflict('invite_not_pending');
  return { status: 200, body: { invite: inviteShape(updated) } };
}

async function readInviteByToken(ctx: Ctx): Promise<Reply> {
  const row = await one<InviteRow & { project_title: string }>(
    `select i.*, p.title as project_title from invites i
       join projects p on p.id = i.project_id
      where i.token = $1`,
    [ctx.params.token],
  );
  if (row === null) throw notFound();
  const status = inviteStatus(row);
  if (status !== 'pending') {
    throw new ApiError(410, 'invite_unavailable', { status });
  }
  return {
    status: 200,
    body: {
      invite: {
        projectTitle: row.project_title,
        role: row.role,
        inviterName: row.inviter_name,
        email: row.email,
        expiresAt: row.expires_at.toISOString(),
      },
    },
  };
}

async function acceptInvite(ctx: Ctx): Promise<Reply> {
  const token = ctx.params.token;
  const existing = await one<InviteRow>(`select * from invites where token = $1`, [token]);
  if (existing === null) throw notFound();
  const status = inviteStatus(existing);
  if (status !== 'pending') throw new ApiError(410, 'invite_unavailable', { status });

  const account = await one<SessionUser>(`select * from users where email_lower = $1`, [
    existing.email_lower,
  ]);
  const password = ctx.body.password;
  if (account !== null) {
    if (typeof password !== 'string' || !verifyPassword(password, account.password_hash)) {
      throw new ApiError(401, 'invalid_credentials');
    }
    const member = await one(
      `select 1 from memberships where project_id = $1 and user_id = $2`,
      [existing.project_id, account.id],
    );
    if (member !== null) {
      throw conflict('already_member', { projectId: existing.project_id });
    }
  }
  allowedKeys(ctx.body, ['displayName', 'password']);
  const check = new FieldCheck(ctx.body);
  const displayName = check.text('displayName', { min: 1, max: 80, trim: true });
  if (account === null) check.text('password', { min: 10, max: 200 });
  check.done();

  const result = await transaction(async (tx) => {
    await tx.lockProject(existing.project_id);
    const row = (await tx.one<InviteRow>(
      `select * from invites where token = $1 for update`,
      [token],
    )) as InviteRow;
    const live = inviteStatus(row);
    if (live !== 'pending') throw new ApiError(410, 'invite_unavailable', { status: live });

    let user = account;
    if (user === null) {
      const handle = await freeHandle(tx, row.email);
      const created = (await tx.one<SessionUser>(
        `insert into users (id, email, email_lower, display_name, handle, password_hash)
         values ($1, $2, $3, $4, $5, $6) returning *`,
        [
          newId('u'),
          row.email,
          row.email_lower,
          displayName as string,
          handle,
          hashPassword(ctx.body.password as string),
        ],
      )) as SessionUser;
      user = created;
    }
    await tx.query(
      `insert into memberships (project_id, user_id, role) values ($1, $2, $3)
       on conflict (project_id, user_id) do nothing`,
      [row.project_id, user.id, row.role],
    );
    await tx.query(`update invites set status = 'accepted' where id = $1`, [row.id]);
    return { user, projectId: row.project_id, role: row.role };
  });

  if (ctx.sessionId !== null) {
    await query(`delete from sessions where id = $1`, [ctx.sessionId]);
  }
  const sessionId = await startSession(result.user.id);
  return {
    status: 200,
    body: {
      user: personView.user(result.user),
      projectId: result.projectId,
      role: result.role,
    },
    headers: { 'Set-Cookie': sessionCookie(sessionId) },
  };
}

export const inviteRoutes: Route[] = [
  { method: 'GET', path: '/api/projects/:pid/invites', keys: [], handler: listInvites },
  {
    method: 'POST',
    path: '/api/projects/:pid/invites',
    keys: ['email', 'role'],
    handler: createInvite,
  },
  {
    method: 'POST',
    path: '/api/projects/:pid/invites/:iid/revoke',
    keys: [],
    handler: revokeInvite,
  },
  { method: 'GET', path: '/api/invites/:token', keys: [], anonymous: true, handler: readInviteByToken },
  {
    method: 'POST',
    path: '/api/invites/:token/accept',
    keys: ['displayName', 'password'],
    anonymous: true,
    handler: acceptInvite,
  },
];

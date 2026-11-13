import { COPY } from '../../shared/copy';
import type { MePayload, WorkspacePayload } from '../../shared/types';
import { db, loadUserByEmail } from '../db/repo';
import { transaction } from '../db/pool';
import { readString } from '../domain/body';
import { safeReturnPath } from '../domain/returnPath';
import { publishUserSignal } from '../events/live';
import type { Ctx } from '../http/context';
import { errors } from '../http/errors';
import { hashPassword, hashToken, newSessionToken, verifyPassword } from '../lib/crypto';
import { relay } from '../services/relay';
import { storage } from '../services/storage';

export const SESSION_COOKIE = 'kinfold_session';

function setSessionCookie(ctx: Ctx, token: string): void {
  ctx.res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`);
}

function clearSessionCookie(ctx: Ctx): void {
  ctx.res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export async function signIn(ctx: Ctx): Promise<void> {
  const body = ctx.body({ required: ['email', 'password'], optional: ['next'] });
  const email = readString(body, 'email', 'Enter your email.');
  const password = readString(body, 'password', 'Enter your password.');
  const user = await loadUserByEmail(db, email);
  if (user === null || !(await verifyPassword(password, user.password_hash))) {
    throw errors.invalidCredentials();
  }
  const token = newSessionToken();
  await db.query(`insert into sessions (token_hash, user_id) values ($1, $2)`, [hashToken(token), user.id]);
  setSessionCookie(ctx, token);
  ctx.json(200, {
    user: { userId: user.id, displayName: user.display_name, initials: user.initials, colour: user.colour },
    redirectTo: safeReturnPath(body['next']),
  });
}

export async function signOut(ctx: Ctx): Promise<void> {
  const session = ctx.requireSession();
  await db.query(`delete from sessions where token_hash = $1`, [session.tokenHash]);
  clearSessionCookie(ctx);
  ctx.noContent();
}

export async function me(ctx: Ctx): Promise<void> {
  const user = ctx.requireUser();
  const workspaces = await db.query<{
    id: string;
    name: string;
    parent_name: string;
    time_zone: string;
    role: 'admin' | 'member';
  }>(
    `select w.id, w.name, w.parent_name, w.time_zone, m.role
       from workspace_members m join workspaces w on w.id = m.workspace_id
      where m.user_id = $1 order by w.name, w.id`,
    [user.id],
  );
  const payload: MePayload = {
    userId: user.id,
    displayName: user.display_name,
    initials: user.initials,
    colour: user.colour,
    email: user.email,
    workspaces: workspaces.map(
      (row): WorkspacePayload => ({
        id: row.id,
        name: row.name,
        parentName: row.parent_name,
        timeZone: row.time_zone,
        role: row.role,
      }),
    ),
  };
  ctx.json(200, payload);
}

export async function changePassword(ctx: Ctx): Promise<void> {
  const user = ctx.requireUser();
  const session = ctx.requireSession();
  const body = ctx.body({ required: ['currentPassword', 'newPassword'] });
  const currentPassword = readString(body, 'currentPassword', COPY.wrongCurrentPassword);
  const newPassword = readString(body, 'newPassword', COPY.passwordLength);
  if (!(await verifyPassword(currentPassword, user.password_hash))) {
    throw errors.validation({ currentPassword: COPY.wrongCurrentPassword });
  }
  const length = [...newPassword].length;
  if (length < 12 || length > 200) {
    throw errors.validation({ newPassword: COPY.passwordLength });
  }
  const hash = await hashPassword(newPassword);
  const removed = await transaction(async (tx) => {
    await tx.query(`update users set password_hash = $1 where id = $2`, [hash, user.id]);
    const rows = await tx.query<{ token_hash: string }>(
      `delete from sessions where user_id = $1 and token_hash <> $2 returning token_hash`,
      [user.id, session.tokenHash],
    );
    return rows.length;
  });
  publishUserSignal(user.id, { type: 'session', keepTokenHash: session.tokenHash });
  ctx.json(200, { signedOutSessions: removed });
}

export async function serviceStatus(ctx: Ctx): Promise<void> {
  ctx.requireUser();
  ctx.json(200, { live: relay.status(), storage: storage.status() });
}

export async function health(ctx: Ctx): Promise<void> {
  ctx.json(200, { status: 'ok' });
}

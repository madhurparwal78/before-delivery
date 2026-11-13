import { fieldCopy } from '../../shared/copy.js';
import { safeReturnPath } from '../../shared/safeReturn.js';
import type { MeResponse, WorkspaceSummary } from '../../shared/api.js';
import {
  clearedSessionCookie,
  createSession,
  dropSession,
  foldEmail,
  hashPassword,
  sessionCookie,
  verifyPassword,
} from '../auth.js';
import { one, query } from '../db.js';
import { faults } from '../errors.js';
import { newId } from '../ids.js';
import { created, noContent, ok, type Ctx, type Reply, type Route } from '../http.js';
import { readString, requireEmail } from '../repo.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/** The one place that decides where sign-in and sign-up land. */
export async function landingRoute(
  userId: string,
  invite: string | null,
  returnValue: string | null,
): Promise<string> {
  if (invite !== null && invite !== '') return `/invite/${invite}`;
  const safe = safeReturnPath(returnValue);
  if (safe !== null) return safe;
  const account = await one<{ last_workspace_id: string | null }>(
    'select last_workspace_id from accounts where id = $1',
    [userId],
  );
  if (account?.last_workspace_id) {
    const member = await one<{ workspace_id: string }>(
      'select workspace_id from memberships where workspace_id = $1 and user_id = $2',
      [account.last_workspace_id, userId],
    );
    if (member) return `/w/${member.workspace_id}`;
  }
  const earliest = await one<{ workspace_id: string }>(
    `select workspace_id from memberships where user_id = $1
      order by joined_at, workspace_id limit 1`,
    [userId],
  );
  return earliest ? `/w/${earliest.workspace_id}` : '/workspaces/new';
}

async function signUp(ctx: Ctx): Promise<Reply> {
  const body = ctx.body();
  const displayName = readString(body, 'displayName').trim();
  const fields: Record<string, string> = {};
  if ([...displayName].length < 1 || [...displayName].length > 60)
    fields.displayName = fieldCopy.displayName;
  const emailRaw = readString(body, 'email').trim();
  if (!EMAIL_PATTERN.test(emailRaw) || emailRaw.length > 254) fields.email = fieldCopy.email;
  const password = readString(body, 'password');
  if (password.length < 10 || password.length > 128) fields.password = fieldCopy.password;
  if (Object.keys(fields).length > 0) throw faults.validation(fields);

  const id = newId();
  const passwordHash = await hashPassword(password);
  try {
    await query(
      'insert into accounts (id, email, email_folded, display_name, password_hash) values ($1,$2,$3,$4,$5)',
      [id, emailRaw, foldEmail(emailRaw), displayName, passwordHash],
    );
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw faults.emailTaken();
    throw error;
  }
  const sessionId = await createSession(id);
  const invite = readString(body, 'invite');
  return {
    ...created({
      user: { id, email: emailRaw, displayName },
      landing: invite !== '' ? `/invite/${invite}` : '/workspaces/new',
    }),
    headers: { 'set-cookie': sessionCookie(sessionId) },
  };
}

async function signIn(ctx: Ctx): Promise<Reply> {
  const body = ctx.body();
  const email = requireEmail(body);
  const password = readString(body, 'password');
  const row = await one<{ id: string; email: string; display_name: string; password_hash: string }>(
    'select id, email, display_name, password_hash from accounts where email_folded = $1',
    [foldEmail(email)],
  );
  if (!row || !(await verifyPassword(password, row.password_hash))) throw faults.badCredentials();
  const sessionId = await createSession(row.id);
  const invite = readString(body, 'invite');
  const landing = await landingRoute(
    row.id,
    invite === '' ? null : invite,
    readString(body, 'return') === '' ? null : readString(body, 'return'),
  );
  return {
    status: 200,
    body: {
      user: { id: row.id, email: row.email, displayName: row.display_name },
      landing,
    },
    headers: { 'set-cookie': sessionCookie(sessionId) },
  };
}

async function signOut(ctx: Ctx): Promise<Reply> {
  const sessionId = ctx.sessionId;
  if (sessionId) await dropSession(sessionId);
  return { ...noContent(), headers: { 'set-cookie': clearedSessionCookie() } };
}

async function me(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const workspaces = await query<{ id: string; name: string; role: WorkspaceSummary['role'] }>(
    `select w.id, w.name, m.role
       from memberships m join workspaces w on w.id = m.workspace_id
      where m.user_id = $1 order by m.joined_at, w.id`,
    [account.id],
  );
  const row = await one<{ last_workspace_id: string | null }>(
    'select last_workspace_id from accounts where id = $1',
    [account.id],
  );
  const response: MeResponse = {
    user: { id: account.id, email: account.email, displayName: account.displayName },
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      role: workspace.role,
    })),
    lastWorkspaceId: row?.last_workspace_id ?? null,
  };
  return ok(response);
}

export const authRoutes: readonly Route[] = [
  { method: 'POST', pattern: '/api/auth/sign-up', handler: signUp, open: true },
  { method: 'POST', pattern: '/api/auth/sign-in', handler: signIn, open: true },
  { method: 'POST', pattern: '/api/auth/sign-out', handler: signOut, open: true },
  { method: 'GET', pattern: '/api/me', handler: me },
];

import { acceptInvite, confirmAccount, findInvite, signIn, signUp } from '../accounts.js';
import { endSession, expiredCookie, sessionCookie } from '../auth.js';
import { db } from '../db.js';
import type { Route } from '../http.js';

const tokenText = (value: unknown): string => (typeof value === 'string' ? value : '');

export const authRoutes: Route[] = [
  {
    method: 'POST', path: '/api/auth/sign-up', auth: 'public', body: 'json',
    async handle(ctx) {
      await signUp(ctx.body);
      return { status: 201, body: { message: 'Check your email to confirm your account' } };
    },
  },
  {
    method: 'POST', path: '/api/auth/confirm', auth: 'public', body: 'json',
    async handle(ctx) {
      const { workspaceId, session } = await confirmAccount(tokenText(ctx.body.token));
      return { status: 200, body: { workspace_id: workspaceId }, headers: { 'set-cookie': sessionCookie(session) } };
    },
  },
  {
    method: 'POST', path: '/api/auth/sign-in', auth: 'public', body: 'json',
    async handle(ctx) {
      const { workspaceId, name, session } = await signIn(ctx.body);
      return { status: 200, body: { workspace_id: workspaceId, name }, headers: { 'set-cookie': sessionCookie(session) } };
    },
  },
  {
    method: 'POST', path: '/api/auth/sign-out', auth: 'public',
    async handle(ctx) {
      if (ctx.token !== null) await endSession(ctx.token);
      return { status: 204, headers: { 'set-cookie': expiredCookie } };
    },
  },
  {
    method: 'GET', path: '/api/me',
    async handle(ctx) {
      const { rows } = await db.query(
        `SELECT w.id, w.name, w.slug, m.role FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1 ORDER BY m.seq`,
        [ctx.user.id],
      );
      return { status: 200, body: { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email, workspaces: rows } };
    },
  },
  {
    method: 'GET', path: '/api/invites/:token', auth: 'public',
    async handle(ctx) {
      const invite = await findInvite(ctx.params.token ?? '');
      return { status: 200, body: { workspace_name: invite.workspace_name, email: invite.email, role: invite.role, has_account: invite.has_account } };
    },
  },
  {
    method: 'POST', path: '/api/invites/:token/accept', auth: 'public', body: 'json',
    async handle(ctx) {
      const { workspaceId, session } = await acceptInvite(ctx.params.token ?? '', ctx.body);
      return { status: 200, body: { workspace_id: workspaceId }, headers: { 'set-cookie': sessionCookie(session) } };
    },
  },
];


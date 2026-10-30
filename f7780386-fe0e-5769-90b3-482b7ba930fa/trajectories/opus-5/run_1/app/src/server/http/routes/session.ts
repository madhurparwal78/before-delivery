import type { MemberSummary, User } from '../../../shared/api.js';
import { verifyPassword } from '../../db/seed.js';
import { insuranceSummary } from '../../domain/documents.js';
import { allMembers } from '../../domain/kitchen.js';
import { balanceMinutes } from '../../domain/ledger.js';
import { requireUser, type RequestContext, type SessionUser } from '../context.js';
import { HttpError, validationFailed } from '../errors.js';
import { route, type Route, type RouteResult } from '../router.js';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  readCookie,
  SESSION_COOKIE,
  setSessionCookie,
} from '../session.js';
import { readString, requireBoundedText } from '../validate.js';

export function userView(user: SessionUser): User {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    member_id: user.member_id,
    business_name: user.business_name,
  };
}

interface CredentialRow {
  id: string;
  password_hash: string;
}

async function signIn(ctx: RequestContext): Promise<RouteResult> {
  const email = readString(ctx.body, 'email');
  const password = readString(ctx.body, 'password');
  const missing: Record<string, string> = {};
  if (email === null || email === '') missing['email'] = 'required';
  if (password === null || password === '') missing['password'] = 'required';
  if (Object.keys(missing).length > 0) throw validationFailed(missing);

  const found = await ctx.app.db.query<CredentialRow>(
    'SELECT id, password_hash FROM users WHERE lower(email) = lower($1)',
    [email],
  );
  const credentials = found.rows[0];
  if (
    credentials === undefined ||
    !verifyPassword(credentials.id, password as string, credentials.password_hash)
  ) {
    throw new HttpError(401, 'invalid_credentials');
  }

  const token = await createSession(ctx.app.db, credentials.id, ctx.now);
  setSessionCookie(ctx.res, token);

  const loaded = await ctx.app.db.query<SessionUser>(
    `SELECT u.id, u.role, u.name, u.email, u.member_id, m.business_name
       FROM users u LEFT JOIN members m ON m.id = u.member_id WHERE u.id = $1`,
    [credentials.id],
  );
  return { status: 200, body: { user: userView(loaded.rows[0] as SessionUser) } };
}

export const sessionRoutes: Route[] = [
  route({
    method: 'POST',
    path: '/session',
    public: true,
    handle: signIn,
  }),

  route({
    method: 'DELETE',
    path: '/session',
    handle: async (ctx) => {
      const token = readCookie(ctx.req, SESSION_COOKIE);
      if (token !== null) await destroySession(ctx.app.db, token);
      clearSessionCookie(ctx.res);
      return { status: 204 };
    },
  }),

  route({
    method: 'GET',
    path: '/me',
    handle: async (ctx) => {
      const user = requireUser(ctx);
      const balance =
        user.role === 'member' && user.member_id !== null
          ? await balanceMinutes(ctx.app.db, user.member_id)
          : null;
      return { status: 200, body: { user: userView(user), balance_minutes: balance } };
    },
  }),

  route({
    method: 'PATCH',
    path: '/members/me',
    roles: ['member'],
    handle: async (ctx) => {
      const user = requireUser(ctx);
      const name = requireBoundedText(ctx.body, 'business_name', 1, 80);
      await ctx.app.db.query('UPDATE members SET business_name = $2 WHERE id = $1', [
        user.member_id,
        name,
      ]);
      return { status: 200, body: { member: { id: user.member_id, business_name: name } } };
    },
  }),

  route({
    method: 'GET',
    path: '/members',
    roles: ['operator'],
    handle: async (ctx) => {
      const members = await allMembers(ctx.app.db);
      const summaries: MemberSummary[] = [];
      for (const member of members) {
        summaries.push({
          id: member.id,
          business_name: member.business_name,
          contact_email: member.contact_email,
          balance_minutes: await balanceMinutes(ctx.app.db, member.id),
          liability_insurance: await insuranceSummary(ctx.app.db, member.id, ctx.today),
        });
      }
      return { status: 200, body: { members: summaries } };
    },
  }),
];

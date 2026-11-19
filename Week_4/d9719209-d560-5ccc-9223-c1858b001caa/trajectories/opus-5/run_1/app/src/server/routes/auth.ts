import { db, one } from '../../core/db.js';
import { errors } from '../../core/errors.js';
import { newTotpSecret, otpauthUri, totpMatches } from '../../core/crypto.js';
import {
  confirmPasswordReset,
  confirmVerification,
  requestPasswordReset,
  resendVerification,
  revokeSession,
  signIn,
  signUp,
} from '../../domain/auth.js';
import { feedPage, projectPosts } from '../../domain/posts.js';
import { copy } from '../../shared/copy.js';
import { loadMemberByUsername, ownAccount, publicUser } from '../../domain/viewer.js';
import { asString } from '../../domain/validation.js';
import {
  clearSessionCookie,
  requireMember,
  route,
  sendJson,
  sendNoContent,
  setSessionCookie,
  type Route,
} from '../http.js';

export const authRoutes: Route[] = [
  route('POST', '/api/auth/signup', async (ctx) => {
    const { member, token } = await signUp({
      email: asString(ctx.body.email),
      username: asString(ctx.body.username),
      password: asString(ctx.body.password),
    });
    setSessionCookie(ctx, token);
    sendJson(ctx, 201, ownAccount(member));
  }),

  route('POST', '/api/auth/verify', async (ctx) => {
    await confirmVerification(asString(ctx.body.token));
    sendJson(ctx, 200, { emailVerified: true });
  }),

  route('POST', '/api/auth/verify/resend', async (ctx) => {
    const member = requireMember(ctx);
    await resendVerification(member);
    sendJson(ctx, 202, { sent: true });
  }),

  route('POST', '/api/auth/login', async (ctx) => {
    const totp = typeof ctx.body.totp === 'string' ? ctx.body.totp.trim() : null;
    const { member, token } = await signIn({
      login: asString(ctx.body.login),
      password: asString(ctx.body.password),
      totp,
    });
    setSessionCookie(ctx, token);
    sendJson(ctx, 200, ownAccount(member));
  }),

  route('POST', '/api/auth/logout', async (ctx) => {
    if (ctx.sessionToken) await revokeSession(ctx.sessionToken);
    clearSessionCookie(ctx);
    sendNoContent(ctx);
  }),

  route('POST', '/api/auth/password-reset', async (ctx) => {
    await requestPasswordReset(asString(ctx.body.email));
    sendJson(ctx, 202, { sent: true });
  }),

  route('POST', '/api/auth/password-reset/confirm', async (ctx) => {
    await confirmPasswordReset(asString(ctx.body.token), asString(ctx.body.newPassword));
    sendJson(ctx, 200, { reset: true });
  }),

  route('GET', '/api/me', async (ctx) => {
    const member = requireMember(ctx);
    sendJson(ctx, 200, ownAccount(member));
  }, 'none'),

  route('POST', '/api/me/totp/setup', async (ctx) => {
    const member = requireMember(ctx);
    if (member.totpEnabled) throw errors.conflict('Two-factor authentication is already on');
    const secret = member.totpSecret ?? newTotpSecret();
    await db.query('update members set totp_secret = $2 where id = $1', [member.id, secret]);
    sendJson(ctx, 200, { secret, otpauthUri: otpauthUri(member.username, secret) });
  }),

  route('POST', '/api/me/totp/enable', async (ctx) => {
    const member = requireMember(ctx);
    const code = asString(ctx.body.code).trim();
    const row = await one<{ totp_secret: string | null }>(db, 'select totp_secret from members where id = $1', [
      member.id,
    ]);
    const secret = row?.totp_secret ?? null;
    if (!secret || !/^[0-9]{6}$/.test(code) || !totpMatches(secret, code)) {
      throw errors.validation(copy.totp.codeWrong, { code: copy.totp.codeWrong });
    }
    await db.query('update members set totp_enabled = true where id = $1', [member.id]);
    sendJson(ctx, 200, { totpEnabled: true });
  }),

  route('GET', '/api/users/:username', async (ctx) => {
    const member = await loadMemberByUsername(ctx.params.username);
    if (!member) throw errors.notFound('Account not found');
    sendJson(ctx, 200, publicUser(member.username, member.createdAt));
  }, 'none'),

  route('GET', '/api/users/:username/posts', async (ctx) => {
    const member = await loadMemberByUsername(ctx.params.username);
    if (!member) throw errors.notFound('Account not found');
    const page = await feedPage({
      sort: 'new',
      cursor: ctx.url.searchParams.get('cursor'),
      viewerId: ctx.viewer.member ? ctx.viewer.member.id : null,
      scope: { kind: 'author', authorId: member.id },
    });
    sendJson(ctx, 200, {
      items: await projectPosts(page.rows, ctx.viewer),
      nextCursor: page.nextCursor,
    });
  }, 'none'),
];

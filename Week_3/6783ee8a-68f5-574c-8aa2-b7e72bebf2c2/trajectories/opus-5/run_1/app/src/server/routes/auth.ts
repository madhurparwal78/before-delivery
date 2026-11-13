import type { FieldError } from '../../shared/types.js';
import { publicUser, requireUser, type UserRow } from '../access.js';
import { query, queryOne, withTransaction } from '../db.js';
import {
  emailNotVerified,
  invalidCredentials,
  invitationForAnotherAccount,
  mailUnavailable,
  notFound,
  validationFailed,
} from '../errors.js';
import {
  clearSessionCookie,
  readJsonBody,
  route,
  sendEmpty,
  sendJson,
  setSessionCookie,
  type Ctx,
} from '../http.js';
import { hashPassword, newId, newToken, passwordMatches } from '../ids.js';
import { acceptInvitation, invitationByToken } from '../invitations.js';
import { MailFailure, sendMail, verificationMessage } from '../mail.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

function codePoints(value: string): number {
  return [...value].length;
}

function text(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value : '';
}

async function createSession(userId: string): Promise<string> {
  const sessionId = newId();
  await query(`insert into sessions (id, user_id) values ($1, $2)`, [sessionId, userId]);
  return sessionId;
}

export function registerAuthRoutes(): void {
  route('POST', '/api/auth/signup', async (ctx: Ctx) => {
    const body = await readJsonBody(ctx);
    const displayName = text(body, 'display_name');
    const email = text(body, 'email');
    const password = text(body, 'password');
    const use = text(body, 'use');
    const invitationToken = text(body, 'invitation_token');
    const emailLower = email.trim().toLowerCase();

    const errors: FieldError[] = [];
    if (codePoints(displayName.trim()) < 1 || codePoints(displayName) > 40) {
      errors.push({ path: 'display_name', message: 'must be 1 to 40 characters' });
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      errors.push({ path: 'email', message: 'must be a valid email address' });
    } else {
      const existing = await queryOne<{ id: string }>(`select id from users where email_lower = $1`, [
        emailLower,
      ]);
      if (existing) errors.push({ path: 'email', message: 'is already registered' });
    }
    if (codePoints(password) < 10 || codePoints(password) > 128) {
      errors.push({ path: 'password', message: 'must be 10 to 128 characters' });
    }
    const invitation = invitationToken === '' ? null : await invitationByToken(invitationToken);
    if (invitationToken !== '' && (!invitation || invitation.email_lower !== emailLower)) {
      errors.push({ path: 'invitation_token', message: 'is not valid for this email' });
    }
    if (errors.length > 0) throw validationFailed(errors);

    const userId = newId();
    const verified = invitation !== null;

    if (verified) {
      await query(
        `insert into users (id, email, email_lower, display_name, password_hash, notebook_use, verified)
         values ($1, $2, $3, $4, $5, $6, true)`,
        [userId, email.trim(), emailLower, displayName.trim(), hashPassword(password), use === '' ? null : use],
      );
      await acceptInvitation(invitation, userId);
      setSessionCookie(ctx, await createSession(userId));
      sendJson(ctx, 201, {
        user: publicUser({
          id: userId,
          email: email.trim(),
          email_lower: emailLower,
          display_name: displayName.trim(),
          verified: true,
        }),
      });
      return;
    }

    const token = newToken();
    try {
      await withTransaction(async (client) => {
        await client.query(
          `insert into users (id, email, email_lower, display_name, password_hash, notebook_use, verified)
           values ($1, $2, $3, $4, $5, $6, false)`,
          [userId, email.trim(), emailLower, displayName.trim(), hashPassword(password), use === '' ? null : use],
        );
        await client.query(`insert into verification_tokens (token, user_id) values ($1, $2)`, [token, userId]);
        await sendMail(verificationMessage(email.trim(), token));
      });
    } catch (error) {
      if (error instanceof MailFailure) throw mailUnavailable();
      throw error;
    }
    sendJson(ctx, 201, {
      user: publicUser({
        id: userId,
        email: email.trim(),
        email_lower: emailLower,
        display_name: displayName.trim(),
        verified: false,
      }),
    });
  });

  route('POST', '/api/auth/verify', async (ctx: Ctx) => {
    const body = await readJsonBody(ctx);
    const token = text(body, 'token');
    const row = await queryOne<{ user_id: string }>(
      `update verification_tokens set used = true
        where token = $1 and used = false returning user_id`,
      [token],
    );
    if (!row) throw validationFailed([{ path: 'token', message: 'is not valid' }]);
    const user = await queryOne<UserRow>(
      `update users set verified = true where id = $1
        returning id, email, email_lower, display_name, verified`,
      [row.user_id],
    );
    if (!user) throw validationFailed([{ path: 'token', message: 'is not valid' }]);
    sendJson(ctx, 200, { user: publicUser(user) });
  });

  route('POST', '/api/auth/signin', async (ctx: Ctx) => {
    const body = await readJsonBody(ctx);
    const emailLower = text(body, 'email').trim().toLowerCase();
    const password = text(body, 'password');
    const found = await queryOne<UserRow & { password_hash: string }>(
      `select id, email, email_lower, display_name, verified, password_hash
         from users where email_lower = $1`,
      [emailLower],
    );
    if (!found || !passwordMatches(password, found.password_hash)) throw invalidCredentials();
    if (!found.verified) throw emailNotVerified();
    setSessionCookie(ctx, await createSession(found.id));
    sendJson(ctx, 200, { user: publicUser(found) });
  });

  route('POST', '/api/auth/signout', async (ctx: Ctx) => {
    const sessionId = ctx.cookies.bp_session;
    if (sessionId) await query(`delete from sessions where id = $1`, [sessionId]);
    clearSessionCookie(ctx);
    sendEmpty(ctx, 204);
  });

  route('POST', '/api/invitations/:token/accept', async (ctx: Ctx) => {
    const user = await requireUser(ctx);
    const invitation = await invitationByToken(ctx.params.token);
    if (!invitation) throw notFound();
    if (invitation.email_lower !== user.email_lower) throw invitationForAnotherAccount();
    if (invitation.status !== 'active') await acceptInvitation(invitation, user.id);
    sendJson(ctx, 200, { notebook_id: invitation.notebook_id });
  });

  route('GET', '/api/invitations/:token', async (ctx: Ctx) => {
    const invitation = await invitationByToken(ctx.params.token);
    if (!invitation) throw notFound();
    const account = await queryOne<{ id: string }>(`select id from users where email_lower = $1`, [
      invitation.email_lower,
    ]);
    sendJson(ctx, 200, {
      email: invitation.email,
      role: invitation.role,
      notebook_title: invitation.notebook_title,
      owner_display_name: invitation.owner_display_name,
      account_exists: account !== null,
    });
  });
}

import { query, transaction } from '../../db';
import { config, limits } from '../../config';
import { apiError, validation } from '../../errors';
import { isoSecond } from '../../format';
import { hashPassword, randomId, verifyPassword } from '../../crypto/seal';
import { header, nowSecond, onlyFields, readJsonBody, requireXRequestedWith, sendJson } from '../core';
import { appendAuditForUser } from '../../domain/audit';
import { createSession, deviceName, sessionCookie } from '../../domain/sessions';
import { checkSignInThrottle, clearSignInFailures, recordSignInFailure } from '../../domain/throttle';
import { findInviteByToken, inviteState, isValidName, isValidNewPassword, nameMessage, passwordMessage } from '../../domain/members';
import { loadMemberships } from '../../domain/auth';
import type { Router } from '../router';

export function registerInviteRoutes(router: Router): void {
  router.get('/api/invites/:token', async (ctx) => {
    const invite = await transaction(async (client) => findInviteByToken(client, ctx.params.token));
    if (!invite || invite.state === 'replaced' || invite.state === 'accepted') throw apiError('not_found');
    if (inviteState(invite) === 'expired') throw apiError('invite_expired', 'This invite has expired.');
    const workspace = await query<{ slug: string; name: string }>('select slug, name from workspaces where slug = $1', [
      invite.workspace_slug,
    ]);
    const existing = await query<{ id: string }>('select id from users where lower(email) = lower($1)', [invite.email]);
    sendJson(ctx, 200, {
      workspace: { slug: workspace[0].slug, name: workspace[0].name },
      email: invite.email,
      role: invite.role,
      expires_at: isoSecond(invite.expires_at),
      existing_account: existing.length > 0,
    });
  });

  router.post('/api/invites/:token/accept', async (ctx) => {
    const body = await readJsonBody(ctx, limits.jsonBody);
    const extra = onlyFields(body, ['name', 'password']);
    if (Object.keys(extra).length > 0) throw validation(extra);
    requireXRequestedWith(ctx);
    const invite = await transaction(async (client) => findInviteByToken(client, ctx.params.token));
    if (!invite || invite.state === 'replaced' || invite.state === 'accepted') throw apiError('not_found');
    if (inviteState(invite) === 'expired') throw apiError('invite_expired', 'This invite has expired.');
    const existing = await query<{ id: string; name: string; email: string; password_hash: string; is_operator: boolean; two_step_state: string }>(
      'select id, name, email, password_hash, is_operator, two_step_state from users where lower(email) = lower($1)',
      [invite.email],
    );
    if (typeof body.password !== 'string') throw validation({ password: passwordMessage });
    if (existing.length > 0) {
      await checkSignInThrottle(invite.email);
      if (!verifyPassword(body.password, existing[0].password_hash)) {
        await recordSignInFailure(invite.email);
        throw apiError('invalid_credentials', "That password doesn't match your Farshore account.");
      }
    } else if (!isValidNewPassword(body.password)) {
      throw validation({ password: passwordMessage });
    }
    if (existing.length === 0 && !isValidName(body.name)) throw validation({ name: nameMessage });

    const result = await transaction(async (client) => {
      const userId = existing.length > 0 ? existing[0].id : randomId('usr');
      if (existing.length === 0) {
        await client.query(
          `insert into users (id, name, email, password_hash, is_operator, two_step_state)
           values ($1, $2, $3, $4, false, 'off')`,
          [userId, body.name as string, invite.email, hashPassword(body.password as string)],
        );
      }
      await client.query('insert into memberships (workspace_slug, user_id, role) values ($1, $2, $3) on conflict do nothing', [
        invite.workspace_slug,
        userId,
        invite.role,
      ]);
      await client.query("update invites set state = 'accepted' where id = $1", [invite.id]);
      await appendAuditForUser(client, userId, {
        actor: invite.email,
        action: 'invite.accepted',
        target: invite.email,
        detail: invite.role,
      });
      const enrolled = existing.length > 0 && existing[0].two_step_state === 'on';
      const session = await createSession(client, userId, {
        device: deviceName(header(ctx, 'user-agent')),
        state: enrolled ? 'pending' : 'active',
      });
      if (!enrolled) {
        await appendAuditForUser(client, userId, {
          actor: invite.email,
          action: 'session.signed_in',
          target: invite.email,
          detail: 'password',
        });
      }
      return { userId, enrolled, session };
    });
    await clearSignInFailures(invite.email);
    if (result.enrolled) {
      sendJson(
        ctx,
        202,
        { two_step: 'required', expires_at: isoSecond(new Date(nowSecond().getTime() + config.timing.twoStepPending * 1000)) },
        { 'Set-Cookie': sessionCookie(result.session.token) },
      );
      return;
    }
    const user = await query<{ id: string; name: string; email: string; is_operator: boolean }>(
      'select id, name, email, is_operator from users where id = $1',
      [result.userId],
    );
    const memberships = await loadMemberships(result.userId);
    sendJson(
      ctx,
      201,
      {
        user: { id: user[0].id, name: user[0].name, email: user[0].email, operator: user[0].is_operator === true },
        memberships: memberships.map((membership) => ({
          workspace: { slug: membership.slug, name: membership.name },
          role: membership.role,
        })),
      },
      { 'Set-Cookie': sessionCookie(result.session.token) },
    );
  });
}

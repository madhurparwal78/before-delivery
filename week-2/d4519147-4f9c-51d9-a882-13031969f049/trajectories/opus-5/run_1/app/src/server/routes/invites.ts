import { isPlainText } from '../../shared/validate';
import { hashPassword, newId } from '../crypto';
import { query, queryOne, withTransaction } from '../db';
import { HttpError, errors } from '../http/errors';
import type { Ctx, Params, Reply, Route } from '../http/router';
import { writeDiagramEvent } from '../domain/audit';
import { createSession, resolveSession, sessionCookieHeader } from '../domain/sessions';
import { inviteLookupState, lookupInviteToken, recordInviteLookupFailure } from '../domain/shares';

async function assertLookupAllowed(ip: string): Promise<void> {
  const state = await inviteLookupState(ip);
  if (state.limited) {
    throw errors.rateLimited('invite_lookup_limited', 'Too many attempts.', state.retryAfterSeconds);
  }
}

async function readInvite(ctx: Ctx, params: Params): Promise<Reply> {
  await assertLookupAllowed(ctx.ip);
  const invite = await lookupInviteToken(params.token ?? '');
  if (!invite || (invite.status !== 'invited' && invite.status !== 'expired')) {
    await recordInviteLookupFailure(ctx.ip);
    throw errors.notFound();
  }
  if (invite.status === 'expired') {
    await recordInviteLookupFailure(ctx.ip);
    throw errors.gone('invite_expired', 'This invitation has expired.');
  }
  return {
    status: 200,
    body: {
      invite: {
        diagramTitle: invite.diagramTitle,
        inviterName: invite.inviterName,
        role: invite.role,
        email: invite.email,
        accountExists: invite.accountExists,
      },
    },
  };
}

async function acceptInvite(ctx: Ctx, params: Params): Promise<Reply> {
  await assertLookupAllowed(ctx.ip);
  const token = params.token ?? '';
  const invite = await lookupInviteToken(token);
  if (!invite || (invite.status !== 'invited' && invite.status !== 'expired')) {
    await recordInviteLookupFailure(ctx.ip);
    throw errors.notFound();
  }
  if (invite.status === 'expired') {
    await recordInviteLookupFailure(ctx.ip);
    throw errors.gone('invite_expired', 'This invitation has expired.');
  }

  const lookup = await resolveSession(ctx.cookieValue);
  const signedInEmail = lookup.state === 'active' ? lookup.session.user.email.toLowerCase() : null;
  if (signedInEmail && signedInEmail !== invite.email) {
    throw new HttpError(403, 'invite_email_mismatch', 'This invitation was sent to a different email address.');
  }

  let userId: string;
  let newSessionCookie: string | null = null;
  if (signedInEmail && lookup.state === 'active') {
    userId = lookup.session.user.id;
  } else {
    if (invite.accountExists) throw errors.unauthenticated();
    const body = typeof ctx.json === 'object' && ctx.json !== null ? (ctx.json as Record<string, unknown>) : {};
    const displayName = typeof body.displayName === 'string' ? body.displayName : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const fields: Record<string, string> = {};
    if (!isPlainText(displayName, 1, 80)) fields.displayName = 'invalid';
    if (password.length < 12 || password.length > 128) fields.password = 'length';
    if (Object.keys(fields).length > 0) throw errors.validation(fields);
    userId = newId();
    const passwordHash = await hashPassword(password);
    await query('insert into users (id, email, display_name, password_hash) values ($1, $2, $3, $4)', [
      userId,
      invite.email,
      displayName.trim(),
      passwordHash,
    ]);
    const created = await createSession(userId, ctx.cookieValue);
    newSessionCookie = sessionCookieHeader(created.cookieValue);
  }

  const accepted = await withTransaction(async (client) => {
    const result = await client.query(
      `update shares set status = 'active', token_hash = null, expires_at = null, updated_at = now()
       where id = $1 and status = 'invited'`,
      [invite.id],
    );
    if (result.rowCount !== 1) return false;
    await writeDiagramEvent(client, invite.diagramId, invite.email, 'share.accepted', {
      email: invite.email,
      role: invite.role,
    });
    return true;
  });
  if (!accepted) {
    await recordInviteLookupFailure(ctx.ip);
    throw errors.notFound();
  }

  const firstPage = await queryOne<{ id: string }>(
    'select id from pages where diagram_id = $1 order by seq limit 1',
    [invite.diagramId],
  );
  const reply: Reply = {
    status: 200,
    body: { diagramId: invite.diagramId, firstPageId: firstPage?.id ?? null, role: invite.role },
  };
  if (newSessionCookie) reply.setCookie = newSessionCookie;
  return reply;
}

export const inviteRoutes: Route[] = [
  { method: 'GET', pattern: '/api/invites/:token', auth: false, handler: readInvite },
  {
    method: 'POST',
    pattern: '/api/invites/:token/accept',
    auth: false,
    body: 'json',
    csrf: 'session-only',
    handler: acceptInvite,
  },
];

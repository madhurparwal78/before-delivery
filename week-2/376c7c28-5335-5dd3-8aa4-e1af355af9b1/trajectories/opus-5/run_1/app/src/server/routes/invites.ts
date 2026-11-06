import { createSession, sessionCookie } from '../auth.ts';
import { now } from '../clock.ts';
import { config } from '../config.ts';
import { first, lockAll, lockKey, pool, transaction } from '../db/pool.ts';
import { publish } from '../events.ts';
import { ApiError, ValidationBag } from '../http/errors.ts';
import { V } from '../http/messages.ts';
import { safeParam } from '../http/pipeline.ts';
import { queueEmail } from '../money.ts';
import { hashPassword, newId, randomToken } from '../security.ts';
import { userBody } from './session.ts';
import type { Actor, Route, RouteResult } from '../http/context.ts';
import { Ctx } from '../http/context.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const HANDLE_RE = /^[a-z0-9-]{3,24}$/;

interface InviteRow {
  readonly id: string;
  readonly studio_id: string;
  readonly token: string;
  readonly email: string;
  readonly email_lower: string;
  readonly role: 'kiln_tech' | 'member';
  readonly membership: 'member' | 'drop_off' | null;
  readonly expires_at: Date;
  readonly used_at: Date | null;
  readonly retired_at: Date | null;
  readonly studio_name: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

async function resolveInvite(ctx: Ctx): Promise<void> {
  const token = safeParam(ctx, 'token');
  const invite = await first<InviteRow>(
    pool,
    `select i.id, i.studio_id, i.token, i.email, i.email_lower, i.role, i.membership,
            i.expires_at, i.used_at, i.retired_at, s.name as studio_name
       from invites i join studios s on s.id = i.studio_id
      where i.token = $1`,
    [token],
  );
  if (!invite) throw new ApiError('not_found', 'This invite link is not valid.');
  if (invite.used_at || invite.retired_at || invite.expires_at.getTime() <= now().getTime()) {
    throw new ApiError('invite_gone', 'This invite has expired or was already used.');
  }
  ctx.store['invite'] = invite;
}

function invited(ctx: Ctx): InviteRow {
  return ctx.store['invite'] as InviteRow;
}

async function createInvite(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  const email = text(ctx.json['email']).trim();
  const role = text(ctx.json['role']);
  const membership = text(ctx.json['membership']);
  const bag = new ValidationBag();
  if (email === '' || email.length > 200 || !EMAIL_RE.test(email)) bag.add('email', V.email);
  if (role !== 'kiln_tech' && role !== 'member') bag.add('role', V.role);
  if (role === 'member' && membership !== 'member' && membership !== 'drop_off') {
    bag.add('membership', V.role);
  }
  bag.throwIfAny();
  const emailLower = email.toLowerCase();

  const created = await transaction(async (client) => {
    await lockAll(client, [lockKey('invite', `${actor.studio.id}|${emailLower}`)]);
    const existing = await first<{ role: string; active: boolean }>(
      client,
      'select role, active from people where studio_id = $1 and email_lower = $2',
      [actor.studio.id, emailLower],
    );
    if (existing && !existing.active) {
      throw new ApiError('member_inactive', `${email} is not active in this studio.`);
    }
    if (existing) throw new ApiError('already_member', `${email} is already in this studio.`);

    await client.query(
      `update invites set retired_at = $3
        where studio_id = $1 and email_lower = $2 and used_at is null and retired_at is null`,
      [actor.studio.id, emailLower, now()],
    );
    const id = newId();
    const token = randomToken();
    const expires = new Date(now().getTime() + config.inviteTtlSeconds * 1_000);
    await client.query(
      `insert into invites (id, studio_id, token, email, email_lower, role, membership,
                            created_at, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        actor.studio.id,
        token,
        email,
        emailLower,
        role,
        role === 'member' ? membership : null,
        now(),
        expires,
      ],
    );
    await queueEmail(
      client,
      actor.studio.id,
      email,
      `Join ${actor.studio.name} on Kiln Desk`,
      [
        `You are invited to join ${actor.studio.name} on Kiln Desk.`,
        `Open this link to choose your name, studio handle and password:`,
        `http://${ctx.host}/invite/${token}`,
      ].join('\n'),
    );
    await publish(client, { kind: 'invite', id, studio_id: actor.studio.id });
    return {
      id,
      email,
      role,
      membership: role === 'member' ? membership : null,
      expires_at: expires.toISOString(),
    };
  });
  return { status: 201, body: created };
}

async function acceptInvite(ctx: Ctx): Promise<RouteResult> {
  const invite = invited(ctx);
  const name = text(ctx.json['name']).trim();
  const handle = text(ctx.json['handle']).trim();
  const password = text(ctx.json['password']);
  const bag = new ValidationBag();
  if (name.length < 1 || name.length > 80) bag.add('name', V.name);
  if (!HANDLE_RE.test(handle)) bag.add('handle', V.handleShape);
  if (password.length < 10 || password.length > 128) bag.add('password', V.password);
  bag.throwIfAny();

  const passwordHash = await hashPassword(password);
  const outcome = await transaction(async (client) => {
    await lockAll(client, [lockKey('invite-token', invite.token)]);
    const fresh = await first<{ used_at: Date | null; retired_at: Date | null; expires_at: Date }>(
      client,
      'select used_at, retired_at, expires_at from invites where id = $1 for update',
      [invite.id],
    );
    if (!fresh || fresh.used_at || fresh.retired_at || fresh.expires_at.getTime() <= now().getTime()) {
      throw new ApiError('invite_gone', 'This invite has expired or was already used.');
    }
    const taken = await first<{ id: string }>(
      client,
      'select id from people where studio_id = $1 and handle = $2',
      [invite.studio_id, handle],
    );
    if (taken) {
      const bagged = new ValidationBag();
      bagged.add('handle', V.handleTaken);
      bagged.throwIfAny();
    }
    const personId = newId();
    await client.query(
      `insert into people (id, studio_id, name, handle, email, email_lower, role, membership,
                           card_status, active, password_hash, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'none',true,$9,$10)`,
      [
        personId,
        invite.studio_id,
        name,
        handle,
        invite.email,
        invite.email_lower,
        invite.role,
        invite.role === 'member' ? invite.membership : null,
        passwordHash,
        now(),
      ],
    );
    await client.query('update invites set used_at = $2 where id = $1', [invite.id, now()]);
    const sessionId = await createSession(client, invite.studio_id, personId);
    await publish(client, { kind: 'member', id: personId, studio_id: invite.studio_id });
    return { personId, sessionId };
  });

  const studio = (await first<{
    id: string;
    slug: string;
    name: string;
    time_zone: string;
    pickup_window_days: number;
    storage_fee_cents: number;
  }>(
    pool,
    'select id, slug, name, time_zone, pickup_window_days, storage_fee_cents from studios where id = $1',
    [invite.studio_id],
  )) as {
    id: string;
    slug: string;
    name: string;
    time_zone: string;
    pickup_window_days: number;
    storage_fee_cents: number;
  };
  const actor: Actor = {
    sessionId: outcome.sessionId,
    personId: outcome.personId,
    role: invite.role,
    membership: invite.role === 'member' ? invite.membership : null,
    name,
    handle,
    email: invite.email,
    studio,
  };
  return {
    status: 201,
    body: userBody(actor),
    setSession: sessionCookie(outcome.sessionId, ctx.header('x-forwarded-proto') === 'https'),
  };
}

export const inviteRoutes: readonly Route[] = [
  { method: 'POST', pattern: '/api/invites', role: 'owner', handle: createInvite },
  {
    method: 'GET',
    pattern: '/api/invites/:token',
    role: 'anyone',
    resolve: resolveInvite,
    handle: async (ctx) => {
      const invite = invited(ctx);
      return {
        status: 200,
        body: { studio_name: invite.studio_name, email: invite.email, role: invite.role },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/invites/:token/accept',
    role: 'anyone',
    resolve: resolveInvite,
    handle: acceptInvite,
  },
];

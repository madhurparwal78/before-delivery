import { clearedCookie, createSession, endSession, sessionCookie } from '../auth.ts';
import { now } from '../clock.ts';
import { config } from '../config.ts';
import { first, lockAll, lockKey, rows, transaction } from '../db/pool.ts';
import { ApiError } from '../http/errors.ts';
import { verifyPassword } from '../security.ts';
import type { Actor, Route, RouteResult } from '../http/context.ts';
import { Ctx } from '../http/context.ts';

export function userBody(actor: Actor): Record<string, unknown> {
  return {
    user: {
      id: actor.personId,
      name: actor.name,
      handle: actor.handle,
      role: actor.role,
      studio: {
        slug: actor.studio.slug,
        name: actor.studio.name,
        time_zone: actor.studio.time_zone,
      },
    },
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

interface CandidateRow {
  readonly id: string;
  readonly studio_id: string;
  readonly password_hash: string;
  readonly active: boolean;
  readonly name: string;
  readonly handle: string;
  readonly email: string;
  readonly role: 'owner' | 'kiln_tech' | 'member';
  readonly membership: 'member' | 'drop_off' | null;
  readonly slug: string;
  readonly studio_name: string;
  readonly time_zone: string;
  readonly pickup_window_days: number;
  readonly storage_fee_cents: number;
}

function secure(ctx: Ctx): boolean {
  return ctx.header('x-forwarded-proto') === 'https';
}

async function signIn(ctx: Ctx): Promise<RouteResult> {
  const slug = text(ctx.json['studio']).trim().toLowerCase();
  const email = text(ctx.json['email']).trim().toLowerCase();
  const password = text(ctx.json['password']);
  const pairLock = lockKey('signin', `${slug}|${email}`);
  const windowStart = new Date(now().getTime() - config.signinLockSeconds * 1_000);

  // The decision is reached inside the transaction so the failure count commits with it, and
  // the refusal is raised afterwards.
  type Attempt =
    | { kind: 'locked'; minutes: number }
    | { kind: 'invalid' }
    | { kind: 'inactive' }
    | { kind: 'signed_in'; candidate: CandidateRow; sessionId: string };

  const attempt = await transaction<Attempt>(async (client) => {
    await lockAll(client, [pairLock]);
    await client.query('delete from signin_failures where at < $1', [windowStart]);
    const failures = await rows<{ at: Date }>(
      client,
      'select at from signin_failures where studio_slug = $1 and email_lower = $2 order by at',
      [slug, email],
    );
    if (failures.length >= 5) {
      const fifth = failures[4] as { at: Date };
      const until = fifth.at.getTime() + config.signinLockSeconds * 1_000;
      return { kind: 'locked', minutes: Math.max(1, Math.ceil((until - now().getTime()) / 60_000)) };
    }
    const candidate = await first<CandidateRow>(
      client,
      `select p.id, p.studio_id, p.password_hash, p.active, p.name, p.handle, p.email, p.role,
              p.membership, s.slug, s.name as studio_name, s.time_zone, s.pickup_window_days,
              s.storage_fee_cents
         from people p join studios s on s.id = p.studio_id
        where s.slug = $1 and p.email_lower = $2`,
      [slug, email],
    );
    const good = candidate ? await verifyPassword(password, candidate.password_hash) : false;
    if (!candidate || !good) {
      await client.query(
        'insert into signin_failures (studio_slug, email_lower, at) values ($1,$2,$3)',
        [slug, email, now()],
      );
      return { kind: 'invalid' };
    }
    if (!candidate.active) return { kind: 'inactive' };
    await client.query('delete from signin_failures where studio_slug = $1 and email_lower = $2', [
      slug,
      email,
    ]);
    const sessionId = await createSession(client, candidate.studio_id, candidate.id);
    return { kind: 'signed_in', candidate, sessionId };
  });

  if (attempt.kind === 'locked') {
    throw new ApiError(
      'too_many_attempts',
      `Too many sign-in attempts. Try again in ${attempt.minutes} minutes.`,
    );
  }
  if (attempt.kind === 'invalid') throw new ApiError('invalid_credentials');
  if (attempt.kind === 'inactive') throw new ApiError('account_inactive');
  const outcome = attempt;

  const actor: Actor = {
    sessionId: outcome.sessionId,
    personId: outcome.candidate.id,
    role: outcome.candidate.role,
    membership: outcome.candidate.membership,
    name: outcome.candidate.name,
    handle: outcome.candidate.handle,
    email: outcome.candidate.email,
    studio: {
      id: outcome.candidate.studio_id,
      slug: outcome.candidate.slug,
      name: outcome.candidate.studio_name,
      time_zone: outcome.candidate.time_zone,
      pickup_window_days: outcome.candidate.pickup_window_days,
      storage_fee_cents: outcome.candidate.storage_fee_cents,
    },
  };
  return {
    status: 200,
    body: userBody(actor),
    setSession: sessionCookie(outcome.sessionId, secure(ctx)),
  };
}

export const sessionRoutes: readonly Route[] = [
  { method: 'POST', pattern: '/api/session', role: 'anyone', handle: signIn },
  {
    method: 'GET',
    pattern: '/api/me',
    role: 'signed_in',
    handle: async (ctx) => ({ status: 200, body: userBody(ctx.actorOrFail) }),
  },
  {
    method: 'DELETE',
    pattern: '/api/session',
    role: 'signed_in',
    handle: async (ctx) => {
      const actor = ctx.actorOrFail;
      await endSession(actor.sessionId, actor.studio.id);
      return { status: 204, clearSession: true, setSession: clearedCookie(secure(ctx)) };
    },
  },
];

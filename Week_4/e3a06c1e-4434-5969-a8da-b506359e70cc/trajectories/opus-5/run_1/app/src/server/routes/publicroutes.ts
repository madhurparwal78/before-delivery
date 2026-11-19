import { randomUUID } from 'node:crypto';
import {
  clearedCookieHeader,
  createAuthSession,
  destroyAuthSession,
  hashPassword,
  landingRoute,
  requireActor,
  SESSION_COOKIE,
  sessionCookieHeader,
  verifyPassword,
  visibleProjectIds,
} from '../auth.js';
import { query, queryOne } from '../db/pool.js';
import { demoSpectrum } from '../demo.js';
import { toneFixture } from '../domain/audio.js';
import { ApiError, notFound } from '../http/errors.js';
import { bytes, empty, json, type Reply, type Router } from '../http/router.js';
import { FieldErrors } from '../http/validate.js';
import { fieldCopy } from '../../shared/copy.js';
import { checkEmail, checkPassword, checkText } from '../../shared/text.js';
import type { Role } from '../../shared/types.js';

const teams = ['contact_centre', 'clinical_dictation'] as const;
const roles: readonly Role[] = ['admin', 'developer', 'reviewer', 'approver', 'billing'];

export const isRole = (value: unknown): value is Role => roles.includes(value as Role);

interface TrialRow {
  id: string;
  received_at: Date;
}

const trialRequest = async (body: Record<string, unknown>): Promise<Reply> => {
  const fields = new FieldErrors();
  const name = checkText(body.name, 1, 100);
  if (!name.ok) fields.add('name', fieldCopy.trialName);
  const email = checkEmail(body.email);
  if (!email.ok) fields.add('email', fieldCopy.trialEmail);
  const company = checkText(body.company, 1, 100);
  if (!company.ok) fields.add('company', fieldCopy.trialCompany);
  if (!teams.includes(body.team as (typeof teams)[number])) fields.add('team', fieldCopy.trialTeam);
  fields.raiseIfAny();

  const existing = await queryOne<TrialRow>('select id, received_at from trial_requests where lower(email) = lower($1)', [
    email.value,
  ]);
  if (existing !== null) return json(200, { id: existing.id, received_at: existing.received_at.toISOString() });

  const inserted = await query<TrialRow>(
    `insert into trial_requests (id, name, email, company, team) values ($1, $2, $3, $4, $5)
     on conflict (lower(email)) do nothing returning id, received_at`,
    [randomUUID(), name.value, email.value, company.value, body.team as string],
  );
  const row = inserted[0];
  if (row !== undefined) return json(201, { id: row.id, received_at: row.received_at.toISOString() });
  const replayed = await queryOne<TrialRow>(
    'select id, received_at from trial_requests where lower(email) = lower($1)',
    [email.value],
  );
  if (replayed === null) throw new ApiError(500, 'internal_error', 'Something went wrong. Try again.');
  return json(200, { id: replayed.id, received_at: replayed.received_at.toISOString() });
};

interface SignInRow {
  id: string;
  org_id: string;
  name: string;
  email: string;
  role: Role;
  password_hash: string;
}

interface InvitationRow {
  id: string;
  org_id: string;
  name: string;
  email: string;
  role: Role;
  project_ids: string[];
  used: boolean;
}

export const registerPublicRoutes = (router: Router): void => {
  router.add('GET', '/api/health', async () => json(200, { status: 'ok' }));

  router.add('GET', '/api/public/demo-spectrum', async () => json(200, demoSpectrum()));

  router.add('GET', '/fixtures/tone-1khz.wav', async () => bytes(200, toneFixture(), 'audio/wav'));

  router.add('POST', '/api/trial-requests', async (ctx) => trialRequest(ctx.body), 'json');

  /** Sign-in never answers 422: any missing or wrong value answers 401. */
  router.add('POST', '/api/auth/sign-in', async (ctx) => {
    const body = ctx.body;
    const invalid = new ApiError(401, 'invalid_credentials', "That email and password don't match.");
    if (typeof body.email !== 'string' || typeof body.password !== 'string') throw invalid;
    const member = await queryOne<SignInRow>(
      'select id, org_id, name, email, role, password_hash from members where lower(email) = lower($1)',
      [body.email.trim()],
    );
    if (member === null) throw invalid;
    if (!(await verifyPassword(body.password, member.password_hash))) throw invalid;
    const token = await createAuthSession(member.id);
    return json(
      200,
      {
        user: { id: member.id, name: member.name, email: member.email, role: member.role, org_id: member.org_id },
        landing: landingRoute(member.role),
      },
      { 'set-cookie': sessionCookieHeader(token) },
    );
  }, 'json');

  router.add('POST', '/api/auth/sign-out', async (ctx) => {
    await requireActor(ctx);
    const token = ctx.cookies[SESSION_COOKIE];
    if (token !== undefined) await destroyAuthSession(token);
    return empty(204, { 'set-cookie': clearedCookieHeader() });
  });

  router.add('GET', '/api/me', async (ctx) => {
    const actor = await requireActor(ctx);
    return json(200, {
      user: {
        id: actor.member.id,
        name: actor.member.name,
        email: actor.member.email,
        role: actor.member.role,
        org_id: actor.org.id,
      },
      org: { id: actor.org.id, name: actor.org.name, slug: actor.org.slug, plan: actor.org.plan },
      project_ids: await visibleProjectIds(actor),
    });
  });

  router.add('POST', '/api/invitations/:token/accept', async (ctx) => {
    const body = ctx.body;
    const invitation = await queryOne<InvitationRow>(
      'select id, org_id, name, email, role, project_ids, used from invitations where token = $1',
      [ctx.params.token as string],
    );
    if (invitation === null) throw notFound();
    if (invitation.used) throw new ApiError(410, 'invitation_used', 'This invitation has already been used.');
    const fields = new FieldErrors();
    if (!checkPassword(body.password)) fields.add('password', fieldCopy.password);
    fields.raiseIfAny();

    const memberId = randomUUID();
    const claimed = await query<{ id: string }>(
      'update invitations set used = true where id = $1 and used = false returning id',
      [invitation.id],
    );
    if (claimed.length === 0) throw new ApiError(410, 'invitation_used', 'This invitation has already been used.');
    await query(
      'insert into members (id, org_id, name, email, role, password_hash) values ($1, $2, $3, $4, $5, $6)',
      [
        memberId,
        invitation.org_id,
        invitation.name,
        invitation.email,
        invitation.role,
        await hashPassword(body.password as string),
      ],
    );
    for (const projectId of invitation.project_ids)
      await query(
        'insert into member_projects (member_id, project_id) values ($1, $2) on conflict do nothing',
        [memberId, projectId],
      );
    const token = await createAuthSession(memberId);
    return json(
      201,
      {
        user: {
          id: memberId,
          name: invitation.name,
          email: invitation.email,
          role: invitation.role,
          org_id: invitation.org_id,
        },
        landing: landingRoute(invitation.role),
      },
      { 'set-cookie': sessionCookieHeader(token) },
    );
  }, 'json');
};

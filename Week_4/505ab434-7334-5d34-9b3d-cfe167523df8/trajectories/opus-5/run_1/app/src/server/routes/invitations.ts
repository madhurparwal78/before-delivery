import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { db, withTransaction } from '../db.js';
import { errors } from '../errors.js';
import { jsonBody, requireSignedIn, type Ctx } from '../http/context.js';
import { sendJson } from '../http/respond.js';
import { enqueueMail } from '../mail.js';
import { hashPassword } from '../passwords.js';
import { repo } from '../repo.js';
import { notices } from '../services/notices.js';
import { createSession, sessionCookie } from './session.js';
import type { Role } from '../../shared/types.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface InvitationRow {
  id: string;
  token: string;
  email: string;
  display_name: string;
  role: string;
  organisation_id: string;
  expires_at: Date;
  used_at: Date | null;
}

export async function createInvitation(ctx: Ctx): Promise<void> {
  const principal = requireSignedIn(ctx);
  if (principal.role !== 'owner') throw errors.forbidden();

  const body = jsonBody<{ email?: string; displayName?: string; role?: Role; organisationId?: string }>(ctx);
  const email = (body.email ?? '').trim();
  const displayName = (body.displayName ?? '').trim();
  const role = body.role === 'press' ? 'press' : 'agency';
  const organisationId = body.organisationId ?? '';

  const organisation = await repo.organisation(organisationId);
  if (!organisation) throw errors.notFound();

  const existing = await repo.principalByEmail(email);
  if (existing) throw errors.alreadyRegistered(email);
  if (!EMAIL_PATTERN.test(email)) throw errors.emailInvalid();

  const id = `inv_${randomBytes(6).toString('hex')}`;
  const token = randomBytes(24).toString('hex');
  const expiresAt = new Date(ctx.now.getTime() + config.inviteTtlHours * 3_600_000);

  await withTransaction(async (tx) => {
    await tx.query(
      `insert into invitations (id, token, email, display_name, role, organisation_id, created_at, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, token, email, displayName, role, organisationId, ctx.now, expiresAt],
    );
    await enqueueMail(tx, notices.invitation(email, token, expiresAt), ctx.now);
  });

  sendJson(ctx.res, 201, { id, email, expiresAt: expiresAt.toISOString() });
}

async function loadInvitation(token: string, now: Date): Promise<InvitationRow> {
  const result = await db.query<InvitationRow>('select * from invitations where token = $1', [token]);
  const invitation = result.rows[0];
  if (!invitation || invitation.used_at !== null || invitation.expires_at.getTime() <= now.getTime()) {
    throw errors.invitationInvalid();
  }
  return invitation;
}

export async function readInvitation(ctx: Ctx): Promise<void> {
  const invitation = await loadInvitation(ctx.params['token'] ?? '', ctx.now);
  sendJson(ctx.res, 200, { email: invitation.email, displayName: invitation.display_name });
}

export async function activateInvitation(ctx: Ctx): Promise<void> {
  const invitation = await loadInvitation(ctx.params['token'] ?? '', ctx.now);
  const body = jsonBody<{ password?: string }>(ctx);
  const password = body.password ?? '';
  if (password.length < 12) throw errors.weakPassword();

  const principalId = `usr_${randomBytes(6).toString('hex')}`;
  await withTransaction(async (tx) => {
    const sort = await tx.query<{ next: number }>('select coalesce(max(sort), 0) + 1 as next from principals');
    await tx.query(
      `insert into principals (id, email, display_name, role, password_hash, organisation_id, sort)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        principalId,
        invitation.email,
        invitation.display_name,
        invitation.role,
        hashPassword(password),
        invitation.organisation_id,
        sort.rows[0]!.next,
      ],
    );
    await tx.query('update invitations set used_at = $1 where id = $2', [ctx.now, invitation.id]);
  });

  const sessionId = await createSession(principalId);
  ctx.res.setHeader('set-cookie', sessionCookie(sessionId));
  sendJson(ctx.res, 200, {
    principal: {
      id: principalId,
      displayName: invitation.display_name,
      role: invitation.role,
      organisationId: invitation.organisation_id,
    },
  });
}

export async function listOrganisations(ctx: Ctx): Promise<void> {
  const principal = requireSignedIn(ctx);
  const all = await repo.organisations();
  const visible = principal.role === 'owner' ? all : all.filter((candidate) => candidate.id === principal.organisationId);
  sendJson(ctx.res, 200, {
    organisations: visible.map((organisation) => ({
      id: organisation.id,
      name: organisation.name,
      kind: organisation.kind,
      engagement: {
        startsOn: organisation.engagementStartsOn,
        endsOn: organisation.engagementEndsOn,
        territories: organisation.territories,
      },
    })),
  });
}

export async function setEngagementEnd(ctx: Ctx): Promise<void> {
  const principal = requireSignedIn(ctx);
  const organisation = await repo.organisation(ctx.params['id'] ?? '');
  if (!organisation) throw errors.notFound();
  if (principal.role !== 'owner') throw errors.forbidden();

  const body = jsonBody<{ endsOn?: string }>(ctx);
  const endsOn = body.endsOn ?? '';
  await db.query('update organisations set engagement_ends_on = $1 where id = $2', [endsOn, organisation.id]);
  const updated = await repo.organisation(organisation.id);

  sendJson(ctx.res, 200, {
    id: updated!.id,
    engagement: {
      startsOn: updated!.engagementStartsOn,
      endsOn: updated!.engagementEndsOn,
      territories: updated!.territories,
    },
  });
}

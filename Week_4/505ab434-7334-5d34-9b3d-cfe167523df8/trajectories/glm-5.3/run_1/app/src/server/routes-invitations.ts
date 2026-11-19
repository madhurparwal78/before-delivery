import type { Ctx, Method } from './http';
import { requireSession } from './http';
import { alreadyRegistered, emailInvalid, forbidden, invitationInvalid, notFound, unauthenticated, weakPassword } from './errors';
import { hashPassword, randomToken, sha256 } from './crypto';
import { createSession, cookieHeader } from './sessions';
import { queueMail, invitationMail } from './mail';
import { validateEmail } from './principals';
import { readClock, writeClock } from './clock';
import type { Config } from './config';
import { query, withTransaction } from './db';
import { isRole } from '../shared/domain';
import { created } from './created';

export function routeInvitations(router: { add: (m: Method, p: string, h: (ctx: Ctx) => Promise<unknown>) => void }, cfg: Config): void {
  router.add('POST', '/invitations', async (ctx) => {
    const principal = requireSession(ctx);
    if (principal.role !== 'owner') {
      if (!principal) throw unauthenticated();
      throw forbidden();
    }
    const body = asRecord(ctx.body.json);
    const email = validateEmail(body.email);
    const displayName = typeof body.displayName === 'string' ? body.displayName : '';
    const role = body.role === 'agency' || body.role === 'press' ? body.role : null;
    if (!role) throw notFound();
    const organisationId = typeof body.organisationId === 'string' ? body.organisationId : null;
    const existing = await query<{ id: string }>('SELECT id FROM principals WHERE lower(email) = lower($1)', [email]);
    if (existing.length > 0) throw alreadyRegistered(email);
    const org = await query<{ id: string }>('SELECT id FROM organisations WHERE id = $1', [organisationId]);
    if (org.length === 0) throw notFound();
    const now = await readClock(cfg);
    const token = randomToken(24);
    const expiresAt = new Date(now.getTime() + cfg.inviteTtlHours * 3600000);
    const row = await withTransaction(async (tx) => {
      const res = await tx.query<{ id: string }>(
        `INSERT INTO invitations (id, token_hash, email, display_name, role, organisation_id, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          `inv_${randomToken(10)}`,
          sha256(token),
          email,
          displayName,
          role,
          organisationId,
          expiresAt,
          now,
        ],
      );
      await queueMail(tx, invitationMail(cfg, token, expiresAt, email), now);
      return res.rows[0];
    });
    void writeClock;
    return created({ id: row.id, email, expiresAt: expiresAt.toISOString() });
  });

  router.add('GET', '/invitations/:token', async (ctx) => {
    const row = await invitationByToken(ctx.params.token, cfg);
    return { email: row.email, displayName: row.display_name };
  });

  router.add('POST', '/invitations/:token/activate', async (ctx) => {
    const row = await invitationByToken(ctx.params.token, cfg);
    const body = asRecord(ctx.body.json);
    const password = body.password;
    if (typeof password !== 'string' || password.length < 12) throw weakPassword();
    const now = await readClock(cfg);
    const created = await withTransaction(async (tx) => {
      const res = await tx.query<{ id: string }>(
        `UPDATE invitations SET used_at = $1 WHERE token_hash = $2 AND used_at IS NULL RETURNING id`,
        [now, sha256(ctx.params.token)],
      );
      if (res.rows.length === 0) throw invitationInvalid();
      const principal = await tx.query<{ id: string; display_name: string; role: string; organisation_id: string | null }>(
        `INSERT INTO principals (id, key, email, display_name, role, password_hash, organisation_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, display_name, role, organisation_id`,
        [
          `usr_${randomToken(10)}`,
          `inv-${randomToken(6)}`,
          row.email,
          row.display_name,
          row.role,
          hashPassword(password),
          row.organisation_id,
          now,
        ],
      );
      return principal.rows[0];
    });
    const token = await createSession(created.id);
    ctx.setCookies.push(cookieHeader(cfg.sessionCookieName, token));
    return {
      principal: {
        id: created.id,
        displayName: created.display_name,
        role: created.role,
        organisationId: created.organisation_id,
      },
    };
  });

  router.add('GET', '/organisations', async (ctx) => {
    const principal = requireSession(ctx);
    if (principal.role !== 'owner') throw notFound();
    const rows = await query<{
      id: string;
      name: string;
      kind: string;
      territory: string;
      engagement_starts_on: string | null;
      engagement_ends_on: string | null;
      engagement_territories: string[];
    }>(
      'SELECT id, name, kind, territory, engagement_starts_on::text, engagement_ends_on::text, engagement_territories FROM organisations ORDER BY name',
    );
    return {
      organisations: rows.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        territory: row.territory,
        engagement: {
          startsOn: row.engagement_starts_on,
          endsOn: row.engagement_ends_on,
          territories: row.engagement_territories,
        },
      })),
    };
  });

  router.add('PUT', '/organisations/:id/engagement', async (ctx) => {
    const principal = requireSession(ctx);
    if (principal.role !== 'owner') throw forbidden();
    const body = asRecord(ctx.body.json);
    const endsOn = typeof body.endsOn === 'string' ? body.endsOn : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) throw notFound();
    const rows = await query(
      `UPDATE organisations SET engagement_ends_on = $2 WHERE id = $1
        RETURNING id, engagement_starts_on::text, engagement_ends_on::text, engagement_territories`,
      [ctx.params.id, endsOn],
    );
    if (rows.length === 0) throw notFound();
    return {
      id: rows[0].id,
      engagement: {
        startsOn: rows[0].engagement_starts_on,
        endsOn: rows[0].engagement_ends_on,
        territories: rows[0].engagement_territories,
      },
    };
  });
}

async function invitationByToken(token: string, cfg: Config): Promise<{ email: string; display_name: string; role: string; organisation_id: string | null }> {
  const now = await readClock(cfg);
  const rows = await query<{
    email: string;
    display_name: string;
    role: string;
    organisation_id: string | null;
    used_at: Date | null;
    expires_at: Date;
  }>('SELECT email, display_name, role, organisation_id, used_at, expires_at FROM invitations WHERE token_hash = $1', [
    sha256(token),
  ]);
  if (rows.length === 0) throw invitationInvalid();
  const row = rows[0];
  if (row.used_at !== null || row.expires_at.getTime() <= now.getTime()) throw invitationInvalid();
  return row;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export { isRole, emailInvalid };

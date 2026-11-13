// Invites: single-use links that are the only way to become a member.
import { sendJson, setCookie } from '../http';
import { notFound, validation, ApiError } from '../errors';
import { COPY } from '../../domain/copy';
import type { RouteCtx } from '../routes';
import { hashPassword, newId } from '../store';
import { queueMail, flushOutbox } from '../mailer';
import { formatDate, formatTime } from '../../domain/format';
import { randomBytes } from 'node:crypto';
import { handleMembers } from './members';

export { handleMembers };

export async function handleInviteRoutes(ctx: RouteCtx): Promise<void> {
  // /api/invites/:token and /api/invites/:token/accept
  const rest = ctx.path.slice('/api/invites/'.length);
  const segments = rest.split('/');
  const token = segments[0]!;
  const sub = segments[1] ?? '';

  const invite = await ctx.app.pool
    .query<{
      id: string;
      project_id: string;
      email: string;
      role: string;
      status: string;
      expires_at: Date;
    }>(`SELECT id, project_id, email, role, status, expires_at FROM invites WHERE token = $1`, [
      token,
    ])
    .then((r) => r.rows[0] ?? null);

  if (sub === '' && ctx.method === 'GET') {
    if (!invite || invite.status === 'accepted' || invite.expires_at.getTime() < ctx.app.clock.nowMs()) {
      throw new ApiError(410, 'invite_unavailable', COPY.inviteUnavailable);
    }
    const project = await ctx.app.pool
      .query<{ name: string }>(`SELECT name FROM projects WHERE id = $1`, [invite.project_id])
      .then((r) => r.rows[0]);
    if (!project) throw new ApiError(410, 'invite_unavailable', COPY.inviteUnavailable);
    const accountExists = await ctx.app.pool
      .query<{ id: string }>(`SELECT id FROM people WHERE lower(email) = $1`, [invite.email.toLowerCase()])
      .then((r) => Boolean(r.rows[0]));
    sendJson(ctx.res, 200, {
      projectName: project.name,
      role: invite.role,
      email: invite.email,
      accountExists,
    });
    return;
  }

  if (sub === 'accept' && ctx.method === 'POST') {
    if (!invite || invite.status === 'accepted' || invite.expires_at.getTime() < ctx.app.clock.nowMs()) {
      throw new ApiError(410, 'invite_unavailable', COPY.inviteUnavailable);
    }
    const body = (ctx.body ?? {}) as { name?: string; password?: string };
    const person = await ctx.app.pool
      .query<{ id: string; email: string; password_hash: string }>(
        `SELECT id, email, password_hash FROM people WHERE lower(email) = $1`,
        [invite.email.toLowerCase()],
      )
      .then((r) => r.rows[0] ?? null);

    let personId: string;
    if (person) {
      // An existing account needs its password to accept.
      if (!body?.password || body.password !== invitePasswordCheck(person.password_hash, body.password)) {
        if (!body?.password || hashPassword(body.password) !== person.password_hash) {
          // Wrong password isn't a published refusal; the shape below covers it.
          throw validation({ password: COPY.shortPassword });
        }
      }
      personId = person.id;
    } else {
      if (!body?.password || body.password.length < 10) {
        throw validation({ password: COPY.shortPassword });
      }
      if (!body?.name || body.name.trim().length < 1) {
        throw validation({ name: COPY.enterName });
      }
      // The workspace comes from the inviting project.
      const ws = await ctx.app.pool
        .query<{ workspace_id: string }>(`SELECT workspace_id FROM projects WHERE id = $1`, [
          invite.project_id,
        ])
        .then((r) => r.rows[0]);
      personId = newId('per');
      await ctx.app.pool.query(
        `INSERT INTO people (id, workspace_id, name, email, password_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [personId, ws!.workspace_id, body.name.trim(), invite.email, hashPassword(body.password)],
      );
    }

    // Sign the person in as a member, exactly once.
    const client = await ctx.app.pool.connect();
    try {
      await client.query('BEGIN');
      const claimed = await client.query<{ id: string }>(
        `UPDATE invites SET status = 'accepted' WHERE id = $1 AND status = 'sent' RETURNING id`,
        [invite.id],
      );
      if (claimed.rows.length === 0) {
        await client.query('ROLLBACK');
        client.release();
        throw new ApiError(410, 'invite_unavailable', COPY.inviteUnavailable);
      }
      await client.query(
        `INSERT INTO members (project_id, person_id, role) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [invite.project_id, personId, invite.role],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      client.release();
      throw e;
    }
    client.release();

    const token2 = randomBytes(24).toString('hex');
    await ctx.app.pool.query(
      `INSERT INTO sessions (token, person_id, created_at) VALUES ($1, $2, now())`,
      [token2, personId],
    );
    setCookie(ctx.res, 'hs_session', token2);
    sendJson(ctx.res, 200, { projectId: invite.project_id, role: invite.role });
    return;
  }

  throw notFound();
}

function invitePasswordCheck(stored: string, given: string): string | null {
  return stored === hashPassword(given) ? stored : null;
}

export function inviteExpiryLabel(app: import('../app').App, iso: string): string {
  return `${formatDate(iso, app.cfg.timeZone)} at ${formatTime(iso, app.cfg.timeZone)}`;
}

export async function sendInviteMail(
  ctx: RouteCtx,
  invite: { id: string; email: string; projectId: string; projectName: string; role: string; token: string; expiresAt: string; inviterName: string },
): Promise<void> {
  const link = `${ctx.app.cfg.publicUrl}/invite/${invite.token}`;
  const body = `${invite.inviterName} invited you to join ${invite.projectName} in Halation Studio as ${invite.role}.\n\nAccept here: ${link}\n\nThis link works once and expires on ${formatDate(invite.expiresAt, ctx.app.cfg.timeZone)} at ${formatTime(invite.expiresAt, ctx.app.cfg.timeZone)}.`;
  const client = await ctx.app.pool.connect();
  try {
    await client.query('BEGIN');
    const outboxId = await queueMail(client, {
      to: invite.email,
      subject: `Join ${invite.projectName} in Halation Studio`,
      body,
    });
    await client.query(
      `INSERT INTO invite_notices (invite_id, outbox_id, status) VALUES ($1, $2, 'queued')`,
      [invite.id, outboxId],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    client.release();
    throw e;
  }
  client.release();
  // Try to send now; failure leaves it queued.
  await flushOutbox(ctx.app.pool, ctx.app.cfg, ctx.app.instanceId).catch(() => undefined);
}


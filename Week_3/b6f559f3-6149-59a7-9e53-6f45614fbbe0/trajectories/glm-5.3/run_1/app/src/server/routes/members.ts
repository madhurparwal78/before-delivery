// Members and invites under a project: listing, inviting, removing.
import { sendJson } from '../http';
import { notFound, forbidden, validation } from '../errors';
import { COPY } from '../../domain/copy';
import { formatDate, formatTime } from '../../domain/format';
import type { RouteCtx } from '../routes';
import { newId, requirePersonRoute, openProjectById } from '../store';
import { randomBytes } from 'node:crypto';

export async function handleMembers(
  ctx: RouteCtx,
  projectId: string,
  personIdSegment: string,
  kind: string,
): Promise<void> {
  const person = await requirePersonRoute(ctx);
  const { role } = await openProjectById(ctx.app, ctx, projectId, person);

  if (kind === 'members' && ctx.method === 'GET' && personIdSegment === '') {
    const members = await ctx.app.pool.query<{ person_id: string; name: string; email: string; role: string }>(
      `SELECT m.person_id, p.name, p.email, m.role FROM members m
       JOIN people p ON p.id = m.person_id WHERE m.project_id = $1`,
      [projectId],
    );
    const invites = await ctx.app.pool.query<{
      id: string;
      email: string;
      role: string;
      status: string;
      expires_at: Date;
    }>(
      `SELECT i.id, i.email, i.role, i.status, i.expires_at FROM invites i
       WHERE i.project_id = $1 AND i.status IN ('sent', 'queued')`,
      [projectId],
    );
    sendJson(ctx.res, 200, {
      members: members.rows.map((m) => ({
        personId: m.person_id,
        name: m.name,
        email: m.email,
        role: m.role,
      })),
      invites: invites.rows.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        status: i.status,
        expiresAt: i.expires_at.toISOString(),
      })),
    });
    return;
  }

  if (kind === 'invites' && ctx.method === 'POST') {
    if (role !== 'Owner') throw forbidden(COPY.ownerMembers);
    const body = ctx.body as { email?: string; role?: string };
    const email = body?.email?.trim().toLowerCase() ?? '';
    const inviteRole = body?.role;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw validation({ email: COPY.invalidEmail });
    }
    if (inviteRole !== 'Editor' && inviteRole !== 'Viewer') {
      throw validation({ role: 'Choose one of the listed roles.' });
    }
    const existingMember = await ctx.app.pool.query<{ id: string }>(
      `SELECT p.id FROM people p JOIN members m ON m.person_id = p.id
       WHERE m.project_id = $1 AND lower(p.email) = $2`,
      [projectId, email],
    );
    if (existingMember.rows[0]) {
      throw validation({ email: COPY.alreadyMember(email) });
    }
    const pending = await ctx.app.pool.query<{ id: string }>(
      `SELECT id FROM invites WHERE project_id = $1 AND lower(email) = $2 AND status IN ('sent', 'queued')`,
      [projectId, email],
    );
    if (pending.rows[0]) {
      throw validation({ email: COPY.invitePending(email) });
    }
    const project = await ctx.app.pool.query<{ name: string }>(
      `SELECT name FROM projects WHERE id = $1`,
      [projectId],
    );
    const id = newId('inv');
    const token = randomBytes(24).toString('hex');
    const expiresAt = new Date(ctx.app.clock.nowMs() + ctx.app.cfg.inviteTtlHours * 3600 * 1000);
    await ctx.app.pool.query(
      `INSERT INTO invites (id, project_id, email, role, token, status, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, 'sent', $6, now())`,
      [id, projectId, email, inviteRole, token, expiresAt],
    );
    // The invite row's mail status: queued until sending succeeds.
    const mailOk = await trySendInvite(ctx, {
      id,
      email,
      projectId,
      projectName: project.rows[0]!.name,
      role: inviteRole,
      token,
      expiresAt: expiresAt.toISOString(),
      inviterName: person.name,
    });
    if (!mailOk) {
      await ctx.app.pool.query(`UPDATE invites SET status = 'queued' WHERE id = $1`, [id]);
    }
    const finalRow = await ctx.app.pool.query<{ status: string }>(
      `SELECT status FROM invites WHERE id = $1`,
      [id],
    );
    sendJson(ctx.res, 201, {
      invite: {
        id,
        email,
        role: inviteRole,
        status: finalRow.rows[0]?.status ?? 'sent',
        expiresAt: expiresAt.toISOString(),
      },
    });
    return;
  }

  if (kind === 'members' && ctx.method === 'DELETE' && personIdSegment) {
    if (role !== 'Owner') throw forbidden(COPY.ownerMembers);
    const res = await ctx.app.pool.query(
      `DELETE FROM members WHERE project_id = $1 AND person_id = $2 AND role != 'Owner'`,
      [projectId, personIdSegment],
    );
    if (res.rowCount === 0) throw notFound();
    ctx.res.writeHead(204);
    ctx.res.end();
    return;
  }

  throw notFound();
}

async function trySendInvite(
  ctx: RouteCtx,
  invite: {
    id: string;
    email: string;
    projectId: string;
    projectName: string;
    role: string;
    token: string;
    expiresAt: string;
    inviterName: string;
  },
): Promise<boolean> {
  const { sendSmtp, queueMail } = await import('../mailer');
  const link = `${ctx.app.cfg.publicUrl}/invite/${invite.token}`;
  const body = `${invite.inviterName} invited you to join ${invite.projectName} in Halation Studio as ${invite.role}.\n\nAccept here: ${link}\n\nThis link works once and expires on ${formatDateAt(ctx, invite.expiresAt)} at ${formatTimeAt(ctx, invite.expiresAt)}.`;
  const client = await ctx.app.pool.connect();
  let outboxId: number;
  try {
    await client.query('BEGIN');
    outboxId = await queueMail(client, {
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
  const ok = await sendSmtp(ctx.app.cfg, invite.email, `Join ${invite.projectName} in Halation Studio`, body);
  if (ok) {
    await ctx.app.pool.query(`UPDATE outbox SET status = 'sent', sent_at = now() WHERE id = $1`, [outboxId]);
    await ctx.app.pool.query(`UPDATE invite_notices SET status = 'sent' WHERE outbox_id = $1`, [outboxId]);
    return true;
  }
  return false;
}

function formatDateAt(ctx: RouteCtx, iso: string): string {
  return formatDate(iso, ctx.app.cfg.timeZone);
}

function formatTimeAt(ctx: RouteCtx, iso: string): string {
  return formatTime(iso, ctx.app.cfg.timeZone);
}

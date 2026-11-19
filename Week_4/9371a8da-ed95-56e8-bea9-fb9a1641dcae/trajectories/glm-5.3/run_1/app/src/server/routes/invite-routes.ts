import type { Express } from 'express';
import type { RouteCtx } from './services.js';
import { requireMember } from './session-routes.js';
import { ApiError, alreadyMember, invitePending, inviteNotPending, inviteUnavailable, invalid, rateLimited, mailUnavailable, notFound } from '../errors.js';
import { readJson } from '../validation.js';
import { newId, newToken, hashPassword, verifyPassword } from '../ids.js';
import { createSession, destroySession, readSessionCookie, setSessionCookie } from '../session.js';

const INVITE_ROLES = ['editor', 'reviewer', 'viewer'] as const;
type InviteRole = (typeof INVITE_ROLES)[number];

function param(req: { params: Record<string, unknown> }, key: string): string {
  const v = req.params[key];
  return typeof v === 'string' ? v : '';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface InviteRow {
  id: string;
  project_id: string;
  email: string;
  email_lower: string;
  role: string;
  status: string;
  sent_at: Date;
  expires_at: Date;
  token: string;
}

/** The server's evaluation of an invite's status, on the server clock. */
function evaluateStatus(invite: { status: string; expires_at: Date }): string {
  if (invite.status !== 'pending') return invite.status;
  if (new Date() >= new Date(invite.expires_at)) return 'expired';
  return 'pending';
}

function headerSafe(s: string): string {
  return s.replace(/[\r\n\t\f\v\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
}

export function registerInviteRoutes(app: Express, { wrap, svc }: RouteCtx): void {
  const { sql, mailer, config } = svc;

  app.get('/api/projects/:pid/invites', wrap(async (req, res) => {
    const { role } = await requireMember(svc, req, param(req, 'pid'));
    if (role !== 'owner') throw new ApiError(403, 'forbidden');
    const rows = await sql<{ id: string; email: string; role: string; status: string; sent_at: Date; expires_at: Date }>`
      SELECT * FROM invites WHERE project_id = ${param(req, 'pid')} ORDER BY sent_at DESC, id`;
    res.json({ invites: rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      status: evaluateStatus(r),
      sentAt: r.sent_at instanceof Date ? r.sent_at.toISOString() : String(r.sent_at),
      expiresAt: r.expires_at instanceof Date ? r.expires_at.toISOString() : String(r.expires_at),
    })) });
  }));

  app.post('/api/projects/:pid/invites', wrap(async (req, res) => {
    const { user, role } = await requireMember(svc, req, param(req, 'pid'));
    if (role !== 'owner') throw new ApiError(403, 'forbidden');
    const body = await readJson(req, ['email', 'role']);
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const errors: Record<string, string> = {};
    if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.';
    if (typeof body.role !== 'string' || !INVITE_ROLES.includes(body.role as InviteRole)) errors.role = 'unknown role';
    if (Object.keys(errors).length > 0) throw invalid(errors);
    const inviteRole = body.role as InviteRole;
    const pid = param(req, 'pid');

    const prows = await sql<{ title: string }>`SELECT title FROM projects WHERE id = ${pid}`;
    if (!prows[0]) throw notFound();

    const outcome = await sql.begin(async (tx) => {
      // Hourly allowance: count invites recorded in the window, whatever their status.
      const windowStart = new Date(Date.now() - config.inviteWindowSeconds * 1000);
      const counted = await tx<{ sent_at: Date }>`
        SELECT sent_at FROM invites
        WHERE project_id = ${pid} AND sent_at > ${windowStart}
        ORDER BY sent_at DESC`;
      if (counted.length >= 10) {
        const oldest = counted[counted.length - 1].sent_at as Date;
        const retryAfterSeconds = Math.max(1, Math.ceil((oldest.getTime() + config.inviteWindowSeconds * 1000 - Date.now()) / 1000));
        return { limited: true, retryAfterSeconds };
      }
      const member = await tx`
        SELECT u.id FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.project_id = ${pid} AND u.email_lower = ${email.toLowerCase()}`;
      if (member[0]) return { conflict: 'already_member' as const };
      const pending = await tx`
        SELECT 1 FROM invites
        WHERE project_id = ${pid} AND email_lower = ${email.toLowerCase()} AND status = 'pending'`;
      if (pending[0]) return { conflict: 'invite_pending' as const };
      const id = newId('i');
      const token = newToken(24);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + config.inviteTtlSeconds * 1000);
      return { created: { id, token, now, expiresAt, inviteRole, email } };
    });
    if ('limited' in outcome && outcome.limited) throw rateLimited(outcome.retryAfterSeconds);
    if ('conflict' in outcome) {
      throw outcome.conflict === 'already_member' ? alreadyMember() : invitePending();
    }
    if (!('created' in outcome) || !outcome.created) throw new ApiError(500, 'internal');
    const created = outcome.created;

    // Send before recording: an invite is recorded only after SMTP accepts its message.
    const projectTitle = prows[0].title;
    const sentOk = await sendInvite(mailer, config.appBaseUrl, email, user.displayName, projectTitle, inviteRole, created.token, created.expiresAt);
    if (!sentOk) throw mailUnavailable();

    await sql`
      INSERT INTO invites (id, project_id, email, email_lower, role, status, sent_at, expires_at, token)
      VALUES (${created.id}, ${pid}, ${created.email}, ${created.email.toLowerCase()}, ${created.inviteRole}, 'pending', ${created.now}, ${created.expiresAt}, ${created.token})`;
    const rows = await sql<{ id: string; email: string; role: string; status: string; sent_at: Date; expires_at: Date }>`SELECT * FROM invites WHERE id = ${created.id}`;
    const r = rows[0];
    res.status(201).json({ invite: {
      id: r.id,
      email: r.email,
      role: r.role,
      status: evaluateStatus(r),
      sentAt: r.sent_at instanceof Date ? r.sent_at.toISOString() : String(r.sent_at),
      expiresAt: r.expires_at instanceof Date ? r.expires_at.toISOString() : String(r.expires_at),
    }});
  }));

  app.post('/api/projects/:pid/invites/:iid/revoke', wrap(async (req, res) => {
    const { role } = await requireMember(svc, req, param(req, 'pid'));
    if (role !== 'owner') throw new ApiError(403, 'forbidden');
    const iid = param(req, 'iid');
    const rows = await sql<{ id: string; email: string; role: string; status: string; sent_at: Date; expires_at: Date }>`
      SELECT * FROM invites WHERE project_id = ${param(req, 'pid')} AND id = ${iid} FOR UPDATE`;
    if (!rows[0]) throw notFound();
    const status = evaluateStatus(rows[0]);
    if (status !== 'pending') throw inviteNotPending();
    await sql`UPDATE invites SET status = 'revoked', revoked_at = now() WHERE id = ${iid}`;
    const after = await sql<{ id: string; email: string; role: string; status: string; sent_at: Date; expires_at: Date }>`SELECT * FROM invites WHERE id = ${iid}`;
    const r = after[0];
    res.json({ invite: {
      id: r.id, email: r.email, role: r.role, status: r.status,
      sentAt: r.sent_at instanceof Date ? r.sent_at.toISOString() : String(r.sent_at),
      expiresAt: r.expires_at instanceof Date ? r.expires_at.toISOString() : String(r.expires_at),
    }});
  }));

  // ---- Token routes (no session needed) ----
  app.get('/api/invites/:token', wrap(async (req, res) => {
    const token = param(req, 'token');
    const rows = await sql<InviteRow>`SELECT * FROM invites WHERE token = ${token}`;
    if (!rows[0]) throw notFound();
    const invite = rows[0];
    const status = evaluateStatus(invite);
    if (status !== 'pending') throw inviteUnavailable(status);
    const inviter = await sql`
      SELECT u.display_name FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.project_id = ${invite.project_id} AND m.role = 'owner'
      ORDER BY u.id LIMIT 1`;
    const project = await sql`SELECT title FROM projects WHERE id = ${invite.project_id}`;
    res.json({ invite: {
      projectTitle: project[0]?.title ?? '',
      role: invite.role,
      inviterName: inviter[0]?.display_name ?? '',
      email: invite.email,
      expiresAt: invite.expires_at instanceof Date ? invite.expires_at.toISOString() : String(invite.expires_at),
    }});
  }));

  app.post('/api/invites/:token/accept', wrap(async (req, res) => {
    const token = param(req, 'token');
    const body = await readJson(req, ['displayName', 'password']);
    const displayName = typeof body.displayName === 'string' ? body.displayName : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const rows = await sql<InviteRow>`SELECT * FROM invites WHERE token = ${token}`;
    if (!rows[0]) throw notFound();
    const invite = rows[0];
    const status = evaluateStatus(invite);
    if (status !== 'pending') throw inviteUnavailable(status);

    const trows = await sql<InviteRow>`SELECT * FROM invites WHERE token = ${token} FOR UPDATE`;
    const fresh = trows[0];
    if (evaluateStatus(fresh) !== 'pending') throw inviteUnavailable(evaluateStatus(fresh));

    const errors: Record<string, string> = {};
    const trimmedName = displayName.trim();
    if (trimmedName.length < 1 || trimmedName.length > 80) errors.displayName = 'length';
    if (password.length < 10) errors.password = 'length';
    if (Object.keys(errors).length > 0) throw invalid(errors);

    const existing = await sql<{ id: string; password_hash: string }>`SELECT * FROM users WHERE email_lower = ${invite.email_lower}`;
    let userId: string;
    if (existing[0]) {
      if (!verifyPassword(password, existing[0].password_hash)) {
        throw new ApiError(401, 'invalid_credentials');
      }
      userId = existing[0].id;
    } else {
      userId = newId('u');
      const handle = await uniqueHandle(sql, invite.email);
      await sql`
        INSERT INTO users (id, email, email_lower, display_name, handle, password_hash)
        VALUES (${userId}, ${invite.email}, ${invite.email_lower}, ${displayName}, ${handle}, ${hashPassword(password)})`;
    }
    const member = await sql`
      SELECT 1 FROM memberships WHERE project_id = ${invite.project_id} AND user_id = ${userId}`;
    if (member[0]) throw alreadyMember(invite.project_id);

    // The token works once.
    await sql.begin(async (tx) => {
      await tx`UPDATE invites SET status = 'accepted', accepted_at = now() WHERE id = ${invite.id}`;
      await tx`
        INSERT INTO memberships (project_id, user_id, role)
        VALUES (${invite.project_id}, ${userId}, ${invite.role})
        ON CONFLICT DO NOTHING`;
    });

    // End any session sent with the request and set a new one.
    const oldToken = readSessionCookie(req);
    if (oldToken) await destroySession(sql, oldToken);
    const sessionToken = await createSession(sql, userId);
    setSessionCookie(res, sessionToken);
    const urows = await sql`SELECT id, email, display_name, handle FROM users WHERE id = ${userId}`;
    res.json({
      user: { id: urows[0].id, email: urows[0].email, displayName: urows[0].display_name, handle: urows[0].handle },
      projectId: invite.project_id,
      role: invite.role,
    });
  }));
}

/** The handle rule: local part lower-cased, non-alphanumerics removed, numbered when taken. */
export async function uniqueHandle(sql: import('../db.js').Queryable, email: string): Promise<string> {
  const local = email.split('@')[0] ?? '';
  const base = local.toLowerCase().replace(/[^a-z0-9]/g, '');
  let candidate = base;
  for (let n = 2; ; n++) {
    const taken = await sql`SELECT 1 FROM users WHERE handle = ${candidate}`;
    if (taken.length === 0) return candidate;
    candidate = `${base}${n}`;
  }
}

async function sendInvite(
  mailer: import('../mail.js').Mailer,
  baseUrl: string,
  to: string,
  inviterName: string,
  projectTitle: string,
  role: InviteRole,
  token: string,
  expiresAt: Date,
): Promise<boolean> {
  const subject = `${headerSafe(inviterName)} invited you to ${headerSafe(projectTitle)} on Marginalia`;
  const expires = `${expiresAt.toISOString().replace('Z', 'Z')}`;
  const body = `${headerSafe(inviterName)} invited you to ${headerSafe(projectTitle)} on Marginalia as ${role}.\n\nAccept the invitation: ${baseUrl}/invite/${token}\nThis link expires on ${expires}.\n`;
  return mailer.send(to, subject, body);
}

import { sendJson, sendNoContent, type Router } from './http.js';
import { one, rows, query, tx } from './db.js';
import { config } from './config.js';
import { fail, forbidden, invalidTransition, notFound, validationFailed, workspaceSuspended, rateLimited } from './errors.js';
import { requireSession } from './auth.js';
import { sha256Hex, opaqueId, shareToken } from './crypto.js';
import { audit } from './audit.js';
import { queueMail, mailTime } from './mail.js';
import { bucketByName, currentVersion, versionById } from './objects.js';
import { wsCtx } from './api-ws.js';

function iso(d: Date): string { return d.toISOString(); }
function jsonBodyOf(req: { rawBody: Buffer | null }): Record<string, unknown> {
  if (!req.rawBody || req.rawBody.length === 0) return {};
  try { return JSON.parse(req.rawBody.toString('utf8')) as Record<string, unknown>; } catch { return {}; }
}

export function registerWorkspaceRoutes2(json: Router): void {
  // ---- Share links ----
  json.post('/api/w/{ws}/buckets/{bucket}/object/links', async (req, res) => {
    const auth = await requireSession(req);
    const { ws } = await wsCtx(req.params['ws'], auth);
    const bucket = await bucketByName(req.params['bucket']);
    if (!bucket || bucket.workspace_slug !== ws.slug) throw notFound();
    if (ws.status === 'suspended') throw workspaceSuspended();
    const key = req.query.get('key') ?? '';
    const versionQ = req.query.get('version');
    const v = versionQ ? await versionById(versionQ) : await currentVersion(bucket.name, key);
    if (!v || v.state === 'removed' || (versionQ && (v.bucket_name !== bucket.name || v.key !== key))) throw notFound();
    const body = jsonBodyOf(req);
    const errors: Record<string, string> = {};
    for (const k of Object.keys(body)) if (k !== 'expires_in_seconds') errors[k] = "This field can't be set.";
    if (!('expires_in_seconds' in body)) errors.expires_in_seconds = 'This field is required.';
    const secs = Number(body.expires_in_seconds);
    if (!Number.isInteger(secs) || secs < 1 || secs > 604_800) {
      errors.expires_in_seconds = 'Pick an expiry between one second and seven days.';
    }
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    const id = opaqueId('l', 10);
    const token = shareToken();
    const expiresAt = new Date(Date.now() + secs * 1000);
    await query(
      `INSERT INTO share_links (id, token_hash, bucket_name, key, version_id, workspace_slug, created_by, expires_at, state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')`,
      [id, sha256Hex(token), bucket.name, key, v.version_id, ws.slug, auth.user.id, expiresAt]
    );
    const host = req.headers['host'] ?? 'localhost';
    const proto = req.headers['x-forwarded-proto'] ?? 'http';
    sendJson(res, 201, {
      id, url: `${proto}://${host}/l/${token}`, bucket: bucket.name, key,
      version_id: v.version_id, expires_at: iso(expiresAt), state: 'active',
    });
  });

  json.get('/api/w/{ws}/links', async (req, res) => {
    const auth = await requireSession(req);
    const { ws } = await wsCtx(req.params['ws'], auth);
    const list = await rows<{ id: string; bucket_name: string; key: string; version_id: string; created_by: string; created_at: Date; expires_at: Date; state: string }>(
      `SELECT id, bucket_name, key, version_id, created_by, created_at, expires_at, state
       FROM share_links WHERE workspace_slug = $1 ORDER BY created_at DESC`, [ws.slug]
    );
    sendJson(res, 200, {
      links: list.map(l => ({
        id: l.id, bucket: l.bucket_name, key: l.key, version_id: l.version_id,
        created_by: l.created_by, created_at: iso(l.created_at), expires_at: iso(l.expires_at), state: l.state,
      })),
    });
  });

  json.post('/api/w/{ws}/links/{id}/revoke', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    const link = await one<{ id: string; workspace_slug: string; created_by: string; state: string }>(
      `SELECT id, workspace_slug, created_by, state FROM share_links WHERE id = $1`, [req.params['id']]
    );
    if (!link || link.workspace_slug !== ws.slug) throw notFound();
    if (role === 'viewer' && link.created_by !== auth.user.id) throw forbidden();
    if (link.state !== 'active') throw invalidTransition(link.state, 'revoked');
    await query(`UPDATE share_links SET state = 'revoked' WHERE id = $1`, [link.id]);
    sendJson(res, 200, { id: link.id, state: 'revoked' });
  });

  // ---- Team and invites (owner only) ----
  json.get('/api/w/{ws}/members', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'owner') throw forbidden();
    const list = await rows<{ user_id: string; name: string; email: string; role: string }>(
      `SELECT m.user_id, u.name, u.email, m.role FROM members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_slug = $1 ORDER BY u.name`, [ws.slug]
    );
    sendJson(res, 200, { members: list });
  });

  json.patch('/api/w/{ws}/members/{user_id}', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'owner') throw forbidden();
    const body = jsonBodyOf(req);
    const errors: Record<string, string> = {};
    for (const k of Object.keys(body)) if (k !== 'role') errors[k] = "This field can't be set.";
    if (!('role' in body)) errors.role = 'This field is required.';
    if (!['owner', 'developer', 'viewer'].includes(String(body.role))) errors.role = 'Choose a role.';
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    const target = await one<{ role: string; name: string; email: string }>(
      `SELECT m.role, u.name, u.email FROM members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_slug = $1 AND m.user_id = $2`, [ws.slug, req.params['user_id']]
    );
    if (!target) throw notFound();
    if (target.role === body.role) {
      sendJson(res, 200, { user_id: req.params['user_id'], name: target.name, email: target.email, role: target.role });
      return;
    }
    if (target.role === 'owner') {
      const owners = await one<{ c: string }>(`SELECT count(*)::text AS c FROM members WHERE workspace_slug = $1 AND role = 'owner'`, [ws.slug]);
      if (Number(owners!.c) <= 1) throw fail(409, 'last_owner', 'A workspace needs at least one owner.');
    }
    const updated = await tx(async client => {
      const r = await client.query(
        `UPDATE members SET role = $1 WHERE workspace_slug = $2 AND user_id = $3
         AND (SELECT count(*) FROM members WHERE workspace_slug = $2 AND role = 'owner') > 1
         RETURNING role`, [body.role, ws.slug, req.params['user_id']]
      );
      return r.rowCount ?? 0;
    });
    if (updated === 0) throw fail(409, 'last_owner', 'A workspace needs at least one owner.');
    await audit(ws.slug, auth.user.email, 'member.role_changed', target.email, `${target.role} -> ${body.role}`);
    sendJson(res, 200, { user_id: req.params['user_id'], name: target.name, email: target.email, role: String(body.role) });
  });

  json.delete('/api/w/{ws}/members/{user_id}', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'owner') throw forbidden();
    const target = await one<{ role: string; email: string }>(
      `SELECT m.role, u.email FROM members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_slug = $1 AND m.user_id = $2`, [ws.slug, req.params['user_id']]
    );
    if (!target) throw notFound();
    if (target.role === 'owner') {
      const owners = await one<{ c: string }>(`SELECT count(*)::text AS c FROM members WHERE workspace_slug = $1 AND role = 'owner'`, [ws.slug]);
      if (Number(owners!.c) <= 1) throw fail(409, 'last_owner', 'A workspace needs at least one owner.');
    }
    const removed = await tx(async client => {
      const r = await client.query(
        `DELETE FROM members WHERE workspace_slug = $1 AND user_id = $2
         AND (SELECT count(*) FROM members WHERE workspace_slug = $1 AND role = 'owner') > 1
         OR (SELECT role FROM members WHERE workspace_slug = $1 AND user_id = $2) <> 'owner'`,
        [ws.slug, req.params['user_id']]
      );
      return r.rowCount ?? 0;
    });
    if (removed === 0) throw fail(409, 'last_owner', 'A workspace needs at least one owner.');
    await query(`UPDATE share_links SET state = 'revoked' WHERE created_by = $1 AND workspace_slug = $2 AND state = 'active'`,
      [req.params['user_id'], ws.slug]);
    await audit(ws.slug, auth.user.email, 'member.removed', target.email, '');
    sendNoContent(res);
  });

  json.post('/api/w/{ws}/invites', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'owner') throw forbidden();
    const body = jsonBodyOf(req);
    const errors: Record<string, string> = {};
    for (const k of Object.keys(body)) if (k !== 'email' && k !== 'role') errors[k] = "This field can't be set.";
    if (!('email' in body)) errors.email = 'This field is required.';
    if (!('role' in body)) errors.role = 'This field is required.';
    const email = String(body.email ?? '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address.';
    if (!['developer', 'viewer'].includes(String(body.role))) errors.role = 'Choose a role.';
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    const emailLower = email.toLowerCase();
    const member = await one<{ c: string }>(
      `SELECT count(*)::text AS c FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_slug = $1 AND u.email_lower = $2`,
      [ws.slug, emailLower]
    );
    if (Number(member!.c) > 0) throw fail(409, 'already_member', 'This person is already in the workspace.');
    // Rate limit: 10 invites per workspace per rolling 60 seconds.
    const recent = await one<{ c: string }>(
      `SELECT count(*)::text AS c FROM invites WHERE workspace_slug = $1 AND created_at > now() - interval '60 seconds'`, [ws.slug]
    );
    if (Number(recent!.c) >= 10) throw rateLimited(60);
    const pending = await one<{ id: string }>(
      `SELECT id FROM invites WHERE workspace_slug = $1 AND email_lower = $2 AND state = 'pending'`, [ws.slug, emailLower]
    );
    if (pending) {
      await query(`UPDATE invites SET state = 'replaced' WHERE id = $1`, [pending.id]);
    }
    const id = opaqueId('i', 10);
    const token = shareToken();
    const expiresAt = new Date(Date.now() + config.timing.inviteTtl * 1000);
    await query(
      `INSERT INTO invites (id, workspace_slug, email, email_lower, role, token, state, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)`,
      [id, ws.slug, email, emailLower, String(body.role), token, expiresAt]
    );
    await audit(ws.slug, auth.user.email, 'invite.created', email, String(body.role));
    const host = req.headers['host'] ?? 'localhost';
    const proto = req.headers['x-forwarded-proto'] ?? 'http';
    await queueMail(email, `You're invited to ${ws.name} on Farshore`,
      `You've been invited to join ${ws.name} on Farshore as a ${String(body.role)}.\n\nAccept here: ${proto}://${host}/invite/${token}\n\nThis invite expires ${mailTime(expiresAt)}.\n`);
    sendJson(res, 201, { id, email, role: String(body.role), expires_at: iso(expiresAt), state: 'pending' });
  });

  json.get('/api/w/{ws}/invites', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'owner') throw forbidden();
    const list = await rows<{ id: string; email: string; role: string; expires_at: Date; state: string }>(
      `SELECT id, email, role, expires_at, state FROM invites WHERE workspace_slug = $1 ORDER BY created_at DESC`, [ws.slug]
    );
    sendJson(res, 200, {
      invites: list.map(i => ({ id: i.id, email: i.email, role: i.role, expires_at: iso(i.expires_at), state: i.state })),
    });
  });

  json.get('/api/invites/{token}', async (req, res) => {
    const invite = await one<{ workspace_slug: string; email: string; role: string; expires_at: Date; state: string }>(
      `SELECT workspace_slug, email, role, expires_at, state FROM invites WHERE token = $1`, [req.params['token']]
    );
    if (!invite || invite.state === 'replaced' || invite.state === 'accepted') throw notFound();
    if (invite.state === 'expired' || invite.expires_at.getTime() <= Date.now()) {
      throw fail(410, 'invite_expired', 'This invite has expired.');
    }
    const ws = await one<{ slug: string; name: string }>(`SELECT slug, name FROM workspaces WHERE slug = $1`, [invite.workspace_slug]);
    const existing = await one<{ c: string }>(
      `SELECT count(*)::text AS c FROM users WHERE email_lower = $1`, [invite.email.toLowerCase()]
    );
    sendJson(res, 200, {
      workspace: { slug: ws!.slug, name: ws!.name }, email: invite.email, role: invite.role,
      expires_at: iso(invite.expires_at), existing_account: Number(existing!.c) > 0,
    });
  });

  json.post('/api/invites/{token}/accept', async (req, res) => {
    const invite = await one<{ id: string; workspace_slug: string; email: string; email_lower: string; role: string; expires_at: Date; state: string }>(
      `SELECT id, workspace_slug, email, email_lower, role, expires_at, state FROM invites WHERE token = $1`, [req.params['token']]
    );
    if (!invite || invite.state === 'replaced' || invite.state === 'accepted') throw notFound();
    if (invite.state === 'expired' || invite.expires_at.getTime() <= Date.now()) {
      throw fail(410, 'invite_expired', 'This invite has expired.');
    }
    const body = jsonBodyOf(req);
    const existing = await one<{ id: string; password_hash: string; email: string; name: string; operator: boolean }>(
      `SELECT id, password_hash, email, name, operator FROM users WHERE email_lower = $1`, [invite.email_lower]
    );
    const errors: Record<string, string> = {};
    const needsName = !existing;
    for (const k of Object.keys(body)) {
      if (k !== 'name' && k !== 'password') errors[k] = "This field can't be set.";
    }
    if (!('password' in body)) errors.password = 'This field is required.';
    const password = String(body.password ?? '');
    if (password.length < 12 || password.length > 128) errors.password = 'Use 12 to 128 characters.';
    if (needsName) {
      if (!('name' in body)) errors.name = 'This field is required.';
      const name = String(body.name ?? '');
      if (name.length < 1 || name.length > 80) errors.name = 'Names are 1 to 80 characters.';
    }
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    const throttle = await (await import('./auth.js')).throttleCheck(invite.email_lower);
    if (throttle !== null) throw rateLimited(throttle);
    const { verifyPassword, hashPassword } = await import('./crypto.js');
    if (existing) {
      if (!verifyPassword(password, existing.password_hash)) {
        await (await import('./auth.js')).recordFailure(invite.email_lower, 'password');
        throw fail(401, 'invalid_credentials', 'That password does not match your Farshore account.');
      }
    }
    let userId = existing?.id;
    if (!userId) {
      userId = opaqueId('u', 10);
      await query(`INSERT INTO users (id, email, email_lower, name, password_hash) VALUES ($1,$2,$3,$4,$5)`,
        [userId, invite.email, invite.email_lower, String(body.name), hashPassword(password)]);
    }
    await query(`UPDATE invites SET state = 'accepted' WHERE id = $1`, [invite.id]);
    await query(`INSERT INTO members (workspace_slug, user_id, role) VALUES ($1,$2,$3)`,
      [invite.workspace_slug, userId, invite.role]);
    await audit(invite.workspace_slug, invite.email, 'invite.accepted', invite.email, invite.role);
    const { createSession, clearFailures, sessionCookie, deviceFrom } = await import('./auth.js');
    const ts = await one<{ enabled: boolean }>(`SELECT enabled FROM two_step WHERE user_id = $1`, [userId]);
    if (existing && ts?.enabled) {
      const s = await createSession(userId, deviceFrom(req.headers), true);
      res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': sessionCookie(s.token) });
      res.end(JSON.stringify({ two_step: 'required', expires_at: iso(new Date(Date.now() + config.timing.twoStepPending * 1000)) }));
      return;
    }
    await clearFailures(invite.email_lower);
    const s = await createSession(userId, deviceFrom(req.headers), false);
    const wsName = await one<{ name: string }>(`SELECT name FROM workspaces WHERE slug = $1`, [invite.workspace_slug]);
    res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': sessionCookie(s.token) });
    res.end(JSON.stringify({
      user: { id: userId, name: existing?.name ?? String(body.name), email: invite.email, operator: false },
      memberships: [{ workspace: { slug: invite.workspace_slug, name: wsName!.name }, role: invite.role }],
    }));
  });
}

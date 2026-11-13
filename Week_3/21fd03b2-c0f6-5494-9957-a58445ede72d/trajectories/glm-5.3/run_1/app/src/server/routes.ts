import express, { type Request, type Response } from 'express';
import { withClient, withTransaction } from './db';
import { AppError, errorBody, asyncHandler, notFound } from './errors';
import { randomId, randomToken, hashPassword, verifyPassword, sha256 } from './crypto';
import { safeReturnLanding } from '../bench/rules';
import type { ActivityAction } from '../bench/activity';
import { writeActivity } from './activity';
import { seed } from './seed';
import type { SessionUser } from './shared';
import {
  PUBLIC_URL,
  INVITE_TTL,
  roleIn,
  projectWorkspace,
  workspaceName,
  requireUser,
  requireRole,
  requireRoleForProject,
  loadSceneWithAccess,
  jsonBody,
  extractCookie,
  currentUser,
  registerSceneChannel,
  notifyChannels,
  notifyAllWorkspaceChannels,
  presenceBody,
  statusBody,
} from './shared';
import { queueMail, sendNow, deliverPending } from './mail';
import { releaseAllLeasesForUser } from './locks';
import { COPY } from '../bench/copy';
import { loadScene, loadDocument, documentBytes, computeStateHash, applyOps, fieldKeysForPatch, removedIdsForPatch, revisionFootprints, type SceneRow } from './scenes';
import { checkRevisionConflict, type Op } from '../bench/ops';
import { KIND_SPECS, GRAVITY_SPEC, templateDocument, type SceneDocument, type SceneObject, type Template } from '../bench/scene';
import { canonicalJson } from '../bench/canonical';
import { simulate, stateHashInput } from '../bench/sim';

export const app = express();
app.disable('x-powered-by');

const PORT = Number(process.env.APP_PUBLIC_PORT ?? 4173);

// ---------- request body handling ----------

const MAX_JSON_BYTES = 1000000;

app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  const isUpload = /\/api\/projects\/[^/]+\/assets\/?$/.test(req.path);
  const limit = isUpload ? 10000000 : MAX_JSON_BYTES;
  const chunks: Buffer[] = [];
  let size = 0;
  let finished = false;
  req.on('data', (chunk: Buffer) => {
    if (finished) return;
    size += chunk.length;
    if (size > limit) {
      finished = true;
      const err = new AppError(413, 'payload_too_large', isUpload ? COPY.fieldErrors.uploadTooLarge : 'Request body too large.');
      res.status(413).json(errorBody(err));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (finished) return;
    finished = true;
    const raw = Buffer.concat(chunks);
    const contentType = (req.headers['content-type'] ?? '').toLowerCase();
    const scoped = req as Request & { rawBody?: Buffer; jsonBody?: unknown; bodyError?: AppError };
    scoped.rawBody = raw;
    if (contentType.includes('application/json') || (!isUpload && contentType === '')) {
      try {
        scoped.jsonBody = raw.length === 0 ? {} : JSON.parse(raw.toString('utf8'));
      } catch {
        scoped.bodyError = new AppError(400, 'bad_json', 'The request body is not valid JSON.');
      }
    } else if (!contentType.includes('application/octet-stream')) {
      scoped.bodyError = new AppError(415, 'unsupported_media_type', 'This endpoint accepts JSON.');
    }
    next();
  });
  req.on('error', () => {
    finished = true;
  });
});

// ---------- cross-origin writes ----------

app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (origin && origin.replace(/\/$/, '') !== PUBLIC_URL) {
    res.status(403).json(errorBody(new AppError(403, 'cross_origin', 'Cross-origin writes are not allowed.')));
    return;
  }
  next();
});

// ---------- auth ----------

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validEmail(email: string): boolean {
  return EMAIL_RE.test(email) && email.length <= 254 && !/\s/.test(email);
}

function foldEmail(email: string): string {
  return email.trim().toLowerCase();
}

function setSession(res: Response, token: string): void {
  res.setHeader('Set-Cookie', `rw_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
}

app.post('/api/auth/sign-up', asyncHandler(async (req, res) => {
  const body = jsonBody(req);
  const displayName = String(body.displayName ?? '').trim();
  const emailRaw = String(body.email ?? '').trim();
  const password = String(body.password ?? '');
  const fields: Record<string, string> = {};
  if (displayName.length < 1 || displayName.length > 60) fields.displayName = COPY.fieldErrors.displayName;
  if (!validEmail(emailRaw)) fields.email = COPY.fieldErrors.email;
  if (password.length < 10 || password.length > 128) fields.password = COPY.fieldErrors.password;
  if (Object.keys(fields).length > 0) throw new AppError(422, 'validation', 'There is a problem', fields);
  const emailFolded = foldEmail(emailRaw);
  const result = await withTransaction(async (client) => {
    const existing = await client.query('SELECT id FROM users WHERE email_folded = $1', [emailFolded]);
    if (existing.rows.length > 0) {
      throw new AppError(409, 'email_taken', COPY.fieldErrors.emailTaken, { email: COPY.fieldErrors.emailTaken });
    }
    const id = randomId('usr');
    const hash = await hashPassword(password);
    try {
      await client.query('INSERT INTO users (id, email, email_folded, display_name, password_hash) VALUES ($1,$2,$3,$4,$5)', [id, emailRaw, emailFolded, displayName, hash]);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new AppError(409, 'email_taken', COPY.fieldErrors.emailTaken, { email: COPY.fieldErrors.emailTaken });
      }
      throw e;
    }
    const token = randomToken(24);
    await client.query('INSERT INTO sessions (token, user_id) VALUES ($1,$2)', [token, id]);
    return { id, token };
  });
  setSession(res, result.token);
  const invite = typeof body.invite === 'string' ? body.invite : null;
  res.status(201).json({ user: { id: result.id, email: emailRaw, displayName }, landing: invite ? `/invite/${invite}` : '/workspaces/new' });
}));

app.post('/api/auth/sign-in', asyncHandler(async (req, res) => {
  const body = jsonBody(req);
  const emailRaw = String(body.email ?? '').trim();
  const password = String(body.password ?? '');
  const fields: Record<string, string> = {};
  if (!validEmail(emailRaw)) fields.email = COPY.fieldErrors.email;
  if (password.length < 10 || password.length > 128) fields.password = COPY.fieldErrors.password;
  if (Object.keys(fields).length > 0) throw new AppError(422, 'validation', 'There is a problem', fields);
  const user = await withClient(async (client) => {
    const row = await client.query('SELECT * FROM users WHERE email_folded = $1', [foldEmail(emailRaw)]);
    return row.rows[0];
  });
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw new AppError(401, 'bad_credentials', COPY.fieldErrors.badCredentials);
  }
  const token = randomToken(24);
  await withClient(async (client) => {
    await client.query('INSERT INTO sessions (token, user_id) VALUES ($1,$2)', [token, user.id]);
  });
  setSession(res, token);
  const invite = typeof body.invite === 'string' ? body.invite : null;
  const returnParam = typeof body.return === 'string' ? body.return : null;
  let landing: string;
  if (invite) {
    landing = `/invite/${invite}`;
  } else {
    const safeLanding = returnParam !== null ? safeReturnLanding(returnParam) : null;
    landing = safeLanding ?? (await defaultLanding(user.id));
  }
  res.status(200).json({ user: { id: user.id, email: user.email, displayName: user.display_name }, landing });
}));

async function defaultLanding(userId: string): Promise<string> {
  const target = await withClient(async (client) => {
    const last = await client.query('SELECT workspace_id FROM last_opened WHERE user_id = $1', [userId]);
    if (last.rows[0]) return last.rows[0].workspace_id as string;
    const earliest = await client.query(
      'SELECT workspace_id FROM memberships WHERE user_id = $1 ORDER BY joined_at ASC, workspace_id ASC LIMIT 1',
      [userId],
    );
    return earliest.rows[0]?.workspace_id ?? null;
  });
  return target ? `/w/${target}` : '/workspaces/new';
}

app.post('/api/auth/sign-out', asyncHandler(async (req, res) => {
  const token = extractCookie(req, 'rw_session');
  if (token) {
    await withClient(async (client) => {
      await client.query('DELETE FROM sessions WHERE token = $1', [token]);
    });
  }
  res.setHeader('Set-Cookie', 'rw_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.status(204).end();
}));

app.get('/api/me', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const data = await withClient(async (client) => {
    const workspaces = await client.query(
      'SELECT w.id, w.name, m.role FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1 ORDER BY m.joined_at ASC',
      [user.id],
    );
    const last = await client.query('SELECT workspace_id FROM last_opened WHERE user_id = $1', [user.id]);
    return { workspaces: workspaces.rows, lastWorkspaceId: last.rows[0]?.workspace_id ?? null };
  });
  res.json({ user, workspaces: data.workspaces, lastWorkspaceId: data.lastWorkspaceId });
}));

// ---------- workspaces ----------

app.post('/api/workspaces', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const body = jsonBody(req);
  const name = String(body.name ?? '').trim();
  if (name.length < 1 || name.length > 60) throw new AppError(422, 'validation', 'There is a problem', { name: COPY.fieldErrors.name });
  const result = await withTransaction(async (client) => {
    const id = randomId('ws');
    await client.query('INSERT INTO workspaces (id, name) VALUES ($1,$2)', [id, name]);
    await client.query('INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1,$2,$3)', [id, user.id, 'owner']);
    await client.query(
      'INSERT INTO last_opened (user_id, workspace_id) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET workspace_id = $2, opened_at = now()',
      [user.id, id],
    );
    await writeActivity(client, id, user, 'workspace.created', name);
    return { id, name };
  });
  res.status(201).json({ workspace: { id: result.id, name: result.name, role: 'owner' } });
}));

app.get('/api/workspaces/:wid', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const role = await requireRole(req.params.wid!, user.id, ['owner', 'editor', 'viewer']);
  const data = await withTransaction(async (client) => {
    const ws = await client.query('SELECT * FROM workspaces WHERE id = $1', [req.params.wid!]);
    const members = await client.query(
      'SELECT u.id, u.display_name, u.email, m.role, m.joined_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 ORDER BY m.joined_at ASC',
      [req.params.wid!],
    );
    let invites: Array<Record<string, unknown>> = [];
    if (role === 'owner') {
      const inv = await client.query('SELECT * FROM invites WHERE workspace_id = $1 AND status = $2 ORDER BY created_at DESC', [req.params.wid!, 'pending']);
      invites = inv.rows.map((row: { id: string; email: string; role: string; status: string; expires_at: Date }) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        status: row.status,
        expiresAt: new Date(row.expires_at).toISOString(),
      }));
    }
    await client.query(
      'INSERT INTO last_opened (user_id, workspace_id) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET workspace_id = $2, opened_at = now()',
      [user.id, req.params.wid!],
    );
    return { ws: ws.rows[0], members: members.rows, invites };
  });
  res.json({
    workspace: { id: data.ws.id, name: data.ws.name, role },
    members: data.members.map((m: { id: string; display_name: string; email: string; role: string }) => ({
      userId: m.id,
      displayName: m.display_name,
      email: m.email,
      role: m.role,
    })),
    invites: data.invites,
  });
}));

app.patch('/api/workspaces/:wid/members/:userId', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  await requireRole(req.params.wid!, user.id, ['owner']);
  const body = jsonBody(req);
  const role = String(body.role ?? '');
  if (role !== 'editor' && role !== 'viewer') {
    throw new AppError(422, 'validation', 'There is a problem', { role: COPY.fieldErrors.role });
  }
  const member = await withTransaction(async (client) => {
    const target = await client.query(
      'SELECT u.id, u.display_name, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 AND m.user_id = $2',
      [req.params.wid!, req.params.userId!],
    );
    if (!target.rows[0]) throw notFound();
    if (target.rows[0].role === 'owner') {
      throw new AppError(409, 'owner_role_fixed', "The owner's role cannot change.");
    }
    if (target.rows[0].role !== role) {
      await client.query('UPDATE memberships SET role = $1 WHERE workspace_id = $2 AND user_id = $3', [role, req.params.wid!, req.params.userId!]);
      await writeActivity(client, req.params.wid!, user, 'member.role_changed', target.rows[0].display_name);
      const wsName = await workspaceName(client, req.params.wid!);
      await queueMail(client, {
        to: target.rows[0].email,
        subject: `Your role in ${wsName} is now ${role === 'editor' ? 'Editor' : 'Viewer'}`,
        body: `Your role in ${wsName} is now ${role === 'editor' ? 'Editor' : 'Viewer'}.`,
        kind: 'role_change',
        refId: null,
      });
    }
    return target.rows[0];
  });
  const sent = await withClient(async (client) => {
    const row = await client.query('SELECT id FROM mail_outbox WHERE kind = $1 AND ref_id IS NULL AND to_email = $2 AND sent_at IS NULL ORDER BY seq DESC LIMIT 1', ['role_change', member.email]);
    if (!row.rows[0]) return true;
    return await sendNow(client, row.rows[0].id);
  });
  if (role === 'viewer') {
    await releaseAllLeasesForUser(req.params.userId!);
  }
  notifyAllWorkspaceChannels(req.params.wid!, req.params.userId!, role);
  res.json({ member: { userId: member.id, displayName: member.display_name, email: member.email, role } });
}));

// ---------- invites ----------

export function inviteState(row: { status: string; reason: string | null; expires_at: Date }): string {
  if (row.status === 'revoked') return row.reason === 'owner' ? 'revoked' : 'superseded';
  if (row.status === 'pending' && new Date(row.expires_at).getTime() <= Date.now()) return 'expired';
  return row.status;
}

app.post('/api/workspaces/:wid/invites', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  await requireRole(req.params.wid!, user.id, ['owner']);
  const body = jsonBody(req);
  const emailRaw = String(body.email ?? '').trim();
  const role = String(body.role ?? '');
  const fields: Record<string, string> = {};
  if (!validEmail(emailRaw)) fields.email = COPY.fieldErrors.email;
  if (role !== 'editor' && role !== 'viewer') fields.role = COPY.fieldErrors.role;
  if (Object.keys(fields).length > 0) throw new AppError(422, 'validation', 'There is a problem', fields);
  const emailFolded = foldEmail(emailRaw);
  const result = await withTransaction(async (client) => {
    const member = await client.query(
      'SELECT 1 FROM memberships WHERE workspace_id = $1 AND user_id IN (SELECT id FROM users WHERE email_folded = $2)',
      [req.params.wid!, emailFolded],
    );
    if (member.rows.length > 0) throw new AppError(409, 'already_member', 'That person is already a member.');
    const oldPending = await client.query(
      'SELECT * FROM invites WHERE workspace_id = $1 AND email_folded = $2 AND status = $3',
      [req.params.wid!, emailFolded, 'pending'],
    );
    let superseded: string | null = null;
    if (oldPending.rows[0]) {
      await client.query("UPDATE invites SET status = 'revoked', reason = 'superseded' WHERE id = $1", [oldPending.rows[0].id]);
      superseded = oldPending.rows[0].id;
    }
    const id = randomId('inv');
    const token = randomToken(24);
    const expiresAt = new Date(Date.now() + INVITE_TTL * 1000);
    await client.query(
      "INSERT INTO invites (id, workspace_id, email_folded, email, role, token, status, expires_at) VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)",
      [id, req.params.wid!, emailFolded, emailRaw, role, token, expiresAt],
    );
    await writeActivity(client, req.params.wid!, user, 'invite.created', emailRaw);
    const wsName = await workspaceName(client, req.params.wid!);
    await queueMail(client, {
      to: emailRaw,
      subject: `${user.displayName} invited you to ${wsName} on Rampwright`,
      body: `You have been invited as ${role}.\n${PUBLIC_URL}/invite/${token}\nThe invite expires ${expiresAt.toISOString()}.`,
      kind: 'invite',
      refId: id,
    });
    return { id, token, expiresAt, superseded };
  });
  const sent = await withClient(async (client) => {
    const row = await client.query('SELECT id FROM mail_outbox WHERE kind = $1 AND ref_id = $2 AND sent_at IS NULL', ['invite', result.id]);
    if (!row.rows[0]) return true;
    return await sendNow(client, row.rows[0].id);
  });
  res.status(201).json({
    invite: {
      id: result.id,
      email: emailRaw,
      role,
      status: 'pending',
      expiresAt: result.expiresAt.toISOString(),
      token: result.token,
    },
    delivery: sent ? 'sent' : 'queued',
    superseded: result.superseded,
  });
}));

app.delete('/api/workspaces/:wid/invites/:inviteId', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  await requireRole(req.params.wid!, user.id, ['owner']);
  const invite = await withTransaction(async (client) => {
    const row = await client.query('SELECT * FROM invites WHERE id = $1 AND workspace_id = $2', [req.params.inviteId!, req.params.wid!]);
    if (!row.rows[0]) throw notFound();
    const target = row.rows[0];
    const state = inviteState(target);
    if (state === 'accepted') throw new AppError(409, 'invite_used', COPY.inviteStates.used);
    if (state === 'revoked') throw new AppError(410, 'invite_revoked', COPY.inviteStates.revoked);
    if (state === 'superseded') throw new AppError(410, 'invite_superseded', COPY.inviteStates.superseded);
    if (state === 'expired') throw new AppError(410, 'invite_expired', COPY.inviteStates.expired);
    await client.query("UPDATE invites SET status = 'revoked', reason = 'owner' WHERE id = $1", [target.id]);
    await writeActivity(client, req.params.wid!, user, 'invite.revoked', target.email);
    return target;
  });
  res.json({ invite: { id: invite.id, email: invite.email, role: invite.role, status: 'revoked', reason: 'owner', expiresAt: new Date(invite.expires_at).toISOString() } });
}));

app.get('/api/invites/:token', asyncHandler(async (req, res) => {
  const row = await withClient(async (client) => {
    const result = await client.query(
      'SELECT i.*, w.name AS workspace_name FROM invites i JOIN workspaces w ON w.id = i.workspace_id WHERE i.token = $1',
      [req.params.token!],
    );
    return result.rows[0];
  });
  if (!row) throw notFound();
  const state = inviteState(row);
  if (state === 'superseded') throw new AppError(410, 'invite_superseded', COPY.inviteStates.superseded);
  res.json({
    invite: {
      workspaceName: row.workspace_name,
      email: row.email,
      role: row.role,
      status: state,
      reason: state === 'revoked' || state === 'superseded' ? row.reason : null,
      expiresAt: new Date(row.expires_at).toISOString(),
    },
  });
}));

app.post('/api/invites/:token/accept', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const result = await withTransaction(async (client) => {
    const row = await client.query('SELECT * FROM invites WHERE token = $1', [req.params.token!]);
    const invite = row.rows[0];
    if (!invite) throw notFound();
    const state = inviteState(invite);
    if (state === 'accepted') throw new AppError(409, 'invite_used', COPY.inviteStates.used);
    if (state === 'superseded') throw new AppError(410, 'invite_superseded', COPY.inviteStates.superseded);
    if (state === 'revoked') throw new AppError(410, 'invite_revoked', COPY.inviteStates.revoked);
    if (state === 'expired') throw new AppError(410, 'invite_expired', COPY.inviteStates.expired);
    if (foldEmail(user.email) !== invite.email_folded) {
      throw new AppError(403, 'invite_email_mismatch', COPY.inviteStates.mismatch(invite.email));
    }
    const existing = await client.query('SELECT 1 FROM memberships WHERE workspace_id = $1 AND user_id = $2', [invite.workspace_id, user.id]);
    if (existing.rows.length > 0) throw new AppError(409, 'invite_used', COPY.inviteStates.used);
    await client.query("UPDATE invites SET status = 'accepted' WHERE id = $1", [invite.id]);
    await client.query('INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1,$2,$3)', [invite.workspace_id, user.id, invite.role]);
    await client.query(
      'INSERT INTO last_opened (user_id, workspace_id) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET workspace_id = $2, opened_at = now()',
      [user.id, invite.workspace_id],
    );
    await writeActivity(client, invite.workspace_id, user, 'invite.accepted', invite.email);
    return { workspaceId: invite.workspace_id, role: invite.role };
  });
  res.json({ workspaceId: result.workspaceId, role: result.role, landing: `/w/${result.workspaceId}` });
}));

// ---------- activity ----------

app.get('/api/workspaces/:wid/activity', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  await requireRole(req.params.wid!, user.id, ['owner', 'editor', 'viewer']);
  const limitRaw = req.query.limit === undefined ? 50 : Number(req.query.limit);
  if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 100) {
    throw new AppError(422, 'invalid_cursor', 'The cursor or limit is invalid.');
  }
  const before = req.query.before === undefined ? null : String(req.query.before);
  await withTransaction(async (client) => {
    let beforeAt: Date | null = null;
    let beforeId: string | null = null;
    if (before !== null) {
      const row = await client.query('SELECT id, at FROM activity_events WHERE id = $1 AND workspace_id = $2', [before, req.params.wid!]);
      if (!row.rows[0]) throw new AppError(422, 'invalid_cursor', 'The cursor or limit is invalid.');
      beforeAt = new Date(row.rows[0].at);
      beforeId = row.rows[0].id;
    }
    const rows = await client.query(
      before === null
        ? 'SELECT * FROM activity_events WHERE workspace_id = $1 ORDER BY at DESC, id DESC LIMIT $2'
        : 'SELECT * FROM activity_events WHERE workspace_id = $1 AND (at, id) < ($3, $4) ORDER BY at DESC, id DESC LIMIT $2',
      before === null ? [req.params.wid!, limitRaw] : [req.params.wid!, limitRaw, beforeAt, beforeId],
    );
    const events = rows.rows.map((row: { id: string; at: Date; actor_user_id: string; actor_name: string; action: string; target_name: string }) => ({
      id: row.id,
      at: new Date(row.at).toISOString(),
      actor: { userId: row.actor_user_id, displayName: row.actor_name },
      action: row.action,
      targetName: row.target_name,
    }));
    let nextBefore: string | null = null;
    if (events.length === limitRaw && events.length > 0) {
      const last = events[events.length - 1]!;
      const older = await client.query(
        'SELECT 1 FROM activity_events WHERE workspace_id = $1 AND (at, id) < ($2, $3) LIMIT 1',
        [req.params.wid!, new Date(last.at), last.id],
      );
      nextBefore = older.rows.length > 0 ? last.id : null;
    }
    res.json({ events, nextBefore });
  });
}));

// ---------- projects and scenes ----------

app.get('/api/workspaces/:wid/projects', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  await requireRole(req.params.wid!, user.id, ['owner', 'editor', 'viewer']);
  const rows = await withClient(async (client) => {
    const projects = await client.query(
      `SELECT p.id, p.name,
        (SELECT count(*) FROM scenes s WHERE s.project_id = p.id)::int AS scene_count,
        (SELECT count(*) FROM assets a WHERE a.project_id = p.id)::int AS asset_count,
        COALESCE((SELECT max(updated_at) FROM scenes s WHERE s.project_id = p.id), p.created_at) AS updated_at
       FROM projects p WHERE p.workspace_id = $1 ORDER BY p.created_at ASC`,
      [req.params.wid!],
    );
    return projects.rows;
  });
  res.json({
    projects: rows.map((p: { id: string; name: string; scene_count: number; asset_count: number; updated_at: Date }) => ({
      id: p.id,
      name: p.name,
      sceneCount: p.scene_count,
      assetCount: p.asset_count,
      updatedAt: new Date(p.updated_at).toISOString(),
    })),
  });
}));

app.post('/api/workspaces/:wid/projects', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  await requireRole(req.params.wid!, user.id, ['owner', 'editor']);
  const body = jsonBody(req);
  const name = String(body.name ?? '').trim();
  if (name.length < 1 || name.length > 60) throw new AppError(422, 'validation', 'There is a problem', { name: COPY.fieldErrors.name });
  const project = await withTransaction(async (client) => {
    const id = randomId('prj');
    await client.query('INSERT INTO projects (id, workspace_id, name) VALUES ($1,$2,$3)', [id, req.params.wid!, name]);
    await writeActivity(client, req.params.wid!, user, 'project.created', name);
    return { id, name };
  });
  res.status(201).json({ project: { id: project.id, name: project.name, sceneCount: 0, assetCount: 0, updatedAt: new Date().toISOString() } });
}));

export function assetSummary(row: { id: string; name: string; kind: string; bytes: number; sha256: string; unit: string | null; scale_to_metres: number | null; extent_metres: number | null; created_at: Date }): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    bytes: row.bytes,
    sha256: row.sha256,
    unit: row.unit,
    scaleToMetres: row.scale_to_metres,
    extentMetres: row.extent_metres,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

app.get('/api/projects/:pid', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const workspaceId = await requireRoleForProject(req.params.pid!, user.id, ['owner', 'editor', 'viewer']);
  const data = await withClient(async (client) => {
    const project = await client.query('SELECT * FROM projects WHERE id = $1', [req.params.pid!]);
    const scenes = await client.query('SELECT id, name, status, revision FROM scenes WHERE project_id = $1 ORDER BY created_at ASC', [req.params.pid!]);
    const assets = await client.query('SELECT * FROM assets WHERE project_id = $1 ORDER BY created_at ASC', [req.params.pid!]);
    return { project: project.rows[0], scenes: scenes.rows, assets: assets.rows };
  });
  res.json({
    project: { id: data.project.id, name: data.project.name, sceneCount: data.scenes.length, assetCount: data.assets.length, updatedAt: new Date(data.project.created_at).toISOString() },
    scenes: data.scenes.map((s: { id: string; name: string; status: string; revision: number }) => ({ id: s.id, name: s.name, status: s.status, revision: s.revision })),
    assets: data.assets.map(assetSummary),
    workspaceId,
  });
}));

app.post('/api/projects/:pid/scenes', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  await requireRoleForProject(req.params.pid!, user.id, ['owner', 'editor']);
  const body = jsonBody(req);
  const name = String(body.name ?? '').trim();
  const template = String(body.template ?? 'blank');
  const fields: Record<string, string> = {};
  if (name.length < 1 || name.length > 60) fields.name = COPY.fieldErrors.name;
  if (!['blank', 'ramp', 'pendulum', 'launcher'].includes(template)) fields.template = 'Choose a template.';
  if (Object.keys(fields).length > 0) throw new AppError(422, 'validation', 'There is a problem', fields);
  const result = await withTransaction(async (client) => {
    const doc = templateDocument(template as Template, name);
    const id = randomId('scn');
    const hash = computeStateHash(doc, 0);
    await client.query('INSERT INTO scenes (id, project_id, name) VALUES ($1,$2,$3)', [id, req.params.pid!, name]);
    await client.query('INSERT INTO scene_revisions (scene_id, revision, document, ops, change_id) VALUES ($1,$2,$3,$4,$5)', [id, 1, documentBytes(doc), JSON.stringify([]), null]);
    const ws = await projectWorkspace(client, req.params.pid!);
    await writeActivity(client, ws!, user, 'scene.created', name);
    return { id, hash };
  });
  res.status(201).json({ scene: { id: result.id, name, status: 'draft', revision: 1, stateHash: result.hash } });
}));

app.get('/api/scenes/:sid', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const { scene, workspaceId } = await loadSceneWithAccess(req.params.sid!, user.id);
  const data = await withClient(async (client) => {
    const doc = await loadDocument(client, scene.id, scene.revision);
    const lab = await client.query("SELECT * FROM labs WHERE scene_id = $1 AND status = 'active'", [scene.id]);
    return { doc, lab: lab.rows[0] ?? null };
  });
  res.json({
    scene: {
      id: scene.id,
      projectId: scene.project_id,
      name: scene.name,
      status: scene.status,
      revision: scene.revision,
      stateHash: computeStateHash(data.doc, 0),
      lab: data.lab
        ? {
            token: data.lab.token,
            url: `${PUBLIC_URL}/lab/${data.lab.token}`,
            bundleHash: data.lab.bundle_hash,
            publishedAt: new Date(data.lab.published_at).toISOString(),
            checkpointId: data.lab.checkpoint_id,
            exposed: data.lab.exposed,
          }
        : null,
    },
    document: data.doc,
    workspaceId,
  });
}));

app.get('/api/scenes/:sid/document', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const { scene } = await loadSceneWithAccess(req.params.sid!, user.id);
  const bytes = await withClient(async (client) => documentBytes(await loadDocument(client, scene.id, scene.revision)));
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Revision', String(scene.revision));
  res.send(Buffer.from(bytes, 'utf8'));
}));

// ---------- status ----------

app.get('/api/status', asyncHandler(async (req, res) => {
  res.json(await statusBody());
}));

import { randomBytes } from 'node:crypto';
import { asId, require, roleIn } from './access';
import { userNames } from './auth';
import { instant, now } from './clock';
import { config } from './config';
import { one, pool, rows, transaction } from './db';
import { conflict, forbidden, invalid, notFound } from './errors';
import { notifyMember } from './hub';
import { created, route } from './http';
import { enqueueMail } from './mailer';
import { recordActivity } from './ops';
import { objectBody } from './validate';
import { counted, formatDate, DEFAULT_LOCALE, type Locale } from '../shared/format';
import type { Role } from '../shared/rules';

route('GET', '/api/config', () => ({
  now: instant(),
  palette_max: config.limits.paletteMax,
  sprite_max: config.limits.spriteMax,
  frame_min_ms: config.limits.frameMinMs,
  frame_max_ms: config.limits.frameMaxMs,
  invite_ttl_seconds: config.limits.inviteTtlSeconds,
  long_press_ms: config.limits.longPressMs,
  presence_visible: config.limits.presenceVisible,
  idle_seconds: config.limits.idleSeconds,
  undo_depth: config.limits.undoDepth,
  activity_page: config.limits.activityPage,
  autosave_ms: config.limits.autosaveMs,
  job_item_ms: config.limits.jobItemMs,
  import_max_bytes: config.limits.importMaxBytes,
}));

route('GET', '/api/projects', async (ctx) => ({
  projects: await rows(pool, 'SELECT p.id, p.name, m.role FROM projects p JOIN memberships m ON m.project_id = p.id WHERE m.user_id = $1 ORDER BY p.id', [ctx.need().id]),
}));

route('POST', '/api/projects', async (ctx) => {
  const user = ctx.need();
  const name = typeof objectBody(ctx.body).name === 'string' ? (objectBody(ctx.body).name as string).trim() : '';
  if (name === '' || name.length > 80) throw invalid({ name: 'Name the project in up to 80 characters' });
  const project = await transaction(async (tx) => {
    const row = await one<{ id: number }>(tx, 'INSERT INTO projects (name, owner_id, created_at) VALUES ($1, $2, $3) RETURNING id', [name, user.id, now()]);
    await tx.query("INSERT INTO memberships (project_id, user_id, role) VALUES ($1, $2, 'owner')", [row?.id, user.id]);
    return row;
  });
  return created({ id: project?.id, name, role: 'owner' });
});

route('GET', '/api/projects/:id', async (ctx) => {
  const projectId = asId(ctx.params.id);
  const role = await roleIn(pool, ctx.need().id, projectId);
  const project = await one<{ id: number; name: string }>(pool, 'SELECT id, name FROM projects WHERE id = $1', [projectId]);
  const members = await rows(
    pool,
    `SELECT u.id, u.name, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.project_id = $1
     ORDER BY (m.role = 'owner') DESC, u.id`,
    [projectId],
  );
  const sprites = await rows(pool, 'SELECT id, name FROM sprites WHERE project_id = $1 ORDER BY id', [projectId]);
  const imports = await rows(pool, 'SELECT id, file_name, sprite_id AS sprite FROM imports WHERE project_id = $1 ORDER BY id', [projectId]);
  return { id: project?.id, name: project?.name, role, members, sprites, imports };
});

async function ownerTarget(ctx: { need: () => { id: number }; params: Record<string, string> }): Promise<{ projectId: number; targetId: number }> {
  const projectId = asId(ctx.params.id);
  const targetId = asId(ctx.params.user);
  require(await roleIn(pool, ctx.need().id, projectId), 'owner');
  const target = await one<{ role: Role }>(pool, 'SELECT role FROM memberships WHERE project_id = $1 AND user_id = $2', [projectId, targetId]);
  if (!target) throw notFound();
  if (target.role === 'owner') throw conflict('owner_required');
  return { projectId, targetId };
}

route('PATCH', '/api/projects/:id/members/:user', async (ctx) => {
  const { projectId, targetId } = await ownerTarget(ctx);
  const next = objectBody(ctx.body).role;
  if (next !== 'editor' && next !== 'reviewer') throw invalid({ role: 'Use editor or reviewer' });
  await pool.query('UPDATE memberships SET role = $3 WHERE project_id = $1 AND user_id = $2', [projectId, targetId, next]);
  notifyMember(targetId, projectId, { role: next });
  return { id: targetId, role: next };
});

route('DELETE', '/api/projects/:id/members/:user', async (ctx) => {
  const { projectId, targetId } = await ownerTarget(ctx);
  await pool.query('DELETE FROM memberships WHERE project_id = $1 AND user_id = $2', [projectId, targetId]);
  notifyMember(targetId, projectId, { removed: true });
  return { status: 204 };
});

export type InviteState = 'pending' | 'accepted' | 'revoked' | 'lapsed';

interface InviteRow {
  id: number;
  project_id: number;
  email: string;
  role: Role;
  token: string;
  state: InviteState;
  expires_at: number;
}

/** The one place an invite's state is decided: a pending invite past its end has lapsed. */
export const inviteState = (invite: Pick<InviteRow, 'state' | 'expires_at'>): InviteState =>
  invite.state === 'pending' && invite.expires_at <= now() ? 'lapsed' : invite.state;

route('GET', '/api/projects/:id/invites', async (ctx) => {
  const projectId = asId(ctx.params.id);
  await roleIn(pool, ctx.need().id, projectId);
  const found = await rows<InviteRow>(pool, 'SELECT id, project_id, email, role, token, state, expires_at FROM invites WHERE project_id = $1 ORDER BY id', [projectId]);
  return { invites: found.map((i) => ({ id: i.id, email: i.email, role: i.role, state: inviteState(i), expires_at: instant(i.expires_at) })) };
});

route('POST', '/api/projects/:id/invites', async (ctx) => {
  const user = ctx.need();
  const projectId = asId(ctx.params.id);
  require(await roleIn(pool, user.id, projectId), 'owner');
  const body = objectBody(ctx.body);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  if (emailOk) {
    if (await one(pool, 'SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.project_id = $1 AND u.email = $2', [projectId, email])) throw conflict('already_member');
    const open = await rows<InviteRow>(pool, "SELECT id, state, expires_at FROM invites WHERE project_id = $1 AND email = $2 AND state = 'pending'", [projectId, email] as unknown[]);
    if (open.some((i) => inviteState(i) === 'pending')) throw conflict('invite_pending');
  }
  const errors: Record<string, string> = {};
  if (!emailOk) errors.email = 'Use a valid email address';
  if (body.role !== 'editor' && body.role !== 'reviewer') errors.role = 'Use editor or reviewer';
  if (Object.keys(errors).length > 0) throw invalid(errors);
  const token = randomBytes(18).toString('base64url');
  const expires = now() + config.limits.inviteTtlSeconds * 1000;
  const project = await one<{ name: string }>(pool, 'SELECT name FROM projects WHERE id = $1', [projectId]);
  const invite = await transaction(async (tx) => {
    const row = await one<{ id: number }>(
      tx,
      "INSERT INTO invites (project_id, email, role, token, state, expires_at, created_by, created_at) VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7) RETURNING id",
      [projectId, email, body.role, token, expires, user.id, now()],
    );
    const recipient = await one<Locale>(tx, 'SELECT number_format, time_zone FROM users WHERE email = $1', [email]);
    const origin = config.publicUrl || `http://${ctx.req.headers.host}`;
    await enqueueMail(tx, {
      to: email,
      subject: `Join ${project?.name} on Celmate`,
      body: `Role: ${String(body.role)}\nExpires: ${formatDate(expires, recipient ?? DEFAULT_LOCALE)}\nAccept: ${origin}/invites/${token}`,
    });
    await recordActivity(tx, projectId, user.id, null, { kind: 'invite', data: { email } });
    return row;
  });
  return created({ id: invite?.id, state: 'pending', expires_at: instant(expires) });
});

route('DELETE', '/api/invites/:id', async (ctx) => {
  const user = ctx.need();
  const invite = await one<InviteRow>(pool, 'SELECT id, project_id, state, expires_at FROM invites WHERE id = $1', [asId(ctx.params.id)]);
  if (!invite) throw notFound();
  require(await roleIn(pool, user.id, invite.project_id), 'owner');
  if (inviteState(invite) !== 'pending') throw conflict('invite_closed', { message: 'This invite is closed' });
  await pool.query("UPDATE invites SET state = 'revoked' WHERE id = $1", [invite.id]);
  return { state: 'revoked' };
});

route('GET', '/api/invites/:token', async (ctx) => {
  const invite = await one<InviteRow & { project: string }>(
    pool,
    'SELECT i.id, i.role, i.state, i.expires_at, p.name AS project FROM invites i JOIN projects p ON p.id = i.project_id WHERE i.token = $1',
    [ctx.params.token],
  );
  if (!invite) throw notFound();
  return { project: invite.project, role: invite.role, state: inviteState(invite), expires_at: instant(invite.expires_at) };
});

route('POST', '/api/invites/:token/accept', async (ctx) => {
  const user = ctx.need();
  const invite = await one<InviteRow>(pool, 'SELECT id, project_id, email, role, state, expires_at FROM invites WHERE token = $1', [ctx.params.token]);
  if (!invite) throw notFound();
  if (invite.email !== user.email.toLowerCase()) throw forbidden('This invite is for another email');
  const state = inviteState(invite);
  if (state === 'accepted') throw conflict('invite_used', { message: 'This invite was already used' });
  if (state === 'revoked') throw conflict('invite_revoked', { message: 'This invite was revoked' });
  if (state === 'lapsed') {
    await pool.query("UPDATE invites SET state = 'lapsed' WHERE id = $1", [invite.id]);
    throw conflict('invite_lapsed', { message: 'This invite has lapsed' });
  }
  const claimed = await pool.query("UPDATE invites SET state = 'accepted' WHERE id = $1 AND state = 'pending'", [invite.id]);
  if (claimed.rowCount === 0) throw conflict('invite_used', { message: 'This invite was already used' });
  await pool.query('INSERT INTO memberships (project_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [invite.project_id, user.id, invite.role]);
  return { project: invite.project_id, role: invite.role };
});

interface ActivityRow {
  id: number;
  user_id: number;
  kind: string;
  data: { pixels?: number; strokes?: number; frame?: number; index?: number; snapshot?: string; email?: string; file?: string };
  first_at: number;
  sprite: string | null;
}

route('GET', '/api/projects/:id/activity', async (ctx) => {
  const projectId = asId(ctx.params.id);
  await roleIn(pool, ctx.need().id, projectId);
  const raw = ctx.query.get('cursor');
  const before = raw === null ? 2_147_483_647 : Number(Buffer.from(raw, 'base64url').toString());
  if (!Number.isInteger(before)) throw invalid({ cursor: 'Use the cursor the last page returned' });
  const page = config.limits.activityPage;
  const found = await rows<ActivityRow>(
    pool,
    `SELECT a.id, a.user_id, a.kind, a.data, a.first_at, s.name AS sprite FROM activity a LEFT JOIN sprites s ON s.id = a.sprite_id
     WHERE a.project_id = $1 AND a.id < $2 ORDER BY a.id DESC LIMIT $3`,
    [projectId, before, page + 1],
  );
  const shown = found.slice(0, page);
  const names = await userNames([...new Set(shown.map((a) => a.user_id))]);
  const format = ctx.locale.number_format;
  const sentence = (a: ActivityRow): string => {
    const who = names.get(a.user_id) ?? '';
    const d = a.data;
    switch (a.kind) {
      case 'paint':
        return (d.strokes ?? 1) > 1
          ? `${who} painted ${counted(d.pixels ?? 0, 'pixel', format)} in ${counted(d.strokes ?? 0, 'stroke', format)} on ${a.sprite}`
          : `${who} painted ${counted(d.pixels ?? 0, 'pixel', format)} on ${a.sprite}, frame ${d.frame}`;
      case 'swatch':
        return `${who} edited swatch ${d.index}`;
      case 'restore':
        return `${who} restored ${d.snapshot}`;
      case 'comment':
        return `${who} commented on ${a.sprite}`;
      case 'invite':
        return `${who} invited ${d.email}`;
      default:
        return `${who} exported ${d.file}`;
    }
  };
  const last = shown[shown.length - 1];
  return {
    items: shown.map((a) => ({ id: a.id, sentence: sentence(a), at: instant(a.first_at) })),
    next_cursor: found.length > page && last ? Buffer.from(String(last.id)).toString('base64url') : null,
  };
});

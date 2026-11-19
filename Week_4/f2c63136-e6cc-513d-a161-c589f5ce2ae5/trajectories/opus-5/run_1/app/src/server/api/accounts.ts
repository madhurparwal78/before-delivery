import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { serverNow } from '../clock.js';
import { db, isDatabaseReady, withTx } from '../db.js';
import { ApiError, forbidden, invalidFields, notFound } from '../errors.js';
import {
  clearSessionCookie,
  hashToken,
  newSessionToken,
  parseCookies,
  requireOrgOwner,
  requireUser,
  sendJson,
  setSessionCookie,
  SESSION_COOKIE,
  type Ctx,
} from '../http.js';
import { changeMailBody, enqueueMail } from '../mail.js';
import { storageReachable } from '../storage.js';
import {
  createUser,
  isValidEmail,
  isValidSlug,
  isValidUsername,
  RESERVED_USERNAMES,
  verifyPassword,
} from '../../domain/accounts.js';
import { getUserByUsername, listAllRepos, roleFor } from '../../domain/model.js';
import { createRevision, setBranchRevision } from '../../domain/revisions.js';
import { asString, body } from './common.js';

export async function handleSignup(ctx: Ctx): Promise<void> {
  const input = body(ctx);
  const email = asString(input.email);
  const username = asString(input.username);
  const name = asString(input.name);
  const password = asString(input.password);
  const errors: Record<string, string> = {};

  if (!isValidUsername(username)) errors.username = 'Username is invalid';
  if (!isValidEmail(email)) errors.email = 'Email is invalid';
  if (password.length < 8) errors.password = 'Password must be at least 8 characters';
  if (name.trim() === '') errors.name = 'Name is required';

  if (!errors.username) {
    const taken = RESERVED_USERNAMES.has(username) || (await getUserByUsername(db, username)) !== null;
    if (taken) errors.username = 'Username is taken';
  }
  if (!errors.email) {
    const rows = await db.query('SELECT 1 FROM rs_users WHERE email = $1', [email]);
    if (rows.length > 0) errors.email = 'Email is already registered';
  }
  if (Object.keys(errors).length > 0) throw invalidFields(errors);

  await withTx(async (tx) => {
    const created = await createUser(tx, { email, username, name, password, confirmed: false });
    await enqueueMail(tx, {
      to: email,
      subject: 'Confirm your Ridgestack account',
      body: changeMailBody([
        `Welcome to Ridgestack, ${name}.`,
        `Confirm your account: ${config.appPublicUrl}/confirm/${created.confirmToken}`,
      ]),
      changeHeader: null,
    });
  });
  sendJson(ctx.response, 201, { status: 'confirmation_sent' });
}

export async function handleConfirm(ctx: Ctx): Promise<void> {
  const token = asString(body(ctx).token);
  const username = await withTx(async (tx) => {
    const rows = await tx.query<{ id: string; username: string }>(
      'SELECT id, username FROM rs_users WHERE confirm_token = $1',
      [token],
    );
    if (rows.length === 0) throw notFound();
    await tx.query('UPDATE rs_users SET confirmed = true, confirm_token = NULL WHERE id = $1', [rows[0].id]);
    return rows[0].username;
  });
  sendJson(ctx.response, 200, { username });
}

export async function handleLogin(ctx: Ctx): Promise<void> {
  const input = body(ctx);
  const email = asString(input.email);
  const password = asString(input.password);
  const rows = await db.query<{ id: string; username: string; name: string; password_hash: string; confirmed: boolean }>(
    'SELECT id, username, name, password_hash, confirmed FROM rs_users WHERE email = $1',
    [email],
  );
  if (rows.length === 0 || !verifyPassword(password, rows[0].password_hash)) {
    throw new ApiError(401, { error: 'Email or password is wrong' });
  }
  if (!rows[0].confirmed) throw forbidden('Confirm your email first');
  const token = newSessionToken();
  await db.query('INSERT INTO rs_sessions (token, user_id, created_at) VALUES ($1, $2, $3)', [
    token,
    rows[0].id,
    serverNow(),
  ]);
  setSessionCookie(ctx.response, token);
  sendJson(ctx.response, 200, { username: rows[0].username, name: rows[0].name });
}

export async function handleLogout(ctx: Ctx): Promise<void> {
  const cookies = parseCookies(ctx.request.headers.cookie);
  const session = cookies[SESSION_COOKIE];
  if (session) await db.query('DELETE FROM rs_sessions WHERE token = $1', [session]);
  clearSessionCookie(ctx.response);
  ctx.response.writeHead(204).end();
}

export async function handleMe(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  sendJson(ctx.response, 200, { username: user.username, name: user.name, email: user.email });
}

export async function handleHealth(ctx: Ctx): Promise<void> {
  const storage = await storageReachable();
  const ok = isDatabaseReady() && storage;
  sendJson(ctx.response, 200, { status: ok ? 'ok' : 'unavailable' });
}

export async function handleCreateOrg(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const input = body(ctx);
  const slug = asString(input.slug);
  const name = asString(input.name);
  const errors: Record<string, string> = {};
  if (!isValidSlug(slug)) errors.slug = 'Address is invalid';
  if (name.trim() === '') errors.name = 'Name is required';
  if (!errors.slug) {
    const rows = await db.query('SELECT 1 FROM rs_orgs WHERE slug = $1', [slug]);
    if (rows.length > 0) errors.slug = 'Address is taken';
  }
  if (Object.keys(errors).length > 0) throw invalidFields(errors);

  await db.query('INSERT INTO rs_orgs (slug, name, owner_user_id) VALUES ($1, $2, $3)', [slug, name, user.id]);
  sendJson(ctx.response, 201, { slug, name });
}

export async function handleCreateTeam(ctx: Ctx, orgSlug: string): Promise<void> {
  await withTx(async (tx) => {
    await requireOrgOwner(tx, ctx, orgSlug);
    const name = asString(body(ctx).name);
    if (!isValidSlug(name)) throw invalidFields({ name: 'Name is invalid' });
    const org = await tx.query<{ id: string }>('SELECT id FROM rs_orgs WHERE slug = $1', [orgSlug]);
    const existing = await tx.query('SELECT 1 FROM rs_teams WHERE org_id = $1 AND name = $2', [org[0].id, name]);
    if (existing.length > 0) throw invalidFields({ name: 'Name is taken' });
    await tx.query('INSERT INTO rs_teams (org_id, name) VALUES ($1, $2)', [org[0].id, name]);
    sendJson(ctx.response, 201, { name });
  });
}

export async function handleAddTeamMember(
  ctx: Ctx,
  orgSlug: string,
  teamName: string,
  username: string,
): Promise<void> {
  await withTx(async (tx) => {
    await requireOrgOwner(tx, ctx, orgSlug);
    const team = await tx.query<{ id: string }>(
      `SELECT t.id FROM rs_teams t JOIN rs_orgs o ON o.id = t.org_id WHERE o.slug = $1 AND t.name = $2`,
      [orgSlug, teamName],
    );
    if (team.length === 0) throw notFound();
    const user = await getUserByUsername(tx, username);
    if (!user) throw notFound();
    await tx.query(
      'INSERT INTO rs_team_members (team_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [team[0].id, user.id],
    );
    ctx.response.writeHead(204).end();
  });
}

export async function handleListRepos(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const repos = await listAllRepos(db);
  const visible: Array<Record<string, unknown>> = [];
  for (const repo of repos) {
    const role = await roleFor(db, repo, user.id);
    if (role === null) continue;
    visible.push({ id: repo.id, org: repo.org, name: repo.name, visibility: repo.visibility, your_role: role });
  }
  sendJson(ctx.response, 200, visible);
}

export async function handleCreateRepo(ctx: Ctx, orgSlug: string): Promise<void> {
  await withTx(async (tx) => {
    const user = await requireOrgOwner(tx, ctx, orgSlug);
    const input = body(ctx);
    const name = asString(input.name);
    const visibility = asString(input.visibility);
    if (!isValidSlug(name)) throw invalidFields({ name: 'Name is invalid' });
    if (visibility !== 'private' && visibility !== 'public') {
      throw invalidFields({ visibility: 'Visibility must be private or public' });
    }
    const org = await tx.query<{ id: string }>('SELECT id FROM rs_orgs WHERE slug = $1', [orgSlug]);
    const existing = await tx.query('SELECT 1 FROM rs_repos WHERE org_id = $1 AND name = $2', [org[0].id, name]);
    if (existing.length > 0) throw invalidFields({ name: 'Name is taken' });

    const rows = await tx.query<{ id: string }>(
      `INSERT INTO rs_repos (org_id, name, visibility, default_branch, required_approvals, required_checks, queue_on)
       VALUES ($1, $2, $3, 'main', 1, '{}', false) RETURNING id`,
      [org[0].id, name, visibility],
    );
    const repoId = Number(rows[0].id);
    await tx.query(
      "INSERT INTO rs_roles (repo_id, subject_type, subject_id, role) VALUES ($1, 'user', $2, 'owner')",
      [repoId, user.id],
    );
    const revision = await createRevision(tx, repoId, {
      parents: [],
      message: 'Initial revision',
      authorUsername: user.username,
      authorName: user.name,
      contents: new Map(),
    });
    await setBranchRevision(tx, repoId, 'main', revision);
    sendJson(ctx.response, 201, {
      id: repoId,
      org: orgSlug,
      name,
      visibility,
      default_branch: 'main',
    });
  });
}

export function randomTokenValue(): string {
  return `rgs_${randomBytes(20).toString('hex')}`;
}

export function tokenHash(value: string): string {
  return hashToken(value);
}

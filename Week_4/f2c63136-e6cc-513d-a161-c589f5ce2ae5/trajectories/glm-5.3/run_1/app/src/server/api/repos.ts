import { randomBytes } from 'node:crypto';
import { Errors, hashToken, expectObject, visibleRepo, type RequestContext , parseBodyWithLimit } from './context.js';
import { isValidSlug } from '../../shared/rules.js';
import { getRepoByPath, getRepoById, type RepoRow } from '../store/revisions.js';
import { roleFor } from '../store/changes.js';
import type { Role } from '../store/changes.js';
import { revisionFileTexts, revisionFileRows, insertRevision, computeRevisionId } from '../store/revisions.js';
import { contentKey } from '../storage.js';
import { byteOrder, byteLength } from '../../shared/bytes.js';

function parseBody(ctx: { cfg: { pushSizeLimitBytes: number }; req: { body: Buffer; url: URL } }): unknown {
  return parseBodyWithLimit(ctx);
}

const ROLE_ORDER: Role[] = ['none', 'reader', 'writer', 'maintainer', 'owner'];

/** GET /api/repos */
export async function listRepos(ctx: RequestContext): Promise<{ status: number; body: unknown }> {
  if (!ctx.auth.user) throw Errors.unauthenticated();
  const rows = await ctx.tx.query(
    `SELECT r.id, o.slug AS org, r.name, r.visibility FROM repos r JOIN orgs o ON o.id = r.org_id ORDER BY o.slug, r.name`,
  );
  const out = [];
  for (const row of rows.rows) {
    const repo = await getRepoById(ctx.tx, row.id);
    if (!repo) continue;
    const role = await roleFor(ctx.tx, repo, ctx.auth.user);
    if (role === 'none') continue;
    out.push({ id: row.id, org: row.org, name: row.name, visibility: row.visibility, your_role: role });
  }
  return { status: 200, body: out };
}

/** POST /api/orgs/<org>/repos */
export async function createRepo(ctx: RequestContext, org: string): Promise<{ status: number; body: unknown }> {
  if (!ctx.auth.user) throw Errors.unauthenticated();
  const orgRow = await ctx.tx.query('SELECT * FROM orgs WHERE slug = $1', [org]);
  if (orgRow.rows.length === 0) throw Errors.notFound();
  const isOwner = await ctx.tx.query('SELECT 1 FROM org_owners WHERE org_id = $1 AND user_id = $2', [orgRow.rows[0].id, ctx.auth.user.id]);
  if (isOwner.rows.length === 0) throw Errors.forbidden('Only organisation owners can do that');
  const body = expectObject(parseBody(ctx));
  const name = typeof body.name === 'string' ? body.name : '';
  const visibility = body.visibility === 'public' ? 'public' : body.visibility === 'private' ? 'private' : '';
  const errors: Record<string, string> = {};
  if (!name) errors.name = 'Name is required';
  else if (!isValidSlug(name)) errors.name = 'Name is invalid';
  if (!visibility) errors.name = errors.name ?? 'Visibility is invalid';
  if (Object.keys(errors).length > 0) throw Errors.invalid(errors);
  const taken = await ctx.tx.query('SELECT 1 FROM repos WHERE org_id = $1 AND name = $2', [orgRow.rows[0].id, name]);
  if (taken.rows.length > 0) throw Errors.invalid({ name: 'Name is taken' });
  const insert = await ctx.tx.query(
    "INSERT INTO repos (org_id, name, visibility, required_approvals, required_checks, queue) VALUES ($1,$2,$3,1,'{}',false) RETURNING id",
    [orgRow.rows[0].id, name, visibility],
  );
  const repoId = insert.rows[0].id;
  await ctx.tx.query("INSERT INTO repo_roles (repo_id, subject, role) VALUES ($1,$2,'owner')", [repoId, `user:${ctx.auth.user.username}`]);
  // main starts at an empty root revision with message "Initial revision".
  const empty = new Map<string, string>();
  const rootId = computeRevisionId([], 'Initial revision', empty);
  const keyMap = new Map<string, { key: string; size: number }>();
  await insertRevision(ctx.tx, repoId, rootId, 'Initial revision',
    { username: ctx.auth.user.username, name: ctx.auth.user.name }, [null, null], keyMap, ctx.clock.nowMs());
  await ctx.tx.query('INSERT INTO branches (repo_id, name, revision_id) VALUES ($1,$2,$3)', [repoId, 'main', rootId]);
  return {
    status: 201,
    body: { id: repoId, org, name, visibility, default_branch: 'main' },
  };
}

/** GET /api/repos/<org>/<repo> */
export async function getRepo(ctx: RequestContext, org: string, name: string): Promise<{ status: number; body: unknown }> {
  const repo = await visibleRepo(ctx, org, name, 'read');
  let yourRole: string = 'reader';
  if (ctx.auth.user) yourRole = await roleFor(ctx.tx, repo, ctx.auth.user);
  return {
    status: 200,
    body: {
      id: repo.id, org, name, visibility: repo.visibility, your_role: yourRole,
      settings: {
        required_approvals: repo.required_approvals,
        required_checks: repo.required_checks,
        queue: repo.queue,
      },
    },
  };
}

/** PUT /api/repos/<org>/<repo>/settings */
export async function updateSettings(ctx: RequestContext, org: string, name: string): Promise<{ status: number; body: unknown }> {
  await visibleRepo(ctx, org, name, 'maintainer');
  const repo = await getRepoByPath(ctx.tx, org, name) as RepoRow;
  const body = expectObject(parseBody(ctx));
  const errors: Record<string, string> = {};
  let approvals: number | undefined;
  let checks: string[] | undefined;
  let queue: boolean | undefined;
  let visibility: string | undefined;
  if ('required_approvals' in body) {
    const v = body.required_approvals;
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10) approvals = v;
    else errors.required_approvals = 'Must be a whole number from 0 to 10';
  }
  if ('required_checks' in body) {
    const v = body.required_checks;
    if (Array.isArray(v) && v.length <= 20 && v.every((n) => typeof n === 'string' && n.length >= 1 && n.length <= 64) && new Set(v).size === v.length) {
      checks = v as string[];
    } else errors.required_checks = 'Must be at most 20 unique names of 1 to 64 characters';
  }
  if ('queue' in body) {
    const v = body.queue;
    if (typeof v === 'boolean') queue = v;
    else errors.queue = 'Queue is required';
  }
  if ('visibility' in body) {
    const v = body.visibility;
    if (v === 'public' || v === 'private') visibility = v;
    else errors.visibility = 'Visibility is invalid';
  }
  if (Object.keys(errors).length > 0) throw Errors.invalid(errors);
  if (approvals !== undefined) await ctx.tx.query('UPDATE repos SET required_approvals = $1 WHERE id = $2', [approvals, repo.id]);
  if (checks !== undefined) await ctx.tx.query('UPDATE repos SET required_checks = $1 WHERE id = $2', [checks, repo.id]);
  if (queue !== undefined) await ctx.tx.query('UPDATE repos SET queue = $1 WHERE id = $2', [queue, repo.id]);
  if (visibility !== undefined) await ctx.tx.query('UPDATE repos SET visibility = $1 WHERE id = $2', [visibility, repo.id]);
  const updated = await getRepoById(ctx.tx, repo.id) as RepoRow;
  return {
    status: 200,
    body: { required_approvals: updated.required_approvals, required_checks: updated.required_checks, queue: updated.queue },
  };
}

/** PUT /api/repos/<org>/<repo>/roles */
export async function grantRole(ctx: RequestContext, org: string, name: string): Promise<{ status: number; body: unknown }> {
  const repo = await visibleRepo(ctx, org, name, 'maintainer');
  const body = expectObject(parseBody(ctx));
  const subject = typeof body.subject === 'string' ? body.subject : '';
  const role = body.role;
  if (role === 'owner') {
    const me = await roleFor(ctx.tx, repo, ctx.auth.user!);
    if (me !== 'owner') throw Errors.forbidden('Only owners can grant owner');
  }
  if (!['reader', 'writer', 'maintainer', 'owner'].includes(role as string)) {
    throw Errors.invalid({ role: 'Role is invalid' });
  }
  if (subject.startsWith('user:')) {
    const u = await ctx.tx.query('SELECT id FROM users WHERE username = $1', [subject.slice(5)]);
    if (u.rows.length === 0) throw Errors.notFound();
  } else if (subject.startsWith('team:')) {
    const t = await ctx.tx.query('SELECT 1 FROM teams WHERE org_id = $1 AND name = $2', [repo.org_id, subject.slice(5)]);
    if (t.rows.length === 0) throw Errors.notFound();
  } else throw Errors.notFound();
  await ctx.tx.query(
    'INSERT INTO repo_roles (repo_id, subject, role) VALUES ($1,$2,$3) ON CONFLICT (repo_id, subject) DO UPDATE SET role = EXCLUDED.role',
    [repo.id, subject, role],
  );
  return { status: 204, body: null };
}

/** DELETE /api/repos/<org>/<repo>/roles/<subject> */
export async function removeRole(ctx: RequestContext, org: string, name: string, subject: string): Promise<{ status: number; body: unknown }> {
  await visibleRepo(ctx, org, name, 'maintainer');
  await ctx.tx.query('DELETE FROM repo_roles WHERE subject = $1', [subject]);
  return { status: 204, body: null };
}

/** POST /api/repos/<org>/<repo>/tokens */
export async function createToken(ctx: RequestContext, org: string, name: string): Promise<{ status: number; body: unknown }> {
  await visibleRepo(ctx, org, name, 'maintainer');
  const repo = await getRepoByPath(ctx.tx, org, name) as RepoRow;
  const body = expectObject(parseBody(ctx));
  const tokenName = typeof body.name === 'string' ? body.name : '';
  const access = body.access === 'read' ? 'read' : body.access === 'write' ? 'write' : '';
  const errors: Record<string, string> = {};
  if (!tokenName) errors.name = 'Name is required';
  if (!access) errors.access = 'Access is invalid';
  if (Object.keys(errors).length > 0) throw Errors.invalid(errors);
  const value = `rgs_${randomBytes(20).toString('hex')}`;
  const insert = await ctx.tx.query(
    'INSERT INTO tokens (repo_id, name, access, token_hash, created_at_ms) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [repo.id, tokenName, access, hashToken(value), ctx.clock.nowMs()],
  );
  return { status: 201, body: { id: insert.rows[0].id, name: tokenName, access, token: value } };
}

/** DELETE /api/repos/<org>/<repo>/tokens/<id> */
export async function revokeToken(ctx: RequestContext, org: string, name: string, id: number): Promise<{ status: number; body: unknown }> {
  await visibleRepo(ctx, org, name, 'maintainer');
  const repo = await getRepoByPath(ctx.tx, org, name) as RepoRow;
  await ctx.tx.query('DELETE FROM tokens WHERE id = $1 AND repo_id = $2', [id, repo.id]);
  return { status: 204, body: null };
}

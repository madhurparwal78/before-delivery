import { Errors, expectObject, hashToken, newSessionToken, type RequestContext , parseBodyWithLimit } from './context.js';
import { isValidUsername, isValidSlug, isValidEmail } from '../../shared/rules.js';
import { hashPassword } from './accounts.js';
import { getRepoByPath, getBranch, getChange, type ChangeRow } from '../store/revisions.js';
import { performPush, restackAbove } from '../store/push.js';
import { admitToQueue, mergeChangeIntoBase, getQueueEntries } from '../store/queue.js';

function parseBody(ctx: { cfg: { pushSizeLimitBytes: number }; req: { body: Buffer; url: URL } }): unknown {
  return parseBodyWithLimit(ctx);
}

interface SetupUser { email: string; username: string; name: string; password: string }
interface SetupOrg { slug: string; name: string; owner?: string; members?: string[]; teams?: Array<{ name: string; members: string[] }> }
interface SetupRepo {
  org: string; name: string; visibility: 'public' | 'private'; owner?: string;
  roles?: Array<{ subject: string; role: string }>;
  settings?: { required_approvals?: number; required_checks?: string[]; queue?: boolean };
  steps?: SetupStep[];
}
interface SetupStep {
  as: string;
  key?: string;
  push?: { branch: string; from?: string; message: string; files: Record<string, string | null> };
  change?: { title: string; head: string; base: string; draft?: boolean };
  ready?: { change: string };
  review?: { change: string; type: string; summary?: string };
  dismiss?: { review: string; reason: string };
  thread?: { change: string; path: string; side: string; line: number; end_line?: number; body: string; suggestion?: string[] };
  request_review?: { change: string; username: string };
  check?: { revision: string; name: string; state: string; summary?: string };
  queue?: { change: string };
  token?: { name: string; access: string };
  viewed?: { change: string; path: string };
}

/**
 * POST /api/grading/setup — one call that creates users, orgs and repos and
 * runs each repository's steps as the real operations, skipping role checks.
 */
export async function setup(ctx: RequestContext): Promise<{ status: number; body: unknown }> {
  const body = expectObject(parseBody(ctx));
  const users = Array.isArray(body.users) ? body.users : [];
  const orgs = Array.isArray(body.orgs) ? body.orgs : [];
  const repos = Array.isArray(body.repos) ? body.repos : [];
  const cookies: Record<string, string> = {};
  const userIds: Record<string, number> = {};
  for (const u of users) {
    const spec = u as SetupUser;
    if (!isValidUsername(spec.username)) throw Errors.invalid({ username: 'Username is invalid' });
    if (!isValidEmail(spec.email)) throw Errors.invalid({ email: 'Email is invalid' });
    const existing = await ctx.tx.query('SELECT id FROM users WHERE username = $1 OR email = $2', [spec.username, spec.email]);
    if (existing.rows.length > 0) throw new (await import('./context.js')).ApiError(409, { error: `Already exists: user ${spec.username}` });
    const insert = await ctx.tx.query(
      'INSERT INTO users (username, email, name, password_hash, confirmed, created_at_ms) VALUES ($1,$2,$3,$4,true,$5) RETURNING id',
      [spec.username, spec.email, spec.name, hashPassword(spec.password), ctx.clock.nowMs()],
    );
    userIds[spec.username] = insert.rows[0].id;
    const session = newSessionToken();
    await ctx.tx.query('INSERT INTO sessions (token, user_id, created_at_ms) VALUES ($1,$2,$3)', [session, insert.rows[0].id, ctx.clock.nowMs()]);
    cookies[spec.username] = session;
  }
  const orgIds: Record<string, number> = {};
  for (const o of orgs) {
    const spec = o as SetupOrg;
    if (!isValidSlug(spec.slug)) throw Errors.invalid({ slug: 'Address is invalid' });
    const existing = await ctx.tx.query('SELECT id FROM orgs WHERE slug = $1', [spec.slug]);
    if (existing.rows.length > 0) throw new (await import('./context.js')).ApiError(409, { error: `Already exists: org ${spec.slug}` });
    const insert = await ctx.tx.query('INSERT INTO orgs (slug, name) VALUES ($1,$2) RETURNING id', [spec.slug, spec.name]);
    orgIds[spec.slug] = insert.rows[0].id;
    const ownerName = spec.owner ?? users[0]?.username;
    if (ownerName && userIds[ownerName]) {
      await ctx.tx.query('INSERT INTO org_owners (org_id, user_id) VALUES ($1,$2)', [insert.rows[0].id, userIds[ownerName]]);
    }
    for (const m of spec.members ?? []) {
      if (userIds[m]) await ctx.tx.query('INSERT INTO org_owners (org_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [insert.rows[0].id, userIds[m]]);
    }
    for (const team of spec.teams ?? []) {
      await ctx.tx.query('INSERT INTO teams (org_id, name) VALUES ($1,$2)', [insert.rows[0].id, team.name]);
      for (const m of team.members) {
        if (userIds[m]) await ctx.tx.query('INSERT INTO team_members (org_id, team_name, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [insert.rows[0].id, team.name, userIds[m]]);
      }
    }
  }
  const repoOut: Record<string, { id: number; keys: Record<string, unknown> }> = {};
  for (const r of repos) {
    const spec = r as SetupRepo;
    const existing = await ctx.tx.query('SELECT id FROM repos WHERE org_id = $1 AND name = $2', [orgIds[spec.org], spec.name]);
    if (existing.rows.length > 0) throw new (await import('./context.js')).ApiError(409, { error: `Already exists: repo ${spec.org}/${spec.name}` });
    const settings = spec.settings ?? {};
    const insert = await ctx.tx.query(
      `INSERT INTO repos (org_id, name, visibility, required_approvals, required_checks, queue)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        orgIds[spec.org], spec.name, spec.visibility,
        settings.required_approvals ?? 1,
        settings.required_checks ?? [],
        settings.queue ?? false,
      ],
    );
    const repoId = insert.rows[0].id;
    // Roles from the payload; without any the org owner owns the repository.
    const roleSpecs = spec.roles ?? [{ subject: `user:${spec.owner ?? (users[0] as SetupUser | undefined)?.username ?? ''}`, role: 'owner' }];
    for (const roleSpec of roleSpecs) {
      await ctx.tx.query(
        'INSERT INTO repo_roles (repo_id, subject, role) VALUES ($1,$2,$3) ON CONFLICT (repo_id, subject) DO UPDATE SET role = EXCLUDED.role',
        [repoId, roleSpec.subject, roleSpec.role],
      );
    }
    // main with the root revision.
    const rootFiles = new Map<string, string>();
    const rootId = (await import('../store/revisions.js')).computeRevisionId([], 'Initial revision', rootFiles);
    const ownerUser = users.find((u) => (u as SetupUser).username === (spec.roles?.find((x) => x.role === 'owner')?.subject.replace('user:', '')));
    const creator = ownerUser ? ownerUser.username : (users[0] as SetupUser | undefined)?.username ?? 'merge-queue';
    const creatorUser = await ctx.tx.query('SELECT username, name FROM users WHERE username = $1', [creator]);
    await (await import('../store/revisions.js')).insertRevision(
      ctx.tx, repoId, rootId, 'Initial revision',
      creatorUser.rows[0] ?? { username: creator, name: creator }, [null, null], new Map(), ctx.clock.nowMs(),
    );
    await ctx.tx.query('INSERT INTO branches (repo_id, name, revision_id) VALUES ($1,$2,$3)', [repoId, 'main', rootId]);
    const keys: Record<string, unknown> = {};
    // Run the steps in order as the named user.
    for (const step of spec.steps ?? []) {
      const key = await runStep(ctx, repoId, spec.org, spec.name, step, keys, userIds);
      if (step.key && key !== undefined) keys[step.key] = key;
    }
    repoOut[`${spec.org}/${spec.name}`] = { id: repoId, keys };
  }
  return { status: 201, body: { users: Object.fromEntries(Object.entries(cookies).map(([u, c]) => [u, { cookie: c }])), repos: repoOut } };
}

async function runStep(
  ctx: RequestContext, repoId: number, org: string, repoName: string,
  step: SetupStep, keys: Record<string, unknown>, userIds: Record<string, number>,
): Promise<unknown> {
  const as = step.as;
  const userRow = await ctx.tx.query('SELECT id, username, name, email FROM users WHERE username = $1', [as]);
  if (userRow.rows.length === 0) throw Errors.notFound();
  const user = userRow.rows[0];
  const { getRepoById, getBranch: gb, getChange: gc } = await import('../store/revisions.js');
  const repo = await getRepoById(ctx.tx, repoId);
  const deps = serviceDeps(ctx);
  if (step.push) {
    const push = step.push;
    const branchRow = await gb(ctx.tx, repoId, push.branch);
    let parent: string;
    if (!branchRow) {
      const fromName = push.from ?? 'main';
      const fromRow = await gb(ctx.tx, repoId, fromName);
      if (!fromRow) throw Errors.notFound();
      parent = fromRow.revision_id;
      await ctx.tx.query('INSERT INTO branches (repo_id, name, revision_id) VALUES ($1,$2,$3)', [repoId, push.branch, parent]);
    } else {
      parent = branchRow.revision_id;
    }
    const files = Object.entries(push.files).map(([path, content]) => ({ path, content: content === null ? null : content }));
    const author = step.as === 'token' ? { username: `token:${push.branch}`, name: push.branch } : { username: user.username, name: user.name };
    const outcome = await performPush(deps, ctx.tx, repoId, push.branch, parent, push.message, files, author);
    return { revision: outcome.revision };
  }
  if (step.change) {
    const baseBranch = await gb(ctx.tx, repoId, step.change.base);
    if (!baseBranch) throw Errors.notFound();
    const nextNumber = await ctx.tx.query('SELECT COALESCE(MAX(number),0)+1 AS n FROM changes WHERE repo_id = $1', [repoId]);
    const number = nextNumber.rows[0].n;
    await ctx.tx.query(
      `INSERT INTO changes (repo_id, number, title, description, head_branch, base_branch, base_revision, state, draft, author_id, created_at_ms)
       VALUES ($1,$2,$3,'',$4,$5,$6,'open',$7,$8,$9)`,
      [repoId, number, step.change.title, step.change.head, step.change.base, baseBranch.revision_id, step.change.draft === true, user.id, ctx.clock.nowMs()],
    );
    return { number, id: `${org}/${repoName}#${number}` };
  }
  if (step.ready) {
    const n = changeNumberOf(keys, step.ready.change);
    await ctx.tx.query('UPDATE changes SET draft = false WHERE repo_id = $1 AND number = $2', [repoId, n]);
    return {};
  }
  if (step.review) {
    const n = changeNumberOf(keys, step.review.change);
    const change = await gc(ctx.tx, repoId, n) as ChangeRow;
    const diff = await (await import('../store/revisions.js')).changeCombinedDiff(ctx.tx, ctx.storage, change);
    const state = step.review.type === 'approve' ? 'approved' : step.review.type === 'request_changes' ? 'changes_requested' : 'commented';
    const insert = await ctx.tx.query(
      `INSERT INTO reviews (repo_id, change_number, reviewer_id, type, state, summary, reason, dismissed_by, diff_signature, created_at_ms)
       VALUES ($1,$2,$3,$4,$5,$6,NULL,NULL,$7,$8) RETURNING id`,
      [repoId, n, user.id, step.review.type, state, step.review.summary ?? '', (await import('../store/domain.js')).diffSignature(diff), ctx.clock.nowMs()],
    );
    return { id: insert.rows[0].id };
  }
  if (step.dismiss) {
    const reviewId = reviewIdOf(keys, step.dismiss.review);
    await ctx.tx.query(
      "UPDATE reviews SET state = 'dismissed', reason = $1, dismissed_by = $2 WHERE id = $3",
      [`Dismissed by ${user.name}: ${step.dismiss.reason}`, user.id, reviewId],
    );
    return { id: reviewId };
  }
  if (step.thread) {
    const n = changeNumberOf(keys, step.thread.change);
    const change = await gc(ctx.tx, repoId, n) as ChangeRow;
    const headBranch = await gb(ctx.tx, repoId, change.head_branch);
    const insert = await ctx.tx.query(
      `INSERT INTO threads (repo_id, change_number, path, side, line, end_line, state, outdated, revision, created_at_ms)
       VALUES ($1,$2,$3,$4,$5,$6,'unresolved',false,$7,$8) RETURNING id`,
      [repoId, n, step.thread.path, step.thread.side, step.thread.line, step.thread.end_line ?? step.thread.line, headBranch ? headBranch.revision_id : change.base_revision, ctx.clock.nowMs()],
    );
    const comment = await ctx.tx.query(
      `INSERT INTO comments (thread_id, author_id, body, created_at_ms, suggestion_lines, suggestion_state, suggestion_line, suggestion_end_line)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [insert.rows[0].id, user.id, step.thread.body, ctx.clock.nowMs(),
        step.thread.suggestion ? JSON.stringify(step.thread.suggestion) : null,
        step.thread.suggestion ? 'open' : null,
        step.thread.line, step.thread.end_line ?? step.thread.line],
    );
    return { id: insert.rows[0].id, comment: comment.rows[0].id };
  }
  if (step.request_review) {
    const n = changeNumberOf(keys, step.request_review.change);
    const target = await ctx.tx.query('SELECT id FROM users WHERE username = $1', [step.request_review.username]);
    if (target.rows.length === 0) throw Errors.notFound();
    await ctx.tx.query(
      'INSERT INTO review_requests (repo_id, change_number, user_id, pending, created_at_ms) VALUES ($1,$2,$3,true,$4)',
      [repoId, n, target.rows[0].id, ctx.clock.nowMs()],
    );
    return {};
  }
  if (step.check) {
    const revision = typeof step.check.revision === 'string' && step.check.revision.length === 12
      ? step.check.revision
      : revisionOf(keys, step.check.revision);
    await ctx.tx.query(
      'INSERT INTO checks (repo_id, revision, name, state, summary, created_at_ms) VALUES ($1,$2,$3,$4,$5,$6)',
      [repoId, revision, step.check.name, step.check.state, step.check.summary ?? '', ctx.clock.nowMs()],
    );
    return { revision, name: step.check.name, state: step.check.state };
  }
  if (step.queue) {
    const n = changeNumberOf(keys, step.queue.change);
    const change = await gc(ctx.tx, repoId, n) as ChangeRow;
    const entry = await admitToQueue(deps, ctx.tx, repoId, change);
    return { id: entry.id, revision: entry.revision, state: entry.state };
  }
  if (step.token) {
    const value = `rgs_${(await import('node:crypto')).randomBytes(20).toString('hex')}`;
    const insert = await ctx.tx.query(
      'INSERT INTO tokens (repo_id, name, access, token_hash, created_at_ms) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [repoId, step.token.name, step.token.access, hashToken(value), ctx.clock.nowMs()],
    );
    return { id: insert.rows[0].id, token: value };
  }
  if (step.viewed) {
    const n = changeNumberOf(keys, step.viewed.change);
    await ctx.tx.query(
      'INSERT INTO viewed_marks (repo_id, change_number, path, user_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [repoId, n, step.viewed.path, user.id],
    );
    return {};
  }
  return {};
}

function changeNumberOf(keys: Record<string, unknown>, ref: string): number {
  const entry = keys[ref] as { number?: number } | undefined;
  if (entry && typeof entry.number === 'number') return entry.number;
  const n = Number(ref);
  if (Number.isInteger(n) && n > 0) return n;
  throw Errors.notFound();
}

function reviewIdOf(keys: Record<string, unknown>, ref: string): number {
  const entry = keys[ref] as { id?: number } | undefined;
  if (entry && typeof entry.id === 'number') return entry.id;
  const n = Number(ref);
  if (Number.isInteger(n)) return n;
  throw Errors.notFound();
}

function revisionOf(keys: Record<string, unknown>, ref: string): string {
  const entry = keys[ref] as { revision?: string } | undefined;
  if (entry && typeof entry.revision === 'string') return entry.revision;
  if (/^[0-9a-f]{12}$/.test(ref)) return ref;
  throw Errors.notFound();
}

function serviceDeps(ctx: RequestContext) {
  return {
    db: ctx.db.pool, cfg: ctx.cfg, clock: ctx.clock, storage: ctx.storage,
    mailer: ctx.mailer, live: ctx.live,
  };
}

/** POST /api/grading/clock — advances the one server clock. */
export async function clock(ctx: RequestContext): Promise<{ status: number; body: unknown }> {
  const body = expectObject(parseBody(ctx));
  const advance = typeof body.advance_seconds === 'number' ? body.advance_seconds : NaN;
  if (!Number.isInteger(advance) || advance < 0 || advance > 86400) {
    throw Errors.invalid({ advance_seconds: 'advance_seconds must be a whole number from 0 to 86400' });
  }
  const row = await ctx.tx.query('SELECT offset_seconds FROM clock_state WHERE id = 1');
  const current = Number(row.rows[0].offset_seconds);
  const total = current + advance;
  await ctx.tx.query('UPDATE clock_state SET offset_seconds = $1 WHERE id = 1', [total]);
  ctx.clock.advance(advance);
  return {
    status: 200,
    body: { now: ctx.clock.nowIso(), offset_seconds: total },
  };
}

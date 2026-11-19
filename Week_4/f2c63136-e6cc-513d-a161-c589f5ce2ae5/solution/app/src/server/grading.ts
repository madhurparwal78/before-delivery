import { config } from './config.ts';
import { advanceClock, shownNow, now } from './clock.ts';
import { db, type Row } from './db.ts';
import { HttpError, invalid, notFound } from './errors.ts';
import { asObject, readBody, reply, type Ctx, type Json, type Reply, type Router } from './http.ts';
import { createSession, newToken, roleOf, userByName, type RepoAccess } from './domain/access.ts';
import { loadChange } from './domain/changes.ts';
import { opPush, opReport } from './routes/code.ts';
import { insertOrg, insertRepo, insertUser, userErrors } from './routes/account.ts';
import { opCreateChange, opDismiss, opQueue, opReady, opRequestReview, opReview, opThread, opViewed } from './routes/review.ts';
import { processDue } from './domain/reports.ts';
import { entryState } from './domain/queue.ts';
import { flushLive } from './live.ts';
import { ROLE_RANK, type Role } from '../shared/types.ts';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const exists = (what: string) => new HttpError(409, { error: `Already exists: ${what}` });

function guarded(handler: (c: Ctx) => Promise<Reply>): (c: Ctx) => Promise<Reply> {
  return async (c) => {
    if (c.req.headers['x-grading-key'] !== config.gradingKey) throw notFound();
    return handler(c);
  };
}

interface Actor {
  access: RepoAccess;
}

async function actorFor(repo: Row, org: Row, username: string): Promise<Actor> {
  const user = await userByName(db, username);
  if (!user) throw notFound();
  const role = (await roleOf(db, repo, user.id)) ?? 'owner';
  return { access: { repo, org, role, tokenAccess: null, tokenName: null, user } };
}

/** One grading step: the same operation the API performs, without its role checks. */
async function runStep(repo: Row, org: Row, step: Json, keys: Record<string, Json>): Promise<Json> {
  const { access } = await actorFor(repo, org, text(step.as));
  const changeOf = async (key: unknown): Promise<Row> => loadChange(db, repo, (keys[text(key)] as { number: number }).number);
  const revisionOf = (value: unknown): string => {
    const known = keys[text(value)] as { revision?: string } | undefined;
    return known?.revision ?? text(value);
  };
  if (step.push) {
    const push = asObject(step.push);
    const branch = text(push.branch);
    const current = (await db.q<Row>('SELECT revision FROM branches WHERE repo_id = $1 AND name = $2', [repo.id, branch]))[0]?.revision ?? null;
    const files = Object.entries(asObject(push.files)).map(([path, content]) => (content === null ? { path, delete: true } : { path, content }));
    const done = await opPush(access, { branch, expected_head: current, from: push.from, message: push.message, files });
    return { revision: done.revision };
  }
  if (step.change) {
    const created = await opCreateChange(access, asObject(step.change));
    return { number: created.number, id: `${org.slug}/${repo.name}#${created.number}` };
  }
  if (step.ready) {
    await opReady(access, await changeOf(asObject(step.ready).change));
    return {};
  }
  if (step.review) {
    const review = asObject(step.review);
    return { id: (await opReview(access, await changeOf(review.change), review)).id };
  }
  if (step.dismiss) {
    const dismiss = asObject(step.dismiss);
    const row = (await db.q<Row>('SELECT * FROM reviews WHERE id = $1', [(keys[text(dismiss.review)] as { id: number }).id]))[0];
    const change = (await db.q<Row>('SELECT * FROM changes WHERE id = $1', [row.change_id]))[0];
    await opDismiss(access, change, row, dismiss);
    return { id: row.id };
  }
  if (step.thread) {
    const thread = asObject(step.thread);
    const change = await changeOf(thread.change);
    const id = await opThread(access, change, { ...thread, suggestion: thread.suggestion ? { lines: thread.suggestion } : undefined });
    const comment = (await db.q<Row>('SELECT id FROM comments WHERE thread_id = $1 ORDER BY id LIMIT 1', [id]))[0];
    return { id, comment: comment.id };
  }
  if (step.request_review) {
    const request = asObject(step.request_review);
    const target = await userByName(db, text(request.username));
    if (!target) throw notFound();
    await opRequestReview(access, await changeOf(request.change), target);
    return {};
  }
  if (step.check) {
    const check = asObject(step.check);
    const revision = revisionOf(check.revision);
    await opReport(access, { ...check, revision });
    return { revision, name: check.name, state: check.state };
  }
  if (step.queue) {
    const entry = await opQueue(access, await changeOf(asObject(step.queue).change));
    const fresh = (await db.q<Row>('SELECT * FROM queue_entries WHERE id = $1', [entry.id]))[0];
    const state = fresh.status === 'active' ? (await entryState(db, repo, fresh)).state : fresh.status;
    return { id: fresh.id, revision: fresh.revision, state };
  }
  if (step.token) {
    const token = asObject(step.token);
    const made = newToken();
    const row = (await db.q<Row>('INSERT INTO tokens (repo_id, name, access, token_hash) VALUES ($1, $2, $3, $4) RETURNING id', [repo.id, text(token.name), text(token.access), made.hash]))[0];
    return { id: row.id, token: made.value };
  }
  if (step.viewed) {
    const viewed = asObject(step.viewed);
    await opViewed(access, await changeOf(viewed.change), text(viewed.path), true);
    return {};
  }
  throw invalid({ steps: 'Unknown step' });
}

/** Creates users, organisations and repositories (with their steps) in one call. */
export async function setupWorld(body: Json): Promise<Json> {
  const users: Record<string, { cookie: string }> = {};
  const ids = new Map<string, number>();
  for (const raw of (body.users as Json[] | undefined) ?? []) {
    const input = { email: text(raw.email), username: text(raw.username), name: text(raw.name), password: text(raw.password) };
    const errors = await userErrors(input);
    if (Object.keys(errors).length) throw exists(`user ${input.username}`);
    const id = await insertUser(input, true, null);
    ids.set(input.username, id);
    users[input.username] = { cookie: await createSession(db, id) };
  }
  const orgIds = new Map<string, Row>();
  for (const raw of (body.orgs as Json[] | undefined) ?? []) {
    const slug = text(raw.slug);
    if ((await db.q('SELECT 1 FROM orgs WHERE slug = $1', [slug])).length) throw exists(`organisation ${slug}`);
    const owner = await userByName(db, text(raw.owner));
    if (!owner) throw notFound();
    const orgId = await insertOrg(slug, text(raw.name), owner.id);
    orgIds.set(slug, { id: orgId, slug, name: text(raw.name), owner });
    for (const member of (raw.members as string[] | undefined) ?? []) {
      const user = await userByName(db, member);
      if (user) await db.q('INSERT INTO org_members (org_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [orgId, user.id]);
    }
    for (const team of (raw.teams as Json[] | undefined) ?? []) {
      const row = (await db.q<Row>('INSERT INTO teams (org_id, name) VALUES ($1, $2) RETURNING id', [orgId, text(team.name)]))[0];
      for (const member of (team.members as string[] | undefined) ?? []) {
        const user = await userByName(db, member);
        if (user) await db.q('INSERT INTO team_members (team_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [row.id, user.id]);
      }
    }
  }
  const repos: Record<string, { id: number; keys: Record<string, Json> }> = {};
  for (const raw of (body.repos as Json[] | undefined) ?? []) {
    const org = orgIds.get(text(raw.org)) ?? (await db.q<Row>('SELECT * FROM orgs WHERE slug = $1', [text(raw.org)]))[0];
    if (!org) throw notFound();
    const name = text(raw.name);
    if ((await db.q('SELECT 1 FROM repos WHERE org_id = $1 AND name = $2', [org.id, name])).length) throw exists(`repository ${org.slug}/${name}`);
    const creator = org.owner ?? (await db.q<Row>('SELECT u.* FROM users u JOIN org_members m ON m.user_id = u.id WHERE m.org_id = $1 AND m.owner LIMIT 1', [org.id]))[0];
    const created = await insertRepo(org.id, org.slug, name, text(raw.visibility) || 'private', creator);
    for (const grant of (raw.roles as Json[] | undefined) ?? []) {
      const subject = text(grant.subject);
      const role = text(grant.role) as Role;
      if (!(role in ROLE_RANK)) continue;
      const [kind, who] = [subject.slice(0, subject.indexOf(':')), subject.slice(subject.indexOf(':') + 1)];
      const target = kind === 'user' ? await userByName(db, who) : (await db.q<Row>('SELECT id FROM teams WHERE org_id = $1 AND name = $2', [org.id, who]))[0];
      if (target) await db.q(`INSERT INTO roles (repo_id, subject_kind, subject_id, role) VALUES ($1, $2, $3, $4) ON CONFLICT (repo_id, subject_kind, subject_id) DO UPDATE SET role = EXCLUDED.role`, [created.id, kind, target.id, role]);
    }
    const settings = asObject(raw.settings);
    await db.q('UPDATE repos SET required_approvals = $1, required_checks = $2, queue = $3, visibility = $4 WHERE id = $5', [
      typeof settings.required_approvals === 'number' ? settings.required_approvals : 1,
      JSON.stringify(Array.isArray(settings.required_checks) ? settings.required_checks : []),
      settings.queue === true,
      text(settings.visibility) || text(raw.visibility) || 'private',
      created.id,
    ]);
    const repo = (await db.q<Row>('SELECT r.*, o.slug AS org_slug FROM repos r JOIN orgs o ON o.id = r.org_id WHERE r.id = $1', [created.id]))[0];
    const keys: Record<string, Json> = {};
    for (const step of (raw.steps as Json[] | undefined) ?? []) keys[text(step.key)] = await runStep(repo, org, step, keys);
    repos[`${org.slug}/${name}`] = { id: created.id, keys };
  }
  return { users, repos };
}

export function register(router: Router): void {
  router.add('POST', '/api/grading/setup', guarded(async (c) => {
    const body = asObject(await readBody(c.req, 10_000_000).then((b) => (b.kind === 'ok' ? b.value : {})));
    return reply(201, await setupWorld(body));
  }));

  router.add('POST', '/api/grading/clock', guarded(async (c) => {
    const body = asObject(await readBody(c.req, config.jsonLimitBytes).then((b) => (b.kind === 'ok' ? b.value : {})));
    const seconds = body.advance_seconds;
    if (!Number.isInteger(seconds) || (seconds as number) < 0 || (seconds as number) > 86400) throw invalid({ advance_seconds: 'Must be a whole number from 0 to 86400' });
    const offset = await advanceClock(seconds as number);
    await processDue(now());
    flushLive();
    return reply(200, { now: shownNow(), offset_seconds: offset });
  }));
}


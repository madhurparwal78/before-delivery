import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.ts';
import { db, transaction, type Row } from '../db.ts';
import { forbidden, HttpError, invalid, notFound } from '../errors.ts';
import { readBody, reply, usable, type Json, type Router } from '../http.ts';
import { queueMail } from '../mail.ts';
import {
  atLeast, authenticate, createSession, hashPassword, newToken, organisationOf, passwordMatches, repoAccess, requireMaintainer, roleOf,
  SESSION_COOKIE, userByName,
} from '../domain/access.ts';
import { Events } from '../domain/events.ts';
import { Contents, createRevision } from '../domain/revisions.ts';
import { unmergedChanges } from '../domain/stack.ts';
import { validSlug, validUsername } from '../domain/validate.ts';
import { RESERVED_SLUGS } from '../../shared/routes.ts';
import { ROLE_RANK, type Role } from '../../shared/types.ts';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

interface NewUser {
  email: string;
  username: string;
  name: string;
  password: string;
}

/** Field errors for a sign-up, shared with the grading setup that creates confirmed users. */
export async function userErrors(input: NewUser): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  if (!validUsername(input.username)) errors.username = 'Username is invalid';
  else if (input.username === 'merge-queue' || (await userByName(db, input.username))) errors.username = 'Username is taken';
  if (!EMAIL.test(input.email)) errors.email = 'Email is invalid';
  else if ((await db.q('SELECT 1 FROM users WHERE email = $1', [input.email.toLowerCase()])).length) errors.email = 'Email is already registered';
  if (input.password.length < 8) errors.password = 'Password must be at least 8 characters';
  if (input.name.trim() === '') errors.name = 'Name is required';
  return errors;
}

export async function insertUser(input: NewUser, confirmed: boolean, token: string | null): Promise<number> {
  const rows = await db.q<Row>(
    'INSERT INTO users (email, username, name, password_hash, confirmed, confirm_token) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [input.email.toLowerCase(), input.username, input.name.trim(), hashPassword(input.password), confirmed, token],
  );
  return rows[0].id;
}

export async function insertOrg(slug: string, name: string, ownerId: number): Promise<number> {
  const org = (await db.q<Row>('INSERT INTO orgs (slug, name) VALUES ($1, $2) RETURNING id', [slug, name]))[0];
  await db.q('INSERT INTO org_members (org_id, user_id, owner) VALUES ($1, $2, true)', [org.id, ownerId]);
  return org.id;
}

export async function insertRepo(orgId: number, orgSlug: string, name: string, visibility: string, creator: { id: number; username: string; name: string }): Promise<Row> {
  return transaction(async (tx) => {
    const repo = (await tx.q<Row>(`INSERT INTO repos (org_id, name, visibility) VALUES ($1, $2, $3) RETURNING *`, [orgId, name, visibility]))[0];
    await tx.q(`INSERT INTO roles (repo_id, subject_kind, subject_id, role) VALUES ($1, 'user', $2, 'owner')`, [repo.id, creator.id]);
    const root = await createRevision(tx, repo.id, { parents: [], message: 'Initial revision', snap: new Map(), author: creator }, new Contents());
    await tx.q(`INSERT INTO branches (repo_id, name, revision) VALUES ($1, 'main', $2)`, [repo.id, root]);
    return { ...repo, org_slug: orgSlug };
  });
}

function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`;
}

export function register(router: Router): void {
  router.add('POST', '/api/signup', async (c) => {
    const body = usable(await readBody(c.req, config.jsonLimitBytes), config.jsonLimitBytes);
    const input: NewUser = { email: text(body.email).trim(), username: text(body.username), name: text(body.name), password: text(body.password) };
    const errors = await userErrors(input);
    if (Object.keys(errors).length) throw invalid(errors);
    const token = randomBytes(24).toString('hex');
    const create = () => transaction(async (tx) => {
      await tx.q('INSERT INTO users (email, username, name, password_hash, confirmed, confirm_token) VALUES ($1, $2, $3, $4, false, $5)', [
        input.email.toLowerCase(), input.username, input.name.trim(), hashPassword(input.password), token,
      ]);
      await queueMail(tx, {
        to: input.email,
        subject: 'Confirm your Ridgestack account',
        body: `Welcome to Ridgestack. Confirm your email to log in:\n\n${config.publicUrl}/confirm/${token}\n`,
      });
    });
    try {
      await create();
    } catch (error) {
      // A racing signup took the username or email between the check above and the insert.
      if ((error as { code?: string }).code !== '23505') throw error;
      throw invalid(await userErrors(input));
    }
    return reply(201, { status: 'confirmation_sent' });
  });

  router.add('POST', '/api/confirm', async (c) => {
    const body = usable(await readBody(c.req, config.jsonLimitBytes), config.jsonLimitBytes);
    const rows = await db.q<Row>('UPDATE users SET confirmed = true, confirm_token = NULL WHERE confirm_token = $1 RETURNING username', [text(body.token)]);
    if (!rows.length) throw notFound();
    return reply(200, { username: rows[0].username });
  });

  router.add('POST', '/api/login', async (c) => {
    const body = usable(await readBody(c.req, config.jsonLimitBytes), config.jsonLimitBytes);
    const rows = await db.q<Row>('SELECT * FROM users WHERE email = $1', [text(body.email).trim().toLowerCase()]);
    const user = rows[0];
    if (!user || !passwordMatches(text(body.password), user.password_hash)) throw new HttpError(401, { error: 'Email or password is wrong' });
    if (!user.confirmed) throw forbidden('Confirm your email first');
    const token = await createSession(db, user.id);
    return reply(200, { username: user.username, name: user.name }, { 'set-cookie': sessionCookie(token) });
  });

  router.add('POST', '/api/logout', async (c) => {
    const cookie = (c.req.headers.cookie ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
    if (cookie) {
      await db.q('DELETE FROM sessions WHERE token_hash = $1', [createHash('sha256').update(cookie.slice(SESSION_COOKIE.length + 1)).digest('hex')]);
    }
    return reply(204, undefined, { 'set-cookie': `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0` });
  });

  router.add('GET', '/api/me', async (c) => {
    const { user } = await authenticate(c.req, false);
    return reply(200, { username: user!.username, name: user!.name, email: user!.email });
  });

  router.add('POST', '/api/orgs', async (c) => {
    const { user } = await authenticate(c.req, false);
    const body = usable(await readBody(c.req, config.jsonLimitBytes), config.jsonLimitBytes);
    const slug = text(body.slug);
    const errors: Record<string, string> = {};
    if (!validSlug(slug)) errors.slug = 'Address is invalid';
    else if (RESERVED_SLUGS.includes(slug) || (await db.q('SELECT 1 FROM orgs WHERE slug = $1', [slug])).length) errors.slug = 'Address is taken';
    if (text(body.name).trim() === '') errors.name = 'Name is required';
    if (Object.keys(errors).length) throw invalid(errors);
    await insertOrg(slug, text(body.name).trim(), user!.id);
    return reply(201, { slug, name: text(body.name).trim() });
  });

  router.add('GET', '/api/orgs', async (c) => {
    const { user } = await authenticate(c.req, false);
    const rows = await db.q<Row>(
      'SELECT o.slug, o.name, m.owner FROM orgs o JOIN org_members m ON m.org_id = o.id WHERE m.user_id = $1 ORDER BY o.slug',
      [user!.id],
    );
    return reply(200, rows);
  });

  router.add('GET', '/api/orgs/:org', async (c) => {
    const { user } = await authenticate(c.req, false);
    const { org, owner } = await organisationOf(db, c.params.org, user!.id);
    const teams = await db.q<Row>('SELECT id, name FROM teams WHERE org_id = $1 ORDER BY name', [org.id]);
    const members = await db.q<Row>(
      `SELECT tm.team_id, u.username, u.name FROM team_members tm JOIN users u ON u.id = tm.user_id
        WHERE tm.team_id = ANY($1) ORDER BY u.username`,
      [teams.map((team) => team.id)],
    );
    return reply(200, {
      slug: org.slug,
      name: org.name,
      owner,
      teams: teams.map((team) => ({ name: team.name, members: members.filter((m) => m.team_id === team.id).map((m) => ({ username: m.username, name: m.name })) })),
    });
  });

  router.add('POST', '/api/orgs/:org/teams', async (c) => {
    const { user } = await authenticate(c.req, false);
    const { org, owner } = await organisationOf(db, c.params.org, user!.id);
    if (!owner) throw forbidden('Only organisation owners can do that');
    const body = usable(await readBody(c.req, config.jsonLimitBytes), config.jsonLimitBytes);
    const name = text(body.name);
    if (!validSlug(name)) throw invalid({ name: 'Name is invalid' });
    // ON CONFLICT: a racing request may create the same team between any check and the insert.
    const created = await db.q('INSERT INTO teams (org_id, name) VALUES ($1, $2) ON CONFLICT (org_id, name) DO NOTHING RETURNING id', [org.id, name]);
    if (!created.length) throw invalid({ name: 'Name is taken' });
    return reply(201, { name });
  });

  router.add('PUT', '/api/orgs/:org/teams/:team/members/:username', async (c) => {
    const { user } = await authenticate(c.req, false);
    const { org, owner } = await organisationOf(db, c.params.org, user!.id);
    const team = (await db.q<Row>('SELECT id FROM teams WHERE org_id = $1 AND name = $2', [org.id, c.params.team]))[0];
    const member = await userByName(db, c.params.username);
    if (!team || !member) throw notFound();
    if (!owner) throw forbidden('Only organisation owners can do that');
    await db.q('INSERT INTO team_members (team_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [team.id, member.id]);
    await db.q('INSERT INTO org_members (org_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [org.id, member.id]);
    return reply(204);
  });

  router.add('POST', '/api/orgs/:org/repos', async (c) => {
    const { user } = await authenticate(c.req, false);
    const { org, owner } = await organisationOf(db, c.params.org, user!.id);
    if (!owner) throw forbidden('Only organisation owners can do that');
    const body = usable(await readBody(c.req, config.jsonLimitBytes), config.jsonLimitBytes);
    const name = text(body.name);
    const errors: Record<string, string> = {};
    if (!validSlug(name)) errors.name = 'Name is invalid';
    else if ((await db.q('SELECT 1 FROM repos WHERE org_id = $1 AND name = $2', [org.id, name])).length) errors.name = 'Name is taken';
    if (body.visibility !== 'private' && body.visibility !== 'public') errors.visibility = 'Visibility must be private or public';
    if (Object.keys(errors).length) throw invalid(errors);
    let repo: Row;
    try {
      repo = await insertRepo(org.id, org.slug, name, body.visibility as string, user!);
    } catch (error) {
      // A racing request created the same repository between the check above and the insert.
      if ((error as { constraint?: string }).constraint !== 'repos_org_id_name_key') throw error;
      throw invalid({ name: 'Name is taken' });
    }
    return reply(201, { id: repo.id, org: org.slug, name, visibility: repo.visibility, default_branch: 'main' });
  });

  router.add('GET', '/api/repos', async (c) => {
    const { user } = await authenticate(c.req, false);
    const rows = await db.q<Row>(
      `SELECT r.id, o.slug AS org, r.name, r.visibility, r.org_id FROM repos r JOIN orgs o ON o.id = r.org_id ORDER BY o.slug, r.name`,
    );
    const out = [];
    for (const row of rows) {
      const role = await roleOf(db, row, user!.id);
      if (role) out.push({ id: row.id, org: row.org, name: row.name, visibility: row.visibility, your_role: role });
    }
    return reply(200, out);
  });

  router.add('GET', '/api/repos/:org/:repo', async (c) => {
    const access = await repoAccess(db, await authenticate(c.req, true), c.params.org, c.params.repo);
    return reply(200, repoObject(access.repo, access.role!));
  });

  router.add('PUT', '/api/repos/:org/:repo/settings', async (c) => {
    const caller = await authenticate(c.req, false);
    const body = await readBody(c.req, config.jsonLimitBytes);
    const access = await repoAccess(db, caller, c.params.org, c.params.repo);
    requireMaintainer(access);
    const input = usable(body, config.jsonLimitBytes);
    const errors: Record<string, string> = {};
    const next = { ...settingsOf(access.repo) };
    let visibility = access.repo.visibility as string;
    if ('required_approvals' in input) {
      const value = input.required_approvals;
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10) next.required_approvals = value;
      else errors.required_approvals = 'Must be a whole number from 0 to 10';
    }
    if ('required_checks' in input) {
      const value = input.required_checks;
      const good = Array.isArray(value) && value.length <= 20 && new Set(value).size === value.length && value.every((name) => typeof name === 'string' && name.length >= 1 && name.length <= 64);
      if (good) next.required_checks = value as string[];
      else errors.required_checks = 'Must be at most 20 unique names of 1 to 64 characters';
    }
    if ('queue' in input) {
      if (typeof input.queue === 'boolean') next.queue = input.queue;
      else errors.queue = 'Must be true or false';
    }
    if ('visibility' in input) {
      if (input.visibility === 'private' || input.visibility === 'public') visibility = input.visibility;
      else errors.visibility = 'Visibility must be private or public';
    }
    if (Object.keys(errors).length) throw invalid(errors);
    await transaction(async (tx) => {
      await tx.lockRepo(access.repo.id);
      await tx.q('UPDATE repos SET required_approvals = $1, required_checks = $2, queue = $3, visibility = $4 WHERE id = $5', [
        next.required_approvals, JSON.stringify(next.required_checks), next.queue, visibility, access.repo.id,
      ]);
      await tx.q('UPDATE changes SET checks_settled = false WHERE repo_id = $1', [access.repo.id]);
      await tx.q('UPDATE queue_entries SET checks_settled = false WHERE repo_id = $1', [access.repo.id]);
      const events = new Events();
      events.touch((await unmergedChanges(tx, access.repo.id)).map((change) => change.number));
      events.queue = true;
      events.emit(tx, access.repo.id);
    });
    return reply(200, next);
  });

  router.add('PUT', '/api/repos/:org/:repo/roles', async (c) => {
    const caller = await authenticate(c.req, false);
    const body = await readBody(c.req, config.jsonLimitBytes);
    const access = await repoAccess(db, caller, c.params.org, c.params.repo);
    const subject = await resolveSubject(access.org.id, text(asBody(body).subject));
    requireMaintainer(access);
    const input = usable(body, config.jsonLimitBytes);
    if (!(text(input.role) in ROLE_RANK)) throw invalid({ role: 'Role must be one of reader, writer, maintainer, owner' });
    if (input.role === 'owner' && !atLeast(access.role, 'owner')) throw forbidden('Only owners can grant owner');
    await db.q(
      `INSERT INTO roles (repo_id, subject_kind, subject_id, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT (repo_id, subject_kind, subject_id) DO UPDATE SET role = EXCLUDED.role`,
      [access.repo.id, subject.kind, subject.id, input.role],
    );
    return reply(204);
  });

  router.add('DELETE', '/api/repos/:org/:repo/roles/:subject', async (c) => {
    const access = await repoAccess(db, await authenticate(c.req, false), c.params.org, c.params.repo);
    const subject = await resolveSubject(access.org.id, c.params.subject);
    requireMaintainer(access);
    await db.q('DELETE FROM roles WHERE repo_id = $1 AND subject_kind = $2 AND subject_id = $3', [access.repo.id, subject.kind, subject.id]);
    return reply(204);
  });

  router.add('GET', '/api/repos/:org/:repo/roles', async (c) => {
    const access = await repoAccess(db, await authenticate(c.req, false), c.params.org, c.params.repo);
    const rows = await db.q<Row>(
      `SELECT 'user:' || u.username AS subject, u.name AS label, ro.role FROM roles ro JOIN users u ON u.id = ro.subject_id
        WHERE ro.repo_id = $1 AND ro.subject_kind = 'user'
       UNION ALL
       SELECT 'team:' || t.name, '@' || o.slug || '/' || t.name, ro.role FROM roles ro JOIN teams t ON t.id = ro.subject_id JOIN orgs o ON o.id = t.org_id
        WHERE ro.repo_id = $1 AND ro.subject_kind = 'team' ORDER BY 1`,
      [access.repo.id],
    );
    return reply(200, rows);
  });

  router.add('POST', '/api/repos/:org/:repo/tokens', async (c) => {
    const caller = await authenticate(c.req, false);
    const body = await readBody(c.req, config.jsonLimitBytes);
    const access = await repoAccess(db, caller, c.params.org, c.params.repo);
    requireMaintainer(access);
    const input = usable(body, config.jsonLimitBytes);
    const errors: Record<string, string> = {};
    const name = text(input.name).trim();
    if (!name) errors.name = 'Name is required';
    if (input.access !== 'read' && input.access !== 'write') errors.access = 'Access must be read or write';
    if (Object.keys(errors).length) throw invalid(errors);
    const token = newToken();
    const row = (await db.q<Row>('INSERT INTO tokens (repo_id, name, access, token_hash) VALUES ($1, $2, $3, $4) RETURNING id', [access.repo.id, name, input.access, token.hash]))[0];
    return reply(201, { id: row.id, name, access: input.access, token: token.value });
  });

  router.add('GET', '/api/repos/:org/:repo/tokens', async (c) => {
    const access = await repoAccess(db, await authenticate(c.req, false), c.params.org, c.params.repo);
    requireMaintainer(access);
    return reply(200, await db.q('SELECT id, name, access FROM tokens WHERE repo_id = $1 AND NOT revoked ORDER BY id', [access.repo.id]));
  });

  router.add('DELETE', '/api/repos/:org/:repo/tokens/:id', async (c) => {
    const access = await repoAccess(db, await authenticate(c.req, false), c.params.org, c.params.repo);
    const found = /^[1-9][0-9]*$/.test(c.params.id) ? await db.q('SELECT 1 FROM tokens WHERE id = $1 AND repo_id = $2', [Number(c.params.id), access.repo.id]) : [];
    if (!found.length) throw notFound();
    requireMaintainer(access);
    await db.q('UPDATE tokens SET revoked = true WHERE id = $1', [Number(c.params.id)]);
    return reply(204);
  });

  router.add('GET', '/api/inbox', async (c) => {
    const { user } = await authenticate(c.req, false);
    const rows = await db.q<Row>(
      `SELECT c.number, c.title, c.state, c.author_id, u.username AS author, o.slug AS org, r.name AS repo, r.id AS repo_id, r.visibility, r.org_id,
              EXISTS (SELECT 1 FROM review_requests q WHERE q.change_id = c.id AND q.user_id = $1 AND q.pending) AS requested
         FROM changes c JOIN repos r ON r.id = c.repo_id JOIN orgs o ON o.id = r.org_id JOIN users u ON u.id = c.author_id
        WHERE c.state <> 'merged' ORDER BY c.id DESC`,
      [user!.id],
    );
    const item = (row: Row) => ({ number: row.number, title: row.title, state: row.state, author: row.author, org: row.org, repo: row.repo });
    const review: ReturnType<typeof item>[] = [];
    const mine: ReturnType<typeof item>[] = [];
    for (const row of rows) {
      if (row.author_id === user!.id) mine.push(item(row));
      if (row.requested && row.state !== 'draft' && (await roleOf(db, { ...row, id: row.repo_id }, user!.id))) review.push(item(row));
    }
    return reply(200, { review, mine });
  });
}

const asBody = (body: Awaited<ReturnType<typeof readBody>>): Json => (body.kind === 'ok' && body.value && typeof body.value === 'object' ? (body.value as Json) : {});

const settingsOf = (repo: Row): { required_approvals: number; required_checks: string[]; queue: boolean } => ({
  required_approvals: repo.required_approvals,
  required_checks: repo.required_checks,
  queue: repo.queue,
});

export const repoObject = (repo: Row, role: Role) => ({
  id: repo.id,
  org: repo.org_slug,
  name: repo.name,
  visibility: repo.visibility,
  your_role: role,
  settings: settingsOf(repo),
});

async function resolveSubject(orgId: number, subject: string): Promise<{ kind: 'user' | 'team'; id: number }> {
  const [kind, name] = [subject.slice(0, subject.indexOf(':')), subject.slice(subject.indexOf(':') + 1)];
  if (kind === 'user') {
    const user = await userByName(db, name);
    if (user) return { kind: 'user', id: user.id };
  }
  if (kind === 'team') {
    const team = (await db.q<Row>('SELECT id FROM teams WHERE org_id = $1 AND name = $2', [orgId, name]))[0];
    if (team) return { kind: 'team', id: team.id };
  }
  throw notFound();
}


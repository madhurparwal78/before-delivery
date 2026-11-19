import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { db, type Db, type Row } from '../db.ts';
import { forbidden, notFound, unauthenticated } from '../errors.ts';
import { ROLE_RANK, type Role } from '../../shared/types.ts';

export interface User {
  id: number;
  username: string;
  name: string;
  email: string;
}

export interface RepoAccess {
  repo: Row;
  org: Row;
  role: Role | null;
  /** Set when the caller is a repository token rather than a session. */
  tokenAccess: 'read' | 'write' | null;
  tokenName: string | null;
  user: User | null;
}

const hashToken = (value: string): string => createHash('sha256').update(value).digest('hex');

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(password, salt, 32).toString('hex')}`;
}

export function passwordMatches(password: string, stored: string): boolean {
  const [salt, key] = stored.split(':');
  const candidate = scryptSync(password, Buffer.from(salt, 'hex'), 32);
  return timingSafeEqual(candidate, Buffer.from(key, 'hex'));
}

export async function createSession(client: Db, userId: number): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await client.q('INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)', [hashToken(token), userId]);
  return token;
}

function cookieOf(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

export const SESSION_COOKIE = 'ridgestack_session';

export async function sessionUser(req: IncomingMessage): Promise<User | null> {
  const token = cookieOf(req, SESSION_COOKIE);
  if (!token) return null;
  const rows = await db.q<User>(
    'SELECT u.id, u.username, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1',
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

interface Caller {
  user: User | null;
  token: { id: number; repoId: number; access: 'read' | 'write'; name: string } | null;
}

/** 401 for a missing or bad session or token; tokens only where `allowToken` says so. */
export async function authenticate(req: IncomingMessage, allowToken: boolean): Promise<Caller> {
  const header = req.headers.authorization;
  if (header !== undefined) {
    const match = /^Bearer (\S+)$/.exec(header);
    if (!allowToken || !match) throw unauthenticated();
    const rows = await db.q<Row>('SELECT id, repo_id, access, name FROM tokens WHERE token_hash = $1 AND NOT revoked', [hashToken(match[1])]);
    if (!rows.length) throw unauthenticated();
    return { user: null, token: { id: rows[0].id, repoId: rows[0].repo_id, access: rows[0].access, name: rows[0].name } };
  }
  const user = await sessionUser(req);
  if (!user) throw unauthenticated();
  return { user, token: null };
}

export const newToken = (): { value: string; hash: string } => {
  const value = `rgs_${randomBytes(20).toString('hex')}`;
  return { value, hash: hashToken(value) };
};

export async function roleOf(client: Db, repo: Row, userId: number): Promise<Role | null> {
  const rows = await client.q<{ role: Role }>(
    `SELECT role FROM roles WHERE repo_id = $1 AND subject_kind = 'user' AND subject_id = $2
     UNION ALL
     SELECT r.role FROM roles r JOIN team_members tm ON tm.team_id = r.subject_id
      WHERE r.repo_id = $1 AND r.subject_kind = 'team' AND tm.user_id = $2`,
    [repo.id, userId],
  );
  const best = rows.map((row) => row.role).sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])[0];
  return best ?? (repo.visibility === 'public' ? 'reader' : null);
}

/** 404 unless the caller can see the repository (a token only sees its own). */
export async function repoAccess(client: Db, caller: Caller, org: string, name: string): Promise<RepoAccess> {
  const rows = await client.q<Row>(
    `SELECT r.*, o.slug AS org_slug, o.name AS org_name FROM repos r JOIN orgs o ON o.id = r.org_id WHERE o.slug = $1 AND r.name = $2`,
    [org, name],
  );
  const repo = rows[0];
  if (!repo) throw notFound();
  const orgRow = { id: repo.org_id, slug: repo.org_slug, name: repo.org_name };
  if (caller.token) {
    if (caller.token.repoId !== repo.id) throw notFound();
    const role: Role = caller.token.access === 'write' ? 'writer' : 'reader';
    return { repo, org: orgRow, role, tokenAccess: caller.token.access, tokenName: caller.token.name, user: null };
  }
  const role = await roleOf(client, repo, caller.user!.id);
  if (!role) throw notFound();
  return { repo, org: orgRow, role, tokenAccess: null, tokenName: null, user: caller.user };
}

export const atLeast = (role: Role | null, minimum: Role): boolean => role !== null && ROLE_RANK[role] >= ROLE_RANK[minimum];

export function requireWrite(access: RepoAccess): void {
  if (!atLeast(access.role, 'writer')) throw forbidden('You need write access to do that');
}

export function requireMaintainer(access: RepoAccess): void {
  if (!atLeast(access.role, 'maintainer')) throw forbidden('Only maintainers and owners can do that');
}

export async function userByName(client: Db, username: string): Promise<(User & { confirmed: boolean }) | null> {
  const rows = await client.q<User & { confirmed: boolean }>('SELECT id, username, name, email, confirmed FROM users WHERE username = $1', [username]);
  return rows[0] ?? null;
}

export async function canSee(client: Db, repo: Row, userId: number): Promise<boolean> {
  return (await roleOf(client, repo, userId)) !== null;
}

/** 404 unless the caller is related to the organisation: a member, or granted on one of its repositories. */
export async function organisationOf(client: Db, slug: string, userId: number): Promise<{ org: Row; owner: boolean }> {
  const orgs = await client.q<Row>('SELECT * FROM orgs WHERE slug = $1', [slug]);
  const org = orgs[0];
  if (!org) throw notFound();
  const member = await client.q<Row>('SELECT owner FROM org_members WHERE org_id = $1 AND user_id = $2', [org.id, userId]);
  if (member.length) return { org, owner: member[0].owner };
  const related = await client.q(
    `SELECT 1 FROM roles ro JOIN repos r ON r.id = ro.repo_id
      WHERE r.org_id = $1 AND ((ro.subject_kind = 'user' AND ro.subject_id = $2)
         OR (ro.subject_kind = 'team' AND ro.subject_id IN (SELECT team_id FROM team_members WHERE user_id = $2))) LIMIT 1`,
    [org.id, userId],
  );
  if (!related.length) throw notFound();
  return { org, owner: false };
}

import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { query, queryOne } from './db/pool.js';
import { forbidden, invalidKey, notFound, unauthenticated } from './http/errors.js';
import type { Ctx } from './http/router.js';
import { loadOrg, loadProject, type MemberRow, type OrgRow, type ProjectRow } from './store.js';
import type { Role } from '../shared/types.js';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export const SESSION_COOKIE = 'lowfield_session';

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 32);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
};

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const [saltHex, keyHex] = stored.split(':');
  if (saltHex === undefined || keyHex === undefined) return false;
  const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(keyHex, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
};

export const createAuthSession = async (memberId: string): Promise<string> => {
  const token = randomBytes(32).toString('hex');
  await query('insert into auth_sessions (token, member_id) values ($1, $2)', [token, memberId]);
  return token;
};

export const destroyAuthSession = (token: string): Promise<unknown[]> =>
  query('delete from auth_sessions where token = $1', [token]);

export const sessionCookieHeader = (token: string): string =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;

export const clearedCookieHeader = (): string => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export interface Actor {
  readonly member: MemberRow;
  readonly org: OrgRow;
  /** Admins and billing viewers see every project in their organisation. */
  readonly seesAllProjects: boolean;
}

/** Role changes, assignment changes and removals take effect on the next request. */
export const requireActor = async (ctx: Ctx): Promise<Actor> => {
  const token = ctx.cookies[SESSION_COOKIE];
  if (token === undefined) throw unauthenticated();
  const member = await queryOne<MemberRow>(
    `select m.id, m.org_id, m.name, m.email, m.role, m.joined_at
       from auth_sessions a join members m on m.id = a.member_id
      where a.token = $1`,
    [token],
  );
  if (member === null) throw unauthenticated();
  const org = await loadOrg(member.org_id);
  if (org === null) throw unauthenticated();
  return { member, org, seesAllProjects: member.role === 'admin' || member.role === 'billing' };
};

export const visibleProjectIds = async (actor: Actor): Promise<string[]> => {
  if (actor.seesAllProjects) {
    const rows = await query<{ id: string }>('select id from projects where org_id = $1', [actor.org.id]);
    return rows.map((row) => row.id);
  }
  const rows = await query<{ project_id: string }>('select project_id from member_projects where member_id = $1', [
    actor.member.id,
  ]);
  return rows.map((row) => row.project_id);
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string => typeof value === 'string' && uuidPattern.test(value);

export const isProjectVisible = async (actor: Actor, projectId: string): Promise<boolean> => {
  if (!isUuid(projectId)) return false;
  const project = await loadProject(projectId);
  if (project === null || project.org_id !== actor.org.id) return false;
  if (actor.seesAllProjects) return true;
  const row = await queryOne<{ project_id: string }>(
    'select project_id from member_projects where member_id = $1 and project_id = $2',
    [actor.member.id, projectId],
  );
  return row !== null;
};

/** A project outside the caller's visibility, and anything inside it, answers 404. */
export const requireVisibleProject = async (actor: Actor, projectId: string): Promise<ProjectRow> => {
  if (!(await isProjectVisible(actor, projectId))) throw notFound();
  const project = await loadProject(projectId);
  if (project === null) throw notFound();
  return project;
};

export type Action =
  | 'profile'
  | 'read_projects'
  | 'manage_org'
  | 'read_keys'
  | 'manage_keys'
  | 'read_sessions'
  | 'read_corrections'
  | 'write_corrections'
  | 'decide_corrections'
  | 'read_usage';

const permissions: Record<Action, readonly Role[]> = {
  profile: ['admin', 'developer', 'reviewer', 'approver', 'billing'],
  read_projects: ['admin', 'developer', 'reviewer', 'approver', 'billing'],
  manage_org: ['admin'],
  read_keys: ['admin', 'developer'],
  manage_keys: ['admin', 'developer'],
  read_sessions: ['admin', 'developer', 'reviewer', 'approver'],
  read_corrections: ['admin', 'developer', 'reviewer', 'approver'],
  write_corrections: ['reviewer', 'approver'],
  decide_corrections: ['approver'],
  read_usage: ['admin', 'billing'],
};

export const allows = (role: Role, action: Action): boolean => permissions[action].includes(role);

/** A role not listed for an action gets 403 forbidden. */
export const requireAction = (actor: Actor, action: Action): void => {
  if (!allows(actor.member.role, action)) throw forbidden();
};

export const landingRoute = (role: Role): string => (role === 'billing' ? '/console/usage' : '/console/projects');

export interface KeyActor {
  readonly keyId: string;
  readonly project: ProjectRow;
  readonly org: OrgRow;
}

export const hashKeySecret = (secret: string): string => createHash('sha256').update(secret).digest('hex');

export const requireKeyActor = async (ctx: Ctx): Promise<KeyActor> => {
  const header = ctx.req.headers.authorization ?? '';
  const match = /^Token (.+)$/i.exec(header.trim());
  if (match === null) throw invalidKey();
  const row = await queryOne<{ id: string; project_id: string }>(
    'select id, project_id from api_keys where key_hash = $1 and revoked_at is null',
    [hashKeySecret(match[1] as string)],
  );
  if (row === null) throw invalidKey();
  const project = await loadProject(row.project_id);
  if (project === null) throw invalidKey();
  const org = await loadOrg(project.org_id);
  if (org === null) throw invalidKey();
  return { keyId: row.id, project, org };
};

export const newKeySecret = (): string => `lf_live_${randomBytes(16).toString('hex')}`;

export const keyPrefix = (secret: string): string => secret.slice(0, 12);

export { randomUUID };

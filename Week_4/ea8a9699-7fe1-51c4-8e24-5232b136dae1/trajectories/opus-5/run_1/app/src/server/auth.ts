import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { one, query } from './db.js';
import { errors } from './errors.js';
import type { RequestContext } from './http/context.js';
import type { AccountRole, PlanId } from '../shared/types.js';

const scrypt = promisify(scryptCallback);
const keyLength = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, keyLength)) as Buffer;
  return `scrypt:${salt.toString('base64')}:${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, digest] = stored.split(':');
  if (scheme !== 'scrypt') {
    return false;
  }
  const derived = (await scrypt(password, Buffer.from(salt, 'base64'), keyLength)) as Buffer;
  const expected = Buffer.from(digest, 'base64');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export const sessionCookieName = 'rushes_session';

export function sessionCookie(token: string): string {
  return `${sessionCookieName}=${token}; HttpOnly; SameSite=Lax; Path=/`;
}

export function clearedSessionCookie(): string {
  return `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function createSession(accountId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await query('insert into sessions (token, account_id) values ($1, $2)', [token, accountId]);
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await query('delete from sessions where token = $1', [token]);
}

export interface Viewer {
  id: string;
  email: string;
  display_name: string;
  handle: string;
  role: AccountRole;
  group_id: string | null;
  workspace_id: string | null;
}

export interface WorkspaceRow {
  id: string;
  group_id: string;
  slug: string;
  name: string;
  time_zone: string;
  plan: PlanId;
  seat_cap: number;
  seeded_plan: PlanId;
  sort_order: number;
}

export async function currentViewer(context: RequestContext): Promise<Viewer | null> {
  const token = context.cookies[sessionCookieName];
  if (!token) {
    return null;
  }
  return one<Viewer>(
    `select a.id, a.email, a.display_name, a.handle, a.role, a.group_id, a.workspace_id
       from sessions s join accounts a on a.id = s.account_id
      where s.token = $1`,
    [token],
  );
}

export async function requireViewer(context: RequestContext): Promise<Viewer> {
  const viewer = await currentViewer(context);
  if (viewer === null) {
    throw errors.unauthenticated();
  }
  return viewer;
}

export interface WorkspaceAccess {
  workspace: WorkspaceRow;
  viewer: Viewer;
  isOpsLead: boolean;
  isSeated: boolean;
}

export async function workspaceBySlug(slug: string): Promise<WorkspaceRow | null> {
  return one<WorkspaceRow>('select * from workspaces where slug = $1', [slug]);
}

export async function hasSeat(workspaceId: string, accountId: string): Promise<boolean> {
  const row = await one('select 1 as present from seats where workspace_id = $1 and account_id = $2', [
    workspaceId,
    accountId,
  ]);
  return row !== null;
}

export function isMemberOf(workspace: WorkspaceRow, viewer: Viewer): boolean {
  if (viewer.role === 'ops_lead') {
    return viewer.group_id === workspace.group_id;
  }
  if (viewer.role === 'designer') {
    return viewer.workspace_id === workspace.id;
  }
  return false;
}

/** Resolves membership of the workspace in the path. Anything out of reach is answered as unknown. */
export async function requireMembership(context: RequestContext, slug: string): Promise<WorkspaceAccess> {
  const viewer = await requireViewer(context);
  const workspace = await workspaceBySlug(slug);
  if (workspace === null || !isMemberOf(workspace, viewer)) {
    throw errors.notFound();
  }
  const isOpsLead = viewer.role === 'ops_lead';
  return {
    workspace,
    viewer,
    isOpsLead,
    isSeated: isOpsLead || (await hasSeat(workspace.id, viewer.id)),
  };
}

export async function requireSeat(access: WorkspaceAccess): Promise<WorkspaceAccess> {
  if (!access.isSeated) {
    throw errors.seatRequired();
  }
  return access;
}

export async function requireOpsLead(context: RequestContext, slug: string): Promise<WorkspaceAccess> {
  const access = await requireMembership(context, slug);
  if (!access.isOpsLead) {
    throw errors.forbidden();
  }
  return access;
}

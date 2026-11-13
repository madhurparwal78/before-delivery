import type { PoolClient } from 'pg';
import type { Ctx, RequestCtx } from './ctx.js';
import { AppError } from '../core/errors.js';
import { effectiveAccess, groupAccess, hasPermission, ROLE_LEVEL, type Permission, type ProjectAccess, type Role } from '../domain/access.js';

export async function requireSession(rc: RequestCtx): Promise<void> {
  if (!rc.user) throw new AppError(401, 'unauthenticated', 'Sign in to continue.');
}

export interface ProjectCtx {
  project: ProjectRow;
  access: ProjectAccess;
  client: PoolClient;
}

export interface ProjectRow {
  id: number;
  group_id: number;
  slug: string;
  path: string;
  visibility: string;
  default_branch: string;
  merge_method: string;
  merge_trains: boolean;
  pipelines_must_succeed: boolean;
  reset_approvals_on_push: boolean;
  author_can_approve: boolean;
  auto_resolve_outdated: boolean;
  created_at: number;
}

export async function projectById(c: PoolClient, id: number): Promise<ProjectRow | null> {
  const r = await c.query<ProjectRow>(`SELECT id, group_id, slug, path, visibility, default_branch, merge_method, merge_trains, pipelines_must_succeed, reset_approvals_on_push, author_can_approve, auto_resolve_outdated, created_at FROM projects WHERE id = $1`, [id]);
  return r.rows[0] ?? null;
}

export async function projectByPath(c: PoolClient, path: string): Promise<ProjectRow | null> {
  const r = await c.query<ProjectRow>(`SELECT id, group_id, slug, path, visibility, default_branch, merge_method, merge_trains, pipelines_must_succeed, reset_approvals_on_push, author_can_approve, auto_resolve_outdated, created_at FROM projects WHERE path = $1`, [path]);
  return r.rows[0] ?? null;
}

/** Load a project and check the viewer can read it. Unreadable projects answer 404. */
export async function loadProject(c: PoolClient, ctx: Ctx, projectId: number, userId: number | null): Promise<{ project: ProjectRow; access: ProjectAccess }> {
  const project = await projectById(c, projectId);
  if (!project) throw new AppError(404, 'not_found', 'Not found.');
  const access = await effectiveAccess(c, projectId, userId);
  if (!access.member && !access.implied) throw new AppError(404, 'not_found', 'Not found.');
  return { project, access };
}

export function requireReadCode(access: ProjectAccess): void {
  if (access.level < ROLE_LEVEL.reporter) throw new AppError(403, 'forbidden', "You don't have permission to do that.");
}

export function requireMinRole(access: ProjectAccess, role: Role): void {
  if (access.level < ROLE_LEVEL[role]) throw new AppError(403, 'forbidden', "You don't have permission to do that.");
}

export function requirePermissionOrRole(access: ProjectAccess, perm: Permission, role: Role): void {
  if (hasPermission(access, perm)) return;
  if (access.level >= ROLE_LEVEL[role]) return;
  throw new AppError(403, 'forbidden', "You don't have permission to do that.");
}

export async function groupById(c: PoolClient, id: number): Promise<{ id: number; name: string; path: string; parent_id: number | null; visibility: string } | null> {
  const r = await c.query<{ id: number; name: string; path: string; parent_id: number | null; visibility: string }>(`SELECT id, name, path, parent_id, visibility FROM groups WHERE id = $1`, [id]);
  return r.rows[0] ?? null;
}

export async function groupByPath(c: PoolClient, path: string): Promise<{ id: number; name: string; path: string; parent_id: number | null; visibility: string } | null> {
  const r = await c.query<{ id: number; name: string; path: string; parent_id: number | null; visibility: string }>(`SELECT id, name, path, parent_id, visibility FROM groups WHERE path = $1`, [path]);
  return r.rows[0] ?? null;
}

export async function canReadGroup(c: PoolClient, groupId: number, userId: number | null): Promise<boolean> {
  const g = await groupById(c, groupId);
  if (!g) return false;
  if (g.visibility === 'public' || g.visibility === 'internal') return userId !== null;
  const acc = await groupAccess(c, groupId, userId);
  return acc.role !== null;
}

export async function writeAudit(
  c: PoolClient,
  opts: { projectId?: number; groupId?: number; actor: string; action: string; target: string; before: unknown; after: unknown; at: number },
): Promise<void> {
  await c.query(
    `INSERT INTO audit_events (project_id, group_id, actor, action, target, before, after, at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [opts.projectId ?? null, opts.groupId ?? null, opts.actor, opts.action, opts.target, JSON.stringify(opts.before ?? null), JSON.stringify(opts.after ?? null), opts.at],
  );
}

export async function nextIid(c: PoolClient, projectId: number, kind: 'issue' | 'request'): Promise<number> {
  const r = await c.query<{ next_iid: number }>(
    `INSERT INTO mr_iids (project_id, kind, next_iid) VALUES ($1, $2, 2)
     ON CONFLICT (project_id, kind) DO UPDATE SET next_iid = mr_iids.next_iid + 1
     RETURNING next_iid - 1 AS next_iid`,
    [projectId, kind],
  );
  return r.rows[0].next_iid;
}

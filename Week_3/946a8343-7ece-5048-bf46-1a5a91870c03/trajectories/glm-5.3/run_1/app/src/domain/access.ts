import type { DbClient } from '../db/db.js';

export type Role = 'guest' | 'reporter' | 'developer' | 'maintainer' | 'owner';

export const ROLE_LEVEL: Record<Role, number> = { guest: 10, reporter: 20, developer: 30, maintainer: 40, owner: 50 };

export type Permission =
  | 'push_protected' | 'approve' | 'manage_environments' | 'dismiss_finding'
  | 'admin_board' | 'read_audit';

export interface CustomRoleRow {
  id: number;
  group_id: number;
  name: string;
  base: Role;
  permissions: string[];
}

export interface ProjectAccess {
  role: Role | null;
  level: number;
  permissions: Set<Permission>;
  member: boolean;
  implied: boolean;
  visibility: string;
}

export function roleLevel(role: Role | null): number {
  return role ? ROLE_LEVEL[role] : 0;
}

export async function effectiveAccess(
  c: DbClient,
  projectId: number,
  userId: number | null,
): Promise<ProjectAccess> {
  const proj = (await c.query<{ group_id: number; visibility: string }>(`SELECT group_id, visibility FROM projects WHERE id = $1`, [projectId])).rows[0];
  if (!proj) return { role: null, level: 0, permissions: new Set(), member: false, implied: false, visibility: 'private' };
  if (userId === null) return { role: null, level: 0, permissions: new Set(), member: false, implied: false, visibility: proj.visibility };

  const ancestors = await groupAncestors(c, proj.group_id);
  const rows = (await c.query<{ role: string | null; custom_role_id: number | null; group_id: number | null; project_id: number | null; path: string }>(`
    SELECT gm.role, gm.custom_role_id, g.id AS group_id, NULL::bigint AS project_id, g.path
    FROM group_members gm JOIN groups g ON g.id = gm.group_id
    WHERE gm.user_id = $1 AND g.id = ANY($2::bigint[])
    UNION ALL
    SELECT pm.role, pm.custom_role_id, NULL::bigint, p.id, p.path
    FROM project_members pm JOIN projects p ON p.id = pm.project_id
    WHERE pm.user_id = $1 AND pm.project_id = $3
  `, [userId, ancestors, projectId])).rows;

  let best: Role | null = null;
  const perms = new Set<Permission>();
  let member = false;
  for (const r of rows) {
    member = true;
    if (r.role) {
      const role = r.role as Role;
      if (roleLevel(role) > roleLevel(best)) best = role;
    } else if (r.custom_role_id) {
      const cr = (await c.query<{ base: string; permissions: string[] }>(`SELECT base, permissions FROM custom_roles WHERE id = $1`, [r.custom_role_id])).rows[0];
      if (cr) {
        const role = cr.base as Role;
        if (roleLevel(role) > roleLevel(best)) best = role;
        for (const p of cr.permissions) perms.add(p as Permission);
      }
    }
  }
  if (best !== null || member) {
    return { role: best ?? 'guest', level: roleLevel(best), permissions: perms, member: true, implied: false, visibility: proj.visibility };
  }
  if (proj.visibility === 'private') {
    return { role: null, level: 0, permissions: new Set(), member: false, implied: false, visibility: proj.visibility };
  }
  return { role: 'reporter', level: ROLE_LEVEL.reporter, permissions: new Set(), member: false, implied: true, visibility: proj.visibility };
}

export async function groupAncestors(c: DbClient, groupId: number): Promise<number[]> {
  const out: number[] = [];
  let cur: number | null = groupId;
  const seen = new Set<number>();
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    const r: { rows: Array<{ parent_id: number | null }> } = await c.query<{ parent_id: number | null }>(`SELECT parent_id FROM groups WHERE id = $1`, [cur]);
    cur = r.rows[0]?.parent_id ?? null;
  }
  return out;
}

export async function groupAccess(c: DbClient, groupId: number, userId: number | null): Promise<{ role: Role | null; level: number; permissions: Set<Permission> }> {
  if (userId === null) return { role: null, level: 0, permissions: new Set() };
  const ancestors = await groupAncestors(c, groupId);
  const rows = (await c.query<{ role: string | null; custom_role_id: number | null }>(
    `SELECT role, custom_role_id FROM group_members WHERE user_id = $1 AND group_id = ANY($2::bigint[])`,
    [userId, ancestors],
  )).rows;
  let best: Role | null = null;
  const perms = new Set<Permission>();
  for (const r of rows) {
    if (r.role) {
      const role = r.role as Role;
      if (roleLevel(role) > roleLevel(best)) best = role;
    } else if (r.custom_role_id) {
      const cr = (await c.query<{ base: string; permissions: string[] }>(`SELECT base, permissions FROM custom_roles WHERE id = $1`, [r.custom_role_id])).rows[0];
      if (cr) {
        const role = cr.base as Role;
        if (roleLevel(role) > roleLevel(best)) best = role;
        for (const p of cr.permissions) perms.add(p as Permission);
      }
    }
  }
  return { role: best, level: roleLevel(best), permissions: perms };
}

export function canRead(access: ProjectAccess): boolean {
  return access.member || access.implied;
}

export function hasPermission(access: ProjectAccess, perm: Permission): boolean {
  return access.permissions.has(perm) || access.level >= ROLE_LEVEL.maintainer;
}

export function minRoleFor(action: Action): Role {
  return ACTION_MIN[action];
}

export type Action =
  | 'read_planning' | 'comment_issue' | 'read_code' | 'comment_mr' | 'create_issue' | 'move_card' | 'edit_issue_meta'
  | 'commit_unprotected' | 'edit_mr' | 'apply_suggestions' | 'run_jobs' | 'edit_wiki' | 'approve_mr'
  | 'settings' | 'dismiss_finding' | 'board_lists' | 'env_manage' | 'group_admin' | 'read_audit';

const ACTION_MIN: Record<Action, Role> = {
  read_planning: 'guest',
  comment_issue: 'guest',
  read_code: 'reporter',
  comment_mr: 'reporter',
  create_issue: 'reporter',
  move_card: 'reporter',
  edit_issue_meta: 'reporter',
  commit_unprotected: 'developer',
  edit_mr: 'developer',
  apply_suggestions: 'developer',
  run_jobs: 'developer',
  edit_wiki: 'developer',
  approve_mr: 'developer',
  settings: 'maintainer',
  dismiss_finding: 'maintainer',
  board_lists: 'maintainer',
  env_manage: 'maintainer',
  group_admin: 'owner',
  read_audit: 'owner',
};

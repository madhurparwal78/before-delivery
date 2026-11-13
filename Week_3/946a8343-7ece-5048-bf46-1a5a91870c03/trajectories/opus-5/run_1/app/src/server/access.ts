import { nowMs } from './clock';
import { Sql } from './db';
import { errors } from './errors';
import { Tx } from './live';

export type Role = 'guest' | 'reporter' | 'developer' | 'maintainer' | 'owner';

export const roleLevels: Record<Role, number> = {
  guest: 10,
  reporter: 20,
  developer: 30,
  maintainer: 40,
  owner: 50,
};

export type Permission =
  | 'push_protected'
  | 'approve'
  | 'manage_environments'
  | 'dismiss_finding'
  | 'admin_board'
  | 'read_audit';

export type ProjectRow = {
  id: number;
  group_id: number;
  slug: string;
  path: string;
  visibility: string;
  default_branch: string;
  settings: ProjectSettings;
  next_mr_iid: number;
  next_issue_iid: number;
};

export type ProjectSettings = {
  merge_method: 'merge_commit' | 'squash' | 'fast_forward' | 'rebase';
  merge_trains: boolean;
  pipelines_must_succeed: boolean;
  reset_approvals_on_push: boolean;
  author_can_approve: boolean;
  auto_resolve_outdated: boolean;
};

export const defaultSettings: ProjectSettings = {
  merge_method: 'merge_commit',
  merge_trains: false,
  pipelines_must_succeed: false,
  reset_approvals_on_push: false,
  author_can_approve: false,
  auto_resolve_outdated: false,
};

export type GroupRow = {
  id: number;
  parent_id: number | null;
  name: string;
  path: string;
  visibility: string;
};

export type Access = {
  level: number;
  role: Role | null;
  permissions: Permission[];
  implied: boolean;
};

export function levelOf(role: string | null): number {
  if (role === null) return 0;
  return roleLevels[role as Role] ?? 0;
}

export function roleName(level: number): Role | null {
  const entries = Object.entries(roleLevels) as [Role, number][];
  const found = entries.filter(([, value]) => value <= level).sort((a, b) => b[1] - a[1])[0];
  return found === undefined ? null : found[0];
}

export async function loadProject(sql: Sql, id: number): Promise<ProjectRow | null> {
  const row = await sql.one<ProjectRow>(
    `select id, group_id, slug, path, visibility, default_branch, settings, next_mr_iid, next_issue_iid
     from projects where id = $1`,
    [id],
  );
  if (row === null) return null;
  return { ...row, id: Number(row.id), group_id: Number(row.group_id), settings: { ...defaultSettings, ...row.settings } };
}

export async function loadGroup(sql: Sql, id: number): Promise<GroupRow | null> {
  const row = await sql.one<GroupRow>(
    'select id, parent_id, name, path, visibility from groups where id = $1',
    [id],
  );
  if (row === null) return null;
  return { ...row, id: Number(row.id), parent_id: row.parent_id === null ? null : Number(row.parent_id) };
}

async function groupChain(sql: Sql, groupId: number): Promise<GroupRow[]> {
  const chain: GroupRow[] = [];
  let current: number | null = groupId;
  while (current !== null) {
    const group = await loadGroup(sql, current);
    if (group === null) break;
    chain.push(group);
    current = group.parent_id;
  }
  return chain;
}

type MembershipRow = {
  role: string | null;
  base: string | null;
  permissions: Permission[] | null;
};

async function membershipAccess(
  sql: Sql,
  subjects: { type: 'group' | 'project'; id: number }[],
  userId: number,
): Promise<Access> {
  let level = 0;
  let role: Role | null = null;
  const permissions = new Set<Permission>();
  for (const subject of subjects) {
    const rows = await sql.query<MembershipRow>(
      `select m.role, r.base, r.permissions
       from memberships m left join custom_roles r on r.id = m.custom_role_id
       where m.subject_type = $1 and m.subject_id = $2 and m.user_id = $3`,
      [subject.type, subject.id, userId],
    );
    for (const row of rows) {
      const name = row.role ?? row.base;
      const candidate = levelOf(name);
      if (candidate > level) {
        level = candidate;
        role = (name as Role) ?? null;
      }
      for (const permission of row.permissions ?? []) permissions.add(permission);
    }
  }
  return { level, role, permissions: [...permissions], implied: false };
}

export async function projectAccess(sql: Sql, project: ProjectRow, userId: number): Promise<Access> {
  const chain = await groupChain(sql, project.group_id);
  const subjects: { type: 'group' | 'project'; id: number }[] = [
    { type: 'project', id: project.id },
    ...chain.map((group) => ({ type: 'group' as const, id: group.id })),
  ];
  const access = await membershipAccess(sql, subjects, userId);
  if (access.level > 0) return access;
  if (project.visibility === 'private') return access;
  return { level: roleLevels.reporter, role: 'reporter', permissions: [], implied: true };
}

export async function groupAccess(sql: Sql, group: GroupRow, userId: number): Promise<Access> {
  const chain = await groupChain(sql, group.id);
  const access = await membershipAccess(
    sql,
    chain.map((item) => ({ type: 'group' as const, id: item.id })),
    userId,
  );
  if (access.level > 0) return access;
  if (group.visibility === 'private') return access;
  return { level: roleLevels.reporter, role: 'reporter', permissions: [], implied: true };
}

export async function readableProject(sql: Sql, id: number, userId: number): Promise<{ project: ProjectRow; access: Access }> {
  const project = await loadProject(sql, id);
  if (project === null) throw errors.notFound();
  const access = await projectAccess(sql, project, userId);
  if (access.level === 0) throw errors.notFound();
  return { project, access };
}

export async function readableGroup(sql: Sql, id: number, userId: number): Promise<{ group: GroupRow; access: Access }> {
  const group = await loadGroup(sql, id);
  if (group === null) throw errors.notFound();
  const access = await groupAccess(sql, group, userId);
  if (access.level === 0) throw errors.notFound();
  return { group, access };
}

export function requireLevel(access: Access, minimum: Role): void {
  if (access.level < roleLevels[minimum]) throw errors.forbidden();
}

export function requireLevelOrPermission(access: Access, minimum: Role, permission: Permission): void {
  if (access.level >= roleLevels[minimum]) return;
  if (access.permissions.includes(permission)) return;
  throw errors.forbidden();
}

export function hasPermission(access: Access, permission: Permission): boolean {
  return access.permissions.includes(permission);
}

export function requireMember(access: Access, minimum: Role): void {
  if (access.implied) throw errors.forbidden();
  requireLevel(access, minimum);
}

export async function writeAudit(
  t: Tx,
  scope: { projectId?: number; groupId?: number },
  actor: string,
  action: string,
  target: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await t.sql.query(
    `insert into audit_events (project_id, group_id, actor, action, target, before_value, after_value, at_ms)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      scope.projectId ?? null,
      scope.groupId ?? null,
      actor,
      action,
      target,
      before === null || before === undefined ? null : JSON.stringify(before),
      after === null || after === undefined ? null : JSON.stringify(after),
      nowMs(),
    ],
  );
}

export async function eligibleGroupMembers(sql: Sql, groupPath: string): Promise<string[]> {
  const group = await sql.one<{ id: number }>('select id from groups where path = $1', [groupPath]);
  if (group === null) return [];
  const rows = await sql.query<{ username: string; role: string | null; base: string | null }>(
    `select u.username, m.role, r.base
     from memberships m
     join users u on u.id = m.user_id
     left join custom_roles r on r.id = m.custom_role_id
     where m.subject_type = 'group' and m.subject_id = $1`,
    [Number(group.id)],
  );
  return rows
    .filter((row) => levelOf(row.role ?? row.base) >= roleLevels.developer)
    .map((row) => row.username);
}

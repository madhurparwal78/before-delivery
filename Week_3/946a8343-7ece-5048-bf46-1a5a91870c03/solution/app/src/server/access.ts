// Roles, custom permissions and visibility: the one place that decides what a person may do (DP-38).
import type { Queryable } from "./db.ts";
import { forbidden, notFound } from "./errors.ts";
import { VISIBILITIES, type ProjectSettings, type Visibility } from "../shared/settings.ts";
import { isOneOf } from "./json.ts";

export const ROLES = ["guest", "reporter", "developer", "maintainer", "owner"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LEVEL: Readonly<Record<Role, number>> = { guest: 10, reporter: 20, developer: 30, maintainer: 40, owner: 50 };

export const PERMISSIONS = ["push_protected", "approve", "manage_environments", "dismiss_finding", "admin_board", "read_audit"] as const;
export type Permission = (typeof PERMISSIONS)[number];

export type { Visibility };

export function isRole(value: unknown): value is Role {
  return isOneOf(ROLES, value);
}

export function isPermission(value: unknown): value is Permission {
  return isOneOf(PERMISSIONS, value);
}

export function isVisibility(value: unknown): value is Visibility {
  return isOneOf(VISIBILITIES, value);
}

export interface UserRow {
  readonly id: number;
  readonly username: string;
  readonly time_zone: string;
  readonly [key: string]: unknown;
}

export interface GroupRow {
  readonly id: number;
  readonly path: string;
  readonly name: string;
  readonly parent_id: number | null;
  readonly visibility: Visibility;
  readonly [key: string]: unknown;
}

export interface ProjectRow extends Readonly<ProjectSettings> {
  readonly id: number;
  readonly group_id: number;
  readonly slug: string;
  readonly path: string;
  readonly visibility: Visibility;
  readonly default_branch: string;
  readonly seq: number;
  readonly [key: string]: unknown;
}

// What a person may do in one project or group. `implied` is the read-only reporter a non-member gets on an
// internal or public project: it may read, create issues and comment on issues, nothing else.
export interface Access {
  readonly level: number;
  readonly role: Role | null;
  readonly permissions: ReadonlySet<Permission>;
  readonly member: boolean;
  readonly implied: boolean;
  readonly canRead: boolean;
}

interface Rule {
  readonly min: Role;
  readonly permission?: Permission;
}

// "Minimum role per action" from the brief. Reads are listed so handlers ask for an action, never for a number.
const ACTIONS = {
  "issue.read": { min: "guest" },
  "board.read": { min: "guest" },
  "milestone.read": { min: "guest" },
  "epic.read": { min: "guest" },
  "wiki.read": { min: "guest" },
  "issue.comment": { min: "guest" },
  "code.read": { min: "reporter" },
  "mr.read": { min: "reporter" },
  "pipeline.read": { min: "reporter" },
  "environment.read": { min: "reporter" },
  "metrics.read": { min: "reporter" },
  "mr.comment": { min: "reporter" },
  "issue.create": { min: "reporter" },
  "board.move": { min: "reporter" },
  "issue.edit": { min: "reporter" },
  "commit": { min: "developer" },
  "mr.write": { min: "developer" },
  "suggestion.apply": { min: "developer" },
  "job.run": { min: "developer" },
  "wiki.write": { min: "developer" },
  "approve": { min: "developer", permission: "approve" },
  "settings": { min: "maintainer" },
  "train.manage": { min: "maintainer" },
  "board.admin": { min: "maintainer", permission: "admin_board" },
  "finding.dismiss": { min: "maintainer", permission: "dismiss_finding" },
  "environment.manage": { min: "maintainer", permission: "manage_environments" },
  "audit.read": { min: "owner", permission: "read_audit" },
  "members": { min: "owner" },
  "transfer": { min: "owner" },
} as const satisfies Record<string, Rule>;

export type Action = keyof typeof ACTIONS;

const IMPLIED_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  "issue.read", "board.read", "milestone.read", "epic.read", "wiki.read", "issue.comment", "code.read", "mr.read",
  "pipeline.read", "environment.read", "metrics.read", "issue.create",
]);

export function can(access: Access, action: Action): boolean {
  if (!access.canRead) return false;
  if (access.implied) return IMPLIED_ACTIONS.has(action);
  const rule: Rule = ACTIONS[action];
  if (access.level >= ROLE_LEVEL[rule.min]) return true;
  return rule.permission !== undefined && access.permissions.has(rule.permission);
}

export function atLeast(access: Access, role: Role): boolean {
  return access.canRead && !access.implied && access.level >= ROLE_LEVEL[role];
}

export function requireAction(access: Access, action: Action): void {
  if (!can(access, action)) throw access.canRead ? forbidden() : notFound();
}

interface MembershipRow {
  readonly role: string | null;
  readonly base: string | null;
  readonly permissions: string[] | null;
}

function combine(rows: readonly MembershipRow[], visibility: Visibility): Access {
  let level = 0;
  let role: Role | null = null;
  const permissions = new Set<Permission>();
  for (const row of rows) {
    const name = row.role ?? row.base;
    if (isRole(name) && ROLE_LEVEL[name] > level) {
      level = ROLE_LEVEL[name];
      role = name;
    }
    for (const permission of row.permissions ?? []) if (isPermission(permission)) permissions.add(permission);
  }
  const member = rows.length > 0;
  if (member) return { level, role, permissions, member, implied: false, canRead: true };
  const open = visibility === "internal" || visibility === "public";
  return { level: open ? ROLE_LEVEL.reporter : 0, role: open ? "reporter" : null, permissions, member: false, implied: open, canRead: open };
}

const PROJECT_MEMBERSHIPS = `
  SELECT pm.role, cr.base, cr.permissions FROM project_members pm
    LEFT JOIN custom_roles cr ON cr.id = pm.custom_role_id
   WHERE pm.project_id = $1 AND pm.user_id = $2
  UNION ALL
  SELECT gm.role, cr.base, cr.permissions FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    LEFT JOIN custom_roles cr ON cr.id = gm.custom_role_id
   WHERE gm.user_id = $2 AND ($3 = g.path OR $3 LIKE g.path || '/%')`;

export async function projectAccess(q: Queryable, userId: number, project: ProjectRow): Promise<Access> {
  const groupPath = project.path.slice(0, project.path.lastIndexOf("/"));
  const rows = await q.q<MembershipRow>(PROJECT_MEMBERSHIPS, [project.id, userId, groupPath]);
  return combine(rows, project.visibility);
}

export async function groupAccess(q: Queryable, userId: number, group: GroupRow): Promise<Access> {
  const rows = await q.q<MembershipRow>(
    `SELECT gm.role, cr.base, cr.permissions FROM group_members gm
       JOIN groups g ON g.id = gm.group_id
       LEFT JOIN custom_roles cr ON cr.id = gm.custom_role_id
      WHERE gm.user_id = $1 AND ($2 = g.path OR $2 LIKE g.path || '/%')`,
    [userId, group.path],
  );
  return combine(rows, group.visibility);
}

export async function findProject(q: Queryable, id: number): Promise<ProjectRow | undefined> {
  return q.maybe<ProjectRow>("SELECT * FROM projects WHERE id = $1", [id]);
}

export async function findGroup(q: Queryable, id: number): Promise<GroupRow | undefined> {
  return q.maybe<GroupRow>("SELECT * FROM groups WHERE id = $1", [id]);
}

interface ProjectScope {
  readonly project: ProjectRow;
  readonly access: Access;
}

// Resolves a project the user may read (404 otherwise: private resources never answer 403 to outsiders).
export async function projectScope(q: Queryable, user: UserRow, projectId: number): Promise<ProjectScope> {
  const project = Number.isInteger(projectId) ? await findProject(q, projectId) : undefined;
  if (project === undefined) throw notFound();
  const access = await projectAccess(q, user.id, project);
  if (!access.canRead) throw notFound();
  return { project, access };
}

interface GroupScope {
  readonly group: GroupRow;
  readonly access: Access;
}

export async function groupScope(q: Queryable, user: UserRow, groupId: number): Promise<GroupScope> {
  const group = Number.isInteger(groupId) ? await findGroup(q, groupId) : undefined;
  if (group === undefined) throw notFound();
  const access = await groupAccess(q, user.id, group);
  if (!access.canRead) throw notFound();
  return { group, access };
}

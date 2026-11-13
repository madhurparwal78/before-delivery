// Group and project members: add, change and remove, with audit events and the live `role` message (DP-38, DP-39).
import { audit } from "../audit.ts";
import { withTx, db, type Queryable, type Tx } from "../db.ts";
import {
  groupAccess,
  groupScope,
  isRole,
  projectAccess,
  projectScope,
  requireAction,
  ROLES,
  type GroupRow,
  type ProjectRow,
  type Role,
  type UserRow,
} from "../access.ts";
import { FieldErrors, conflict, notFound, validation } from "../errors.ts";
import { intParam, json, noContent, type Router } from "../http.ts";
import { revalidateAccess } from "../live.ts";
import { bodyOf, text, whole, type Body } from "./input.ts";

interface MemberTarget {
  readonly kind: "group" | "project";
  readonly id: number;
  readonly path: string;
}

interface MemberRow {
  readonly user_id: number;
  readonly username: string;
  readonly role: Role | null;
  readonly custom_role_id: number | null;
  readonly custom_role: string | null;
}

interface Grant {
  readonly role: Role | null;
  readonly customRoleId: number | null;
  readonly customRoleName: string | null;
}

const COLUMNS = {
  group: { table: "group_members", key: "group_id" },
  project: { table: "project_members", key: "project_id" },
} as const;

const MEMBER_SELECT = (kind: MemberTarget["kind"]): string =>
  `SELECT m.user_id, u.username, m.role, m.custom_role_id, cr.name AS custom_role
     FROM ${COLUMNS[kind].table} m JOIN users u ON u.id = m.user_id LEFT JOIN custom_roles cr ON cr.id = m.custom_role_id
    WHERE m.${COLUMNS[kind].key} = $1`;

const ROLE_MESSAGE = `Role must be ${ROLES.slice(0, -1).join(", ")} or ${ROLES[ROLES.length - 1]}.`;

function groupPathOf(target: MemberTarget): string {
  return target.kind === "group" ? target.path : target.path.slice(0, target.path.lastIndexOf("/"));
}

async function findMember(q: Queryable, target: MemberTarget, username: string): Promise<MemberRow | undefined> {
  return q.maybe<MemberRow>(`${MEMBER_SELECT(target.kind)} AND u.username = $2`, [target.id, username]);
}

function shown(grant: { role: Role | null; custom_role: string | null }): { role: Role | null } | { custom_role: string } {
  return grant.custom_role !== null ? { custom_role: grant.custom_role } : { role: grant.role };
}

// A custom role may be used where it is defined or below that group.
async function resolveGrant(q: Queryable, target: MemberTarget, body: Body, errors: FieldErrors): Promise<Grant | undefined> {
  const role = body["role"];
  const custom = body["custom_role"];
  const hasRole = role !== undefined && role !== null;
  const hasCustom = custom !== undefined && custom !== null;
  if (hasRole === hasCustom) {
    errors.add("role", "Choose a role or a custom role.");
    return undefined;
  }
  if (hasRole) {
    if (!isRole(role)) {
      errors.add("role", ROLE_MESSAGE);
      return undefined;
    }
    return { role, customRoleId: null, customRoleName: null };
  }
  const id = whole(body, "custom_role");
  const found =
    id === undefined
      ? undefined
      : await q.maybe<{ id: number; name: string }>(
          `SELECT cr.id, cr.name FROM custom_roles cr JOIN groups g ON g.id = cr.group_id
            WHERE cr.id = $1 AND ($2 = g.path OR $2 LIKE g.path || '/%')`,
          [id, groupPathOf(target)],
        );
  if (found === undefined) {
    errors.add("custom_role", "Unknown custom role.");
    return undefined;
  }
  return { role: null, customRoleId: found.id, customRoleName: found.name };
}

// Projects whose access the change can alter, locked in id order.
async function lockAffected(tx: Tx, target: MemberTarget): Promise<ProjectRow[]> {
  const rows =
    target.kind === "project"
      ? await tx.q<ProjectRow>("SELECT * FROM projects WHERE id = $1", [target.id])
      : await tx.q<ProjectRow>("SELECT * FROM projects WHERE path LIKE $1 ORDER BY id", [`${target.path}/%`]);
  for (const project of rows) await tx.lockProject(project.id);
  return rows;
}

// One `role` message per affected project: the person's role now, or null when they lost read access.
async function announce(tx: Tx, projects: readonly ProjectRow[], userId: number, username: string): Promise<number | null> {
  let seq: number | null = null;
  for (const project of projects) {
    const access = await projectAccess(tx, userId, project);
    const role = access.canRead ? access.role : null;
    const sentence = role === null ? `You no longer have access to ${project.path}.` : `Your role in ${project.path} is now ${role}.`;
    seq = await tx.emit(project.id, "role", { username, path: project.path, role }, { say: [{ text: sentence, to: username }] });
    tx.afterCommit(() => revalidateAccess(project.id, userId));
  }
  return seq;
}

function auditScope(target: MemberTarget): { projectId: number } | { groupId: number } {
  return target.kind === "project" ? { projectId: target.id } : { groupId: target.id };
}

async function currentSeq(tx: Tx, target: MemberTarget, emitted: number | null): Promise<number | undefined> {
  if (target.kind === "group") return undefined;
  return emitted ?? (await tx.currentSeq(target.id));
}

interface MemberView {
  readonly username: string;
  readonly role: Role | null;
  readonly custom_role: string | null;
}

const viewOf = (row: MemberRow): MemberView => ({ username: row.username, role: row.role, custom_role: row.custom_role });

async function addMember(tx: Tx, actor: string, target: MemberTarget, body: Body): Promise<{ view: MemberView; seq: number | undefined }> {
  const projects = await lockAffected(tx, target);
  const errors = new FieldErrors();
  const username = text(body, "username")?.toLowerCase();
  const user = username === undefined ? undefined : await tx.maybe<{ id: number }>("SELECT id FROM users WHERE username = $1", [username]);
  if (username === undefined || user === undefined) errors.add("username", "Unknown user.");
  else if ((await findMember(tx, target, username)) !== undefined) {
    throw conflict("already_member", "That person is already a member.");
  }
  const grant = await resolveGrant(tx, target, body, errors);
  errors.throwIfAny();
  if (username === undefined || user === undefined || grant === undefined) throw validation({ username: "Unknown user." });
  const { table, key } = COLUMNS[target.kind];
  await tx.q(`INSERT INTO ${table} (${key}, user_id, role, custom_role_id) VALUES ($1, $2, $3, $4)`, [
    target.id,
    user.id,
    grant.role,
    grant.customRoleId,
  ]);
  const after = shown({ role: grant.role, custom_role: grant.customRoleName });
  await audit(tx, { ...auditScope(target), actor, action: "member.add", target: `${target.path}:${username}`, before: null, after });
  const seq = await announce(tx, projects, user.id, username);
  return {
    view: { username, role: grant.role, custom_role: grant.customRoleName },
    seq: await currentSeq(tx, target, seq),
  };
}

async function updateMember(
  tx: Tx,
  actor: string,
  target: MemberTarget,
  username: string,
  body: Body,
): Promise<{ view: MemberView; seq: number | undefined }> {
  const projects = await lockAffected(tx, target);
  const member = await findMember(tx, target, username);
  if (member === undefined) throw notFound();
  const errors = new FieldErrors();
  const grant = await resolveGrant(tx, target, body, errors);
  errors.throwIfAny();
  if (grant === undefined) throw validation({ role: "Choose a role or a custom role." });
  const { table, key } = COLUMNS[target.kind];
  const before = shown(member);
  const after = shown({ role: grant.role, custom_role: grant.customRoleName });
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  if (!unchanged) {
    await tx.q(`UPDATE ${table} SET role = $3, custom_role_id = $4 WHERE ${key} = $1 AND user_id = $2`, [
      target.id,
      member.user_id,
      grant.role,
      grant.customRoleId,
    ]);
    await audit(tx, { ...auditScope(target), actor, action: "member.update", target: `${target.path}:${username}`, before, after });
  }
  const seq = unchanged ? null : await announce(tx, projects, member.user_id, username);
  return { view: { username, role: grant.role, custom_role: grant.customRoleName }, seq: await currentSeq(tx, target, seq) };
}

async function removeMember(tx: Tx, actor: string, target: MemberTarget, username: string): Promise<void> {
  const projects = await lockAffected(tx, target);
  const member = await findMember(tx, target, username);
  if (member === undefined) throw notFound();
  const { table, key } = COLUMNS[target.kind];
  await tx.q(`DELETE FROM ${table} WHERE ${key} = $1 AND user_id = $2`, [target.id, member.user_id]);
  await audit(tx, {
    ...auditScope(target),
    actor,
    action: "member.remove",
    target: `${target.path}:${username}`,
    before: shown(member),
    after: null,
  });
  await announce(tx, projects, member.user_id, username);
}

async function membersOf(q: Queryable, target: MemberTarget): Promise<MemberRow[]> {
  return q.q<MemberRow>(`${MEMBER_SELECT(target.kind)} ORDER BY u.username`, [target.id]);
}

type MemberWithRole = MemberView & { effective_role: Role | null };

export async function groupMembersView(q: Queryable, group: GroupRow): Promise<MemberWithRole[]> {
  const rows = await membersOf(q, { kind: "group", id: group.id, path: group.path });
  const view: MemberWithRole[] = [];
  for (const row of rows) view.push({ ...viewOf(row), effective_role: (await groupAccess(q, row.user_id, group)).role });
  return view;
}

export async function projectMembersView(q: Queryable, project: ProjectRow): Promise<MemberWithRole[]> {
  const rows = await membersOf(q, { kind: "project", id: project.id, path: project.path });
  const view: MemberWithRole[] = [];
  for (const row of rows) view.push({ ...viewOf(row), effective_role: (await projectAccess(q, row.user_id, project)).role });
  return view;
}

async function groupTarget(tx: Tx, user: UserRow, id: number): Promise<MemberTarget> {
  const { group, access } = await groupScope(tx, user, id);
  requireAction(access, "members");
  return { kind: "group", id: group.id, path: group.path };
}

async function projectTarget(tx: Tx, user: UserRow, id: number): Promise<MemberTarget> {
  const { project, access } = await projectScope(tx, user, id);
  requireAction(access, "settings");
  return { kind: "project", id: project.id, path: project.path };
}

export function registerMemberRoutes(router: Router): void {
  for (const kind of ["group", "project"] as const) {
    const base = kind === "group" ? "/api/groups/:id/members" : "/api/projects/:id/members";
    const resolve = kind === "group" ? groupTarget : projectTarget;

    router.post(base, (ctx) =>
      withTx(async (tx) => {
        const target = await resolve(tx, ctx.user, intParam(ctx, "id"));
        const added = await addMember(tx, ctx.user.username, target, bodyOf(ctx.body));
        return json(201, added.seq === undefined ? added.view : { ...added.view, seq: added.seq });
      }),
    );

    router.patch(`${base}/:username`, (ctx) =>
      withTx(async (tx) => {
        const target = await resolve(tx, ctx.user, intParam(ctx, "id"));
        const changed = await updateMember(tx, ctx.user.username, target, (ctx.params["username"] ?? "").toLowerCase(), bodyOf(ctx.body));
        return json(200, changed.seq === undefined ? changed.view : { ...changed.view, seq: changed.seq });
      }),
    );

    router.delete(`${base}/:username`, (ctx) =>
      withTx(async (tx) => {
        const target = await resolve(tx, ctx.user, intParam(ctx, "id"));
        await removeMember(tx, ctx.user.username, target, (ctx.params["username"] ?? "").toLowerCase());
        return noContent();
      }),
    );
  }

  router.get("/api/projects/:id/members", async (ctx) => {
    const { project } = await projectScope(db, ctx.user, intParam(ctx, "id"));
    return json(200, { members: await projectMembersView(db, project) });
  });
}

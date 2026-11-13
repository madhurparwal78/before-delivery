// Groups: creation with the nesting and visibility rules, the group page data, visibility changes and custom roles (DP-38).
import { audit } from "../audit.ts";
import { now } from "../clock.ts";
import { db, withTx, type Queryable } from "../db.ts";
import {
  groupAccess,
  groupScope,
  isPermission,
  isRole,
  isVisibility,
  can,
  PERMISSIONS,
  projectAccess,
  requireAction,
  ROLES,
  type Access,
  type GroupRow,
  type Permission,
  type ProjectRow,
  type Role,
  type Visibility,
} from "../access.ts";
import { ApiError, FieldErrors, fieldError, validation, validationOne } from "../errors.ts";
import { intParam, json, type Router } from "../http.ts";
import { bodyOf, text, whole } from "./input.ts";
import { exceedsVisibility, groupLevels, isSegment, MAX_GROUP_LEVELS, NEST_MESSAGE, SEGMENT_MESSAGE, visibilityMessage } from "./rules.ts";
import { groupMembersView } from "./members.ts";

export const visibilityExceeded = (parent: Visibility): ApiError =>
  fieldError("visibility", "visibility", visibilityMessage(parent));

export const VISIBILITY_MESSAGE = "Visibility must be private, internal or public.";

export function permissionList(access: Access): Permission[] {
  const effective = new Set<Permission>(access.permissions);
  if (can(access, "approve")) effective.add("approve");
  if (can(access, "environment.manage")) effective.add("manage_environments");
  if (can(access, "finding.dismiss")) effective.add("dismiss_finding");
  if (can(access, "board.admin")) effective.add("admin_board");
  if (can(access, "audit.read")) effective.add("read_audit");
  return PERMISSIONS.filter((permission) => effective.has(permission));
}

export async function createGroupRow(
  q: Queryable,
  input: { path: string; name: string; parentId: number | null; visibility: Visibility },
): Promise<GroupRow> {
  return q.one<GroupRow>(
    "INSERT INTO groups (path, name, parent_id, visibility, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    [input.path, input.name, input.parentId, input.visibility, now()],
  );
}

async function groupView(q: Queryable, group: GroupRow, access: Access, userId: number): Promise<Record<string, unknown>> {
  const children = await q.q<GroupRow>("SELECT * FROM groups WHERE parent_id = $1 ORDER BY path", [group.id]);
  const subgroups: Array<Record<string, unknown>> = [];
  for (const child of children) {
    if ((await groupAccess(q, userId, child)).canRead) subgroups.push({ id: child.id, path: child.path, name: child.name, visibility: child.visibility });
  }
  const owned = await q.q<ProjectRow>("SELECT * FROM projects WHERE group_id = $1 ORDER BY path", [group.id]);
  const projects: Array<Record<string, unknown>> = [];
  for (const project of owned) {
    if ((await projectAccess(q, userId, project)).canRead) {
      projects.push({ id: project.id, path: project.path, name: project.slug, slug: project.slug, visibility: project.visibility });
    }
  }
  const roles = await q.q<{ id: number; name: string; base: Role; permissions: Permission[] }>(
    "SELECT id, name, base, permissions FROM custom_roles WHERE group_id = $1 ORDER BY name",
    [group.id],
  );
  return {
    id: group.id,
    path: group.path,
    name: group.name,
    parent_id: group.parent_id,
    visibility: group.visibility,
    my_role: access.role,
    my_permissions: permissionList(access),
    subgroups,
    projects,
    members: await groupMembersView(q, group),
    custom_roles: roles,
  };
}

export function registerGroupRoutes(router: Router): void {
  router.post("/api/groups", (ctx) =>
    withTx(async (tx) => {
      const body = bodyOf(ctx.body);
      const parentId = body["parent"] === null || body["parent"] === undefined ? null : whole(body, "parent");
      let parent: GroupRow | undefined;
      if (parentId !== null) {
        if (parentId === undefined) throw validationOne("parent", "Parent must be a group id or null.");
        const scope = await groupScope(tx, ctx.user, parentId);
        requireAction(scope.access, "members");
        parent = scope.group;
      }
      const errors = new FieldErrors();
      const name = text(body, "name") ?? "";
      const visibility = body["visibility"];
      const valid = isSegment(name);
      if (!valid) errors.add("name", SEGMENT_MESSAGE);
      if (!isVisibility(visibility)) errors.add("visibility", VISIBILITY_MESSAGE);
      if (parent !== undefined && groupLevels(parent.path) + 1 > MAX_GROUP_LEVELS) errors.add("parent", NEST_MESSAGE);
      errors.throwIfAny();
      if (!isVisibility(visibility)) throw validationOne("visibility", VISIBILITY_MESSAGE);
      if (parent !== undefined && exceedsVisibility(visibility, parent.visibility)) throw visibilityExceeded(parent.visibility);
      const path = parent === undefined ? name : `${parent.path}/${name}`;
      if ((await tx.maybe("SELECT 1 FROM groups WHERE path = $1", [path])) !== undefined) {
        throw validationOne("name", "That path is taken.");
      }
      const group = await createGroupRow(tx, { path, name, parentId: parent?.id ?? null, visibility });
      await tx.q("INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')", [group.id, ctx.user.id]);
      return json(201, { id: group.id, path: group.path });
    }),
  );

  router.get("/api/groups/:id", async (ctx) => {
    const { group, access } = await groupScope(db, ctx.user, intParam(ctx, "id"));
    return json(200, await groupView(db, group, access, ctx.user.id));
  });

  router.patch("/api/groups/:id", (ctx) =>
    withTx(async (tx) => {
      const { group, access } = await groupScope(tx, ctx.user, intParam(ctx, "id"));
      requireAction(access, "members");
      const visibility = bodyOf(ctx.body)["visibility"];
      if (!isVisibility(visibility)) throw validationOne("visibility", VISIBILITY_MESSAGE);
      const parent = group.parent_id === null ? undefined : await tx.maybe<GroupRow>("SELECT * FROM groups WHERE id = $1", [group.parent_id]);
      if (parent !== undefined && exceedsVisibility(visibility, parent.visibility)) throw visibilityExceeded(parent.visibility);
      if (visibility !== group.visibility) {
        await tx.q("UPDATE groups SET visibility = $2 WHERE id = $1", [group.id, visibility]);
        await audit(tx, {
          groupId: group.id,
          actor: ctx.user.username,
          action: "group.visibility",
          target: group.path,
          before: { visibility: group.visibility },
          after: { visibility },
        });
      }
      return json(200, { id: group.id, path: group.path, name: group.name, visibility });
    }),
  );

  router.post("/api/groups/:id/custom_roles", (ctx) =>
    withTx(async (tx) => {
      const { group, access } = await groupScope(tx, ctx.user, intParam(ctx, "id"));
      requireAction(access, "members");
      const body = bodyOf(ctx.body);
      const errors = new FieldErrors();
      const name = (text(body, "name") ?? "").trim();
      const base = body["base"];
      const listed = body["permissions"];
      if (name === "" || name.length > 60) errors.add("name", "Name must be 1 to 60 characters.");
      if (!isRole(base)) errors.add("base", `Base must be ${ROLES.slice(0, -1).join(", ")} or ${ROLES[ROLES.length - 1]}.`);
      const permissions: Permission[] = [];
      if (!Array.isArray(listed) || !listed.every(isPermission)) errors.add("permissions", `Permissions must be some of ${PERMISSIONS.join(", ")}.`);
      else for (const permission of listed) if (!permissions.includes(permission)) permissions.push(permission);
      if (name !== "" && (await tx.maybe("SELECT 1 FROM custom_roles WHERE group_id = $1 AND name = $2", [group.id, name])) !== undefined) {
        errors.add("name", "That role name is taken.");
      }
      errors.throwIfAny();
      if (!isRole(base)) throw validation({ base: "Invalid base role." });
      const created = await tx.one<{ id: number }>(
        "INSERT INTO custom_roles (group_id, name, base, permissions) VALUES ($1, $2, $3, $4) RETURNING id",
        [group.id, name, base, permissions],
      );
      await audit(tx, {
        groupId: group.id,
        actor: ctx.user.username,
        action: "custom_role.create",
        target: `${group.path}:${name}`,
        before: null,
        after: { base, permissions },
      });
      return json(201, { id: created.id, name, base, permissions });
    }),
  );
}

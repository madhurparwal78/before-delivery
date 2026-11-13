// Projects: creation, the project page data, settings and every protection setting of the settings page (DP-38, DP-42).
import { audit } from "../audit.ts";
import { now } from "../clock.ts";
import { db, withTx, type Queryable, type Tx } from "../db.ts";
import {
  groupScope,
  isRole,
  isVisibility,
  projectScope,
  requireAction,
  type Action,
  type ProjectRow,
  type Role,
  type Visibility,
} from "../access.ts";
import { FieldErrors, notFound, validationOne } from "../errors.ts";
import { intParam, json, noContent, type Ctx, type Router } from "../http.ts";
import { bodyOf, flag, strings, text, whole, type Body } from "./input.ts";
import { exceedsVisibility, isRegex, isSegment, sameList, SEGMENT_MESSAGE } from "./rules.ts";
import { permissionList, VISIBILITY_MESSAGE, visibilityExceeded } from "./groups.ts";
import { projectMembersView } from "./members.ts";
import { webhookViews } from "./webhooks.ts";
import { refreshChecks } from "../mr/index.ts";
import { FLAG_SETTINGS, MERGE_METHODS, isMergeMethod, type ProjectSettings } from "../../shared/settings.ts";

const DEFAULT_SETTINGS: Readonly<ProjectSettings> = {
  merge_method: "merge_commit",
  merge_trains: false,
  pipelines_must_succeed: false,
  reset_approvals_on_push: true,
  author_can_approve: false,
  auto_resolve_outdated: false,
};

const DEFAULT_PROTECTION = { allowed_to_push: "maintainer", allowed_to_merge: "developer" } as const;

function settingsOf(project: ProjectRow): ProjectSettings {
  return {
    merge_method: project.merge_method,
    merge_trains: project.merge_trains,
    pipelines_must_succeed: project.pipelines_must_succeed,
    reset_approvals_on_push: project.reset_approvals_on_push,
    author_can_approve: project.author_can_approve,
    auto_resolve_outdated: project.auto_resolve_outdated,
  };
}

interface PushRules {
  branch_name: string | null;
  commit_message: string | null;
  forbidden_files: string[];
  required_files: string[];
  secrets: boolean;
}

const EMPTY_PUSH_RULES: Readonly<PushRules> = { branch_name: null, commit_message: null, forbidden_files: [], required_files: [], secrets: false };

interface ProjectInput {
  readonly groupId: number;
  readonly slug: string;
  readonly path: string;
  readonly visibility: Visibility;
  readonly defaultBranch: string;
  readonly settings?: Partial<ProjectSettings>;
}

// The one place a project row is made (API, seed, import): with its settings and an empty push rules row.
export async function createProjectRow(q: Queryable, input: ProjectInput): Promise<ProjectRow> {
  const settings: ProjectSettings = { ...DEFAULT_SETTINGS, ...input.settings };
  const project = await q.one<ProjectRow>(
    `INSERT INTO projects (group_id, slug, path, visibility, default_branch, merge_method, merge_trains, pipelines_must_succeed,
                           reset_approvals_on_push, author_can_approve, auto_resolve_outdated, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [
      input.groupId, input.slug, input.path, input.visibility, input.defaultBranch, settings.merge_method, settings.merge_trains,
      settings.pipelines_must_succeed, settings.reset_approvals_on_push, settings.author_can_approve, settings.auto_resolve_outdated, now(),
    ],
  );
  await q.q("INSERT INTO push_rules (project_id) VALUES ($1)", [project.id]);
  return project;
}

export async function protectDefaultBranch(q: Queryable, projectId: number, branch: string): Promise<void> {
  await q.q("INSERT INTO protected_branches (project_id, pattern, allowed_to_push, allowed_to_merge) VALUES ($1, $2, $3, $4)", [
    projectId, branch, DEFAULT_PROTECTION.allowed_to_push, DEFAULT_PROTECTION.allowed_to_merge,
  ]);
}

const BRANCH_NAME = /^[^\s~^:?*[\\]{1,100}$/;
const BRANCH_MESSAGE = "Default branch must be 1 to 100 characters without spaces.";

async function hasBranches(q: Queryable, projectId: number): Promise<boolean> {
  return (await q.maybe("SELECT 1 FROM refs WHERE project_id = $1 AND kind = 'branch' LIMIT 1", [projectId])) !== undefined;
}

async function branchExists(q: Queryable, projectId: number, name: string): Promise<boolean> {
  return (await q.maybe("SELECT 1 FROM refs WHERE project_id = $1 AND kind = 'branch' AND name = $2", [projectId, name])) !== undefined;
}

async function groupOf(q: Queryable, groupId: number): Promise<{ id: number; path: string; visibility: Visibility }> {
  return q.one<{ id: number; path: string; visibility: Visibility }>("SELECT id, path, visibility FROM groups WHERE id = $1", [groupId]);
}

async function lockedProject(tx: Tx, ctx: Ctx, action: Action): Promise<{ project: ProjectRow; actor: string }> {
  const { project, access } = await projectScope(tx, ctx.user, intParam(ctx, "id"));
  requireAction(access, action);
  await tx.lockProject(project.id);
  const fresh = await tx.one<ProjectRow>("SELECT * FROM projects WHERE id = $1", [project.id]);
  return { project: fresh, actor: ctx.user.username };
}

function required(value: string | undefined, message: string): string {
  if (value === undefined || value.trim() === "") throw validationOne("pattern", message);
  return value;
}

// Settings and approval rules feed the merge checks, so every request that can still change gets them re-evaluated.
async function refreshRequests(tx: Tx, project: ProjectRow): Promise<void> {
  const open = await tx.q<{ id: number }>("SELECT id FROM merge_requests WHERE project_id = $1 AND state <> 'merged' ORDER BY iid", [project.id]);
  for (const request of open) await refreshChecks(tx, project, request.id);
}

async function updateSettings(tx: Tx, ctx: Ctx): Promise<Record<string, unknown>> {
  const { project, actor } = await lockedProject(tx, ctx, "settings");
  const body = bodyOf(ctx.body);
  const errors = new FieldErrors();
  const changes: Record<string, string | boolean> = {};
  const method = body["merge_method"];
  if (method !== undefined) {
    if (isMergeMethod(method)) changes["merge_method"] = method;
    else errors.add("merge_method", `Merge method must be ${MERGE_METHODS.slice(0, -1).join(", ")} or ${MERGE_METHODS[MERGE_METHODS.length - 1]}.`);
  }
  for (const key of FLAG_SETTINGS) {
    const value = flag(body, key);
    if (body[key] === undefined) continue;
    if (value === undefined) errors.add(key, `${key} must be true or false.`);
    else changes[key] = value;
  }
  const branch = body["default_branch"];
  if (branch !== undefined) {
    if (typeof branch !== "string" || !BRANCH_NAME.test(branch)) errors.add("default_branch", BRANCH_MESSAGE);
    else if ((await hasBranches(tx, project.id)) && !(await branchExists(tx, project.id, branch))) {
      errors.add("default_branch", `Branch ${branch} doesn't exist.`);
    } else changes["default_branch"] = branch;
  }
  const visibility = body["visibility"];
  if (visibility !== undefined) {
    if (!isVisibility(visibility)) errors.add("visibility", VISIBILITY_MESSAGE);
    else changes["visibility"] = visibility;
  }
  errors.throwIfAny();
  if (typeof changes["visibility"] === "string" && isVisibility(changes["visibility"])) {
    const group = await groupOf(tx, project.group_id);
    if (exceedsVisibility(changes["visibility"], group.visibility)) throw visibilityExceeded(group.visibility);
  }
  const before: Record<string, unknown> = {};
  const after: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (project[key] === value) continue;
    before[key] = project[key];
    after[key] = value;
  }
  const keys = Object.keys(after);
  if (keys.length > 0) {
    const assignments = keys.map((key, index) => `${key} = $${index + 2}`).join(", ");
    await tx.q(`UPDATE projects SET ${assignments} WHERE id = $1`, [project.id, ...Object.values(after)]);
    await audit(tx, { projectId: project.id, actor, action: "project.settings", target: project.path, before, after });
  }
  const fresh = await tx.one<ProjectRow>("SELECT * FROM projects WHERE id = $1", [project.id]);
  if (keys.length > 0) await refreshRequests(tx, fresh);
  return { ...settingsOf(fresh), default_branch: fresh.default_branch, visibility: fresh.visibility, seq: await tx.currentSeq(project.id) };
}

interface BranchRule {
  allowed_to_push: Role;
  allowed_to_merge: Role;
}

// The placeholder returned for a bad value is never used: the caller throws the collected errors before reading it.
function roleField(body: Body, key: string, errors: FieldErrors): Role {
  const value = body[key];
  if (isRole(value)) return value;
  errors.add(key, `${key} must be guest, reporter, developer, maintainer or owner.`);
  return "guest";
}

interface ApprovalRuleRow {
  id: number;
  name: string;
  required: number;
  users: string[];
  groups: string[];
}

const ruleShape = (row: { name: string; required: number; users: string[]; groups: string[] }): object => ({
  name: row.name,
  required: row.required,
  users: row.users,
  groups: row.groups,
});

async function checkedNames(q: Queryable, field: "users" | "groups", names: readonly string[], errors: FieldErrors): Promise<void> {
  for (const name of names) {
    const table = field === "users" ? "SELECT 1 FROM users WHERE username = $1" : "SELECT 1 FROM groups WHERE path = $1";
    if ((await q.maybe(table, [name])) === undefined) errors.add(field, field === "users" ? `Unknown user ${name}.` : `Unknown group ${name}.`);
  }
}

async function readRule(tx: Tx, project: ProjectRow, body: Body, current: ApprovalRuleRow | undefined): Promise<Omit<ApprovalRuleRow, "id">> {
  const errors = new FieldErrors();
  const name = body["name"] === undefined && current !== undefined ? current.name : (text(body, "name") ?? "").trim();
  const requiredCount = body["required"] === undefined && current !== undefined ? current.required : whole(body, "required");
  const users = body["users"] === undefined && current !== undefined ? current.users : strings(body, "users");
  const groups = body["groups"] === undefined && current !== undefined ? current.groups : (body["groups"] === undefined ? [] : strings(body, "groups"));
  if (name === "" || name.length > 100) errors.add("name", "Name must be 1 to 100 characters.");
  if (requiredCount === undefined || requiredCount < 0 || requiredCount > 100) errors.add("required", "Required approvals must be a whole number from 0 to 100.");
  if (users === undefined) errors.add("users", "Users must be a list of usernames.");
  if (groups === undefined) errors.add("groups", "Groups must be a list of group paths.");
  if (users !== undefined) await checkedNames(tx, "users", users, errors);
  if (groups !== undefined) await checkedNames(tx, "groups", groups, errors);
  const taken = await tx.maybe<{ id: number }>("SELECT id FROM approval_rules WHERE project_id = $1 AND name = $2", [project.id, name]);
  if (taken !== undefined && taken.id !== current?.id) errors.add("name", "That name is taken.");
  errors.throwIfAny();
  return { name, required: requiredCount ?? 0, users: users ?? [], groups: groups ?? [] };
}

async function loadRule(tx: Tx, project: ProjectRow, ctx: Ctx): Promise<ApprovalRuleRow> {
  const raw = ctx.params["rule"] ?? "";
  if (!/^\d{1,9}$/.test(raw)) throw notFound();
  const rule = await tx.maybe<ApprovalRuleRow>("SELECT id, name, required, users, groups FROM approval_rules WHERE project_id = $1 AND id = $2", [project.id, Number(raw)]);
  if (rule === undefined) throw notFound();
  return rule;
}

async function protectionView(q: Queryable, project: ProjectRow): Promise<Record<string, unknown>> {
  const id = [project.id];
  return {
    protected_branches: await q.q("SELECT pattern AS name, allowed_to_push, allowed_to_merge FROM protected_branches WHERE project_id = $1 ORDER BY pattern", id),
    protected_tags: await q.q("SELECT pattern AS name, allowed_to_create FROM protected_tags WHERE project_id = $1 ORDER BY pattern", id),
    push_rules:
      (await q.maybe<PushRules>("SELECT branch_name, commit_message, forbidden_files, required_files, secrets FROM push_rules WHERE project_id = $1", id)) ??
      EMPTY_PUSH_RULES,
    approval_rules: await q.q("SELECT id, name, required, users, groups FROM approval_rules WHERE project_id = $1 ORDER BY id", id),
    protected_environments: await q.q("SELECT name, roles, approvals FROM protected_environments WHERE project_id = $1 ORDER BY name", id),
    variables: await q.q("SELECT key, value FROM project_variables WHERE project_id = $1 ORDER BY key", id),
  };
}

export function registerProjectRoutes(router: Router): void {
  router.post("/api/projects", (ctx) =>
    withTx(async (tx) => {
      const body = bodyOf(ctx.body);
      const groupId = whole(body, "group");
      if (groupId === undefined) throw notFound();
      const { group, access } = await groupScope(tx, ctx.user, groupId);
      requireAction(access, "settings");
      const errors = new FieldErrors();
      const slug = text(body, "slug") ?? "";
      const visibility = body["visibility"];
      const branch = body["default_branch"] === undefined ? "main" : body["default_branch"];
      if (!isSegment(slug)) errors.add("slug", SEGMENT_MESSAGE);
      if (!isVisibility(visibility)) errors.add("visibility", VISIBILITY_MESSAGE);
      if (typeof branch !== "string" || !BRANCH_NAME.test(branch)) errors.add("default_branch", BRANCH_MESSAGE);
      errors.throwIfAny();
      if (!isVisibility(visibility) || typeof branch !== "string") throw validationOne("visibility", VISIBILITY_MESSAGE);
      if (exceedsVisibility(visibility, group.visibility)) throw visibilityExceeded(group.visibility);
      const path = `${group.path}/${slug}`;
      if ((await tx.maybe("SELECT 1 FROM projects WHERE path = $1", [path])) !== undefined) throw validationOne("slug", "That path is taken.");
      const project = await createProjectRow(tx, { groupId: group.id, slug, path, visibility, defaultBranch: branch });
      await protectDefaultBranch(tx, project.id, branch);
      return json(201, { id: project.id, path: project.path });
    }),
  );

  router.get("/api/projects/:id", async (ctx) => {
    const { project, access } = await projectScope(db, ctx.user, intParam(ctx, "id"));
    const group = await groupOf(db, project.group_id);
    return json(200, {
      id: project.id,
      path: project.path,
      name: project.slug,
      slug: project.slug,
      group: { id: group.id, path: group.path },
      visibility: project.visibility,
      default_branch: project.default_branch,
      settings: settingsOf(project),
      my_role: access.role,
      my_permissions: permissionList(access),
      member: access.member,
      seq: project.seq,
    });
  });

  router.get("/api/projects/:id/settings", async (ctx) => {
    const { project, access } = await projectScope(db, ctx.user, intParam(ctx, "id"));
    requireAction(access, "settings");
    return json(200, {
      ...settingsOf(project),
      default_branch: project.default_branch,
      visibility: project.visibility,
      ...(await protectionView(db, project)),
      members: await projectMembersView(db, project),
      webhooks: await webhookViews(db, project.id),
      seq: project.seq,
    });
  });

  router.patch("/api/projects/:id/settings", (ctx) => withTx(async (tx) => json(200, await updateSettings(tx, ctx))));

  router.put("/api/projects/:id/protected_branches/:pattern", (ctx) =>
    withTx(async (tx) => {
      const { project, actor } = await lockedProject(tx, ctx, "settings");
      const pattern = required(ctx.params["pattern"], "Pattern can't be blank.");
      const body = bodyOf(ctx.body);
      const errors = new FieldErrors();
      const after: BranchRule = {
        allowed_to_push: roleField(body, "allowed_to_push", errors),
        allowed_to_merge: roleField(body, "allowed_to_merge", errors),
      };
      errors.throwIfAny();
      const previous = await tx.maybe<BranchRule>(
        "SELECT allowed_to_push, allowed_to_merge FROM protected_branches WHERE project_id = $1 AND pattern = $2",
        [project.id, pattern],
      );
      if (previous === undefined || previous.allowed_to_push !== after.allowed_to_push || previous.allowed_to_merge !== after.allowed_to_merge) {
        await tx.q(
          `INSERT INTO protected_branches (project_id, pattern, allowed_to_push, allowed_to_merge) VALUES ($1, $2, $3, $4)
           ON CONFLICT (project_id, pattern) DO UPDATE SET allowed_to_push = $3, allowed_to_merge = $4`,
          [project.id, pattern, after.allowed_to_push, after.allowed_to_merge],
        );
        await audit(tx, {
          projectId: project.id, actor, action: "protected_branch.set", target: `${project.path}:${pattern}`,
          before: previous === undefined ? null : { allowed_to_push: previous.allowed_to_push, allowed_to_merge: previous.allowed_to_merge },
          after,
        });
      }
      return json(200, { name: pattern, ...after, seq: await tx.currentSeq(project.id) });
    }),
  );

  router.delete("/api/projects/:id/protected_branches/:pattern", (ctx) =>
    withTx(async (tx) => {
      const { project, actor } = await lockedProject(tx, ctx, "settings");
      const pattern = ctx.params["pattern"] ?? "";
      const previous = await tx.maybe<BranchRule>(
        "DELETE FROM protected_branches WHERE project_id = $1 AND pattern = $2 RETURNING allowed_to_push, allowed_to_merge",
        [project.id, pattern],
      );
      if (previous === undefined) throw notFound();
      await audit(tx, {
        projectId: project.id, actor, action: "protected_branch.remove", target: `${project.path}:${pattern}`,
        before: { allowed_to_push: previous.allowed_to_push, allowed_to_merge: previous.allowed_to_merge }, after: null,
      });
      return noContent();
    }),
  );

  router.put("/api/projects/:id/protected_tags/:pattern", (ctx) =>
    withTx(async (tx) => {
      const { project, actor } = await lockedProject(tx, ctx, "settings");
      const pattern = required(ctx.params["pattern"], "Pattern can't be blank.");
      const errors = new FieldErrors();
      const allowed = roleField(bodyOf(ctx.body), "allowed_to_create", errors);
      errors.throwIfAny();
      const previous = await tx.maybe<{ allowed_to_create: Role }>(
        "SELECT allowed_to_create FROM protected_tags WHERE project_id = $1 AND pattern = $2",
        [project.id, pattern],
      );
      if (previous === undefined || previous.allowed_to_create !== allowed) {
        await tx.q(
          `INSERT INTO protected_tags (project_id, pattern, allowed_to_create) VALUES ($1, $2, $3)
           ON CONFLICT (project_id, pattern) DO UPDATE SET allowed_to_create = $3`,
          [project.id, pattern, allowed],
        );
        await audit(tx, {
          projectId: project.id, actor, action: "protected_tag.set", target: `${project.path}:${pattern}`,
          before: previous === undefined ? null : { allowed_to_create: previous.allowed_to_create }, after: { allowed_to_create: allowed },
        });
      }
      return json(200, { name: pattern, allowed_to_create: allowed, seq: await tx.currentSeq(project.id) });
    }),
  );

  router.delete("/api/projects/:id/protected_tags/:pattern", (ctx) =>
    withTx(async (tx) => {
      const { project, actor } = await lockedProject(tx, ctx, "settings");
      const pattern = ctx.params["pattern"] ?? "";
      const previous = await tx.maybe<{ allowed_to_create: Role }>(
        "DELETE FROM protected_tags WHERE project_id = $1 AND pattern = $2 RETURNING allowed_to_create",
        [project.id, pattern],
      );
      if (previous === undefined) throw notFound();
      await audit(tx, {
        projectId: project.id, actor, action: "protected_tag.remove", target: `${project.path}:${pattern}`,
        before: { allowed_to_create: previous.allowed_to_create }, after: null,
      });
      return noContent();
    }),
  );

  router.put("/api/projects/:id/push_rules", (ctx) =>
    withTx(async (tx) => {
      const { project, actor } = await lockedProject(tx, ctx, "settings");
      const body = bodyOf(ctx.body);
      const errors = new FieldErrors();
      const pattern = (key: "branch_name" | "commit_message"): string | null => {
        const value = body[key];
        if (value === undefined || value === null || value === "") return null;
        if (typeof value !== "string" || !isRegex(value)) {
          errors.add(key, "Pattern must be a valid regular expression.");
          return null;
        }
        return value;
      };
      const list = (key: "forbidden_files" | "required_files"): string[] => {
        if (body[key] === undefined) return [];
        const value = strings(body, key);
        if (value === undefined) errors.add(key, "Enter a list of paths.");
        return value ?? [];
      };
      const next: PushRules = {
        branch_name: pattern("branch_name"),
        commit_message: pattern("commit_message"),
        forbidden_files: list("forbidden_files"),
        required_files: list("required_files"),
        secrets: flag(body, "secrets") ?? false,
      };
      if (body["secrets"] !== undefined && flag(body, "secrets") === undefined) errors.add("secrets", "secrets must be true or false.");
      errors.throwIfAny();
      const previous = (await tx.maybe<PushRules>(
        "SELECT branch_name, commit_message, forbidden_files, required_files, secrets FROM push_rules WHERE project_id = $1",
        [project.id],
      )) ?? { ...EMPTY_PUSH_RULES };
      const unchanged =
        previous.branch_name === next.branch_name && previous.commit_message === next.commit_message && previous.secrets === next.secrets &&
        sameList(previous.forbidden_files, next.forbidden_files) && sameList(previous.required_files, next.required_files);
      if (!unchanged) {
        await tx.q(
          `INSERT INTO push_rules (project_id, branch_name, commit_message, forbidden_files, required_files, secrets) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (project_id) DO UPDATE SET branch_name = $2, commit_message = $3, forbidden_files = $4, required_files = $5, secrets = $6`,
          [project.id, next.branch_name, next.commit_message, next.forbidden_files, next.required_files, next.secrets],
        );
        await audit(tx, { projectId: project.id, actor, action: "push_rules.update", target: project.path, before: previous, after: next });
      }
      return json(200, { ...next, seq: await tx.currentSeq(project.id) });
    }),
  );

  router.post("/api/projects/:id/approval_rules", (ctx) =>
    withTx(async (tx) => {
      const { project, actor } = await lockedProject(tx, ctx, "settings");
      const rule = await readRule(tx, project, bodyOf(ctx.body), undefined);
      const created = await tx.one<{ id: number }>(
        "INSERT INTO approval_rules (project_id, name, required, users, groups) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [project.id, rule.name, rule.required, rule.users, rule.groups],
      );
      await audit(tx, { projectId: project.id, actor, action: "approval_rule.create", target: `${project.path}:${rule.name}`, before: null, after: ruleShape(rule) });
      await refreshRequests(tx, project);
      return json(201, { id: created.id, ...rule, seq: await tx.currentSeq(project.id) });
    }),
  );

  router.patch("/api/projects/:id/approval_rules/:rule", (ctx) =>
    withTx(async (tx) => {
      const { project, actor } = await lockedProject(tx, ctx, "settings");
      const current = await loadRule(tx, project, ctx);
      const rule = await readRule(tx, project, bodyOf(ctx.body), current);
      const changed = JSON.stringify(ruleShape(current)) !== JSON.stringify(ruleShape(rule));
      if (changed) {
        await tx.q("UPDATE approval_rules SET name = $2, required = $3, users = $4, groups = $5 WHERE id = $1", [current.id, rule.name, rule.required, rule.users, rule.groups]);
        await audit(tx, {
          projectId: project.id, actor, action: "approval_rule.update", target: `${project.path}:${rule.name}`,
          before: ruleShape(current), after: ruleShape(rule),
        });
        await refreshRequests(tx, project);
      }
      return json(200, { id: current.id, ...rule, seq: await tx.currentSeq(project.id) });
    }),
  );

  router.delete("/api/projects/:id/approval_rules/:rule", (ctx) =>
    withTx(async (tx) => {
      const { project, actor } = await lockedProject(tx, ctx, "settings");
      const current = await loadRule(tx, project, ctx);
      await tx.q("DELETE FROM approval_rules WHERE id = $1", [current.id]);
      await audit(tx, { projectId: project.id, actor, action: "approval_rule.delete", target: `${project.path}:${current.name}`, before: ruleShape(current), after: null });
      await refreshRequests(tx, project);
      return noContent();
    }),
  );

  router.put("/api/projects/:id/variables/:key", (ctx) =>
    withTx(async (tx) => {
      const { project, actor } = await lockedProject(tx, ctx, "settings");
      const key = ctx.params["key"] ?? "";
      const value = bodyOf(ctx.body)["value"];
      const errors = new FieldErrors();
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,254}$/.test(key)) errors.add("key", "Key must start with a letter or _ and use letters, digits and _.");
      if (typeof value !== "string") errors.add("value", "Value must be text.");
      errors.throwIfAny();
      if (typeof value !== "string") throw validationOne("value", "Value must be text.");
      const previous = await tx.maybe<{ value: string }>("SELECT value FROM project_variables WHERE project_id = $1 AND key = $2", [project.id, key]);
      if (previous?.value !== value) {
        await tx.q(
          `INSERT INTO project_variables (project_id, key, value) VALUES ($1, $2, $3) ON CONFLICT (project_id, key) DO UPDATE SET value = $3`,
          [project.id, key, value],
        );
        await audit(tx, {
          projectId: project.id, actor, action: "variable.set", target: `${project.path}:${key}`,
          before: previous === undefined ? null : { value: previous.value }, after: { value },
        });
      }
      return json(200, { key, value, seq: await tx.currentSeq(project.id) });
    }),
  );

  router.delete("/api/projects/:id/variables/:key", (ctx) =>
    withTx(async (tx) => {
      const { project, actor } = await lockedProject(tx, ctx, "settings");
      const key = ctx.params["key"] ?? "";
      const previous = await tx.maybe<{ value: string }>("DELETE FROM project_variables WHERE project_id = $1 AND key = $2 RETURNING value", [project.id, key]);
      if (previous === undefined) throw notFound();
      await audit(tx, { projectId: project.id, actor, action: "variable.remove", target: `${project.path}:${key}`, before: { value: previous.value }, after: null });
      return noContent();
    }),
  );

  router.put("/api/projects/:id/protected_environments/:name", (ctx) =>
    withTx(async (tx) => {
      const { project, actor } = await lockedProject(tx, ctx, "environment.manage");
      const name = required(ctx.params["name"], "Name can't be blank.");
      const body = bodyOf(ctx.body);
      const errors = new FieldErrors();
      const roles = roleField(body, "roles", errors);
      const approvals = whole(body, "approvals");
      if (approvals === undefined || approvals < 0 || approvals > 100) errors.add("approvals", "Approvals must be a whole number from 0 to 100.");
      errors.throwIfAny();
      const needed = approvals ?? 0;
      const previous = await tx.maybe<{ roles: Role; approvals: number }>(
        "SELECT roles, approvals FROM protected_environments WHERE project_id = $1 AND name = $2",
        [project.id, name],
      );
      if (previous === undefined || previous.roles !== roles || previous.approvals !== needed) {
        await tx.q(
          `INSERT INTO protected_environments (project_id, name, roles, approvals) VALUES ($1, $2, $3, $4)
           ON CONFLICT (project_id, name) DO UPDATE SET roles = $3, approvals = $4`,
          [project.id, name, roles, needed],
        );
        await audit(tx, {
          projectId: project.id, actor, action: "protected_environment.set", target: `${project.path}:${name}`,
          before: previous === undefined ? null : { roles: previous.roles, approvals: previous.approvals }, after: { roles, approvals: needed },
        });
      }
      return json(200, { name, roles, approvals: needed, seq: await tx.currentSeq(project.id) });
    }),
  );

  router.delete("/api/projects/:id/protected_environments/:name", (ctx) =>
    withTx(async (tx) => {
      const { project, actor } = await lockedProject(tx, ctx, "environment.manage");
      const name = ctx.params["name"] ?? "";
      const previous = await tx.maybe<{ roles: Role; approvals: number }>(
        "DELETE FROM protected_environments WHERE project_id = $1 AND name = $2 RETURNING roles, approvals",
        [project.id, name],
      );
      if (previous === undefined) throw notFound();
      await audit(tx, {
        projectId: project.id, actor, action: "protected_environment.remove", target: `${project.path}:${name}`,
        before: { roles: previous.roles, approvals: previous.approvals }, after: null,
      });
      return noContent();
    }),
  );
}

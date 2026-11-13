// Protected branches and tags: who may push, merge, delete and tag.
import type { Queryable } from "../db.ts";
import { ROLE_LEVEL, isRole, type Access, type ProjectRow } from "../access.ts";
import { ApiError, denied } from "../errors.ts";
import { patternMatches } from "./patterns.ts";

interface BranchRule {
  readonly pattern: string;
  readonly allowed_to_push: string;
  readonly allowed_to_merge: string;
}

function meets(access: Access, role: string): boolean {
  return isRole(role) && access.level >= ROLE_LEVEL[role];
}

async function matchingBranchRules(q: Queryable, projectId: number, branch: string): Promise<BranchRule[]> {
  const rules = await q.q<BranchRule>("SELECT pattern, allowed_to_push, allowed_to_merge FROM protected_branches WHERE project_id = $1", [projectId]);
  return rules.filter((rule) => patternMatches(rule.pattern, branch));
}

export async function isProtectedBranch(q: Queryable, projectId: number, name: string): Promise<boolean> {
  return (await matchingBranchRules(q, projectId, name)).length > 0;
}

/** Names among `names` that a protected-branch pattern covers. */
export async function protectedAmong(q: Queryable, projectId: number, names: readonly string[]): Promise<Set<string>> {
  const rules = await q.q<BranchRule>("SELECT pattern, allowed_to_push, allowed_to_merge FROM protected_branches WHERE project_id = $1", [projectId]);
  return new Set(names.filter((name) => rules.some((rule) => patternMatches(rule.pattern, name))));
}

const protectedBranch = (message: string): ApiError => denied("protected_branch", message);

/** 403 `protected_branch` unless the person may push to (or merge into) the branch. `access` null is the system. */
export async function assertMayUpdate(q: Queryable, project: ProjectRow, access: Access | null, branch: string, kind: "push" | "merge"): Promise<void> {
  if (access === null) return;
  const rules = await matchingBranchRules(q, project.id, branch);
  if (rules.length === 0) return;
  const allowed = rules.some((rule) =>
    kind === "merge" ? meets(access, rule.allowed_to_merge) : meets(access, rule.allowed_to_push) || access.permissions.has("push_protected"),
  );
  if (!allowed) throw protectedBranch(kind === "merge" ? `You can't merge into protected branch ${branch}.` : `You can't push to protected branch ${branch}.`);
}

export async function assertMayDelete(q: Queryable, projectId: number, branch: string): Promise<void> {
  if (await isProtectedBranch(q, projectId, branch)) throw protectedBranch(`You can't delete protected branch ${branch}.`);
}

/** 403 `protected_tag` unless the person may create the tag. `access` null is the seed. */
export async function assertMayTag(q: Queryable, project: ProjectRow, access: Access | null, tag: string): Promise<void> {
  if (access === null) return;
  const rules = (await q.q<{ pattern: string; allowed_to_create: string }>("SELECT pattern, allowed_to_create FROM protected_tags WHERE project_id = $1", [project.id]))
    .filter((rule) => patternMatches(rule.pattern, tag));
  if (rules.length > 0 && !rules.some((rule) => meets(access, rule.allowed_to_create))) {
    throw denied("protected_tag", `You can't create protected tag ${tag}.`);
  }
}

// What a request looks like right now: its approval rules, who approved, the owners problems and the ten merge checks.
import type { Queryable } from "../db.ts";
import { ROLE_LEVEL, isRole, projectAccess, type ProjectRow } from "../access.ts";
import { blockingFindingCount, latestPipelineOnCommit } from "../ci/index.ts";
import * as repo from "../repo/index.ts";
import { parseOwners, ownersForFiles, type SectionOwners } from "../lib/owners.ts";
import { buildChecks, type CheckResult } from "./checks.ts";
import { missingApprovals, ruleViews, type RuleSpec, type RuleView } from "./rules.ts";
import { isDraft, latestVersion, unresolvedThreadCount, usernameOf, type MrRow } from "./store.ts";

const OWNERS_PATH = ".spurline/OWNERS";

interface Approver {
  readonly id: number;
  readonly username: string;
}

export interface Evaluation {
  readonly sourceHead: string | null;
  readonly targetHead: string | null;
  readonly mergeBase: string | null;
  readonly checks: CheckResult[];
  readonly specs: RuleSpec[];
  readonly rules: RuleView[];
  readonly approvedBy: string[];
  readonly problems: string[];
  readonly author: string;
}

interface ProjectRuleRow {
  readonly name: string;
  readonly required: number;
  readonly users: string[];
  readonly groups: string[];
}

async function approversOf(q: Queryable, mrId: number): Promise<Approver[]> {
  return q.q<Approver>(
    "SELECT u.id, u.username FROM mr_approvals a JOIN users u ON u.id = a.user_id WHERE a.mr_id = $1 ORDER BY a.created_at, u.id",
    [mrId],
  );
}

/** Members of each group (direct or inherited from a parent group) with developer role or higher. */
async function developerMembers(q: Queryable, paths: readonly string[]): Promise<Map<string, Set<string>>> {
  const members = new Map<string, Set<string>>();
  if (paths.length === 0) return members;
  const rows = await q.q<{ group_path: string; username: string; role: string | null }>(
    `SELECT tg.path AS group_path, u.username, COALESCE(gm.role, cr.base) AS role
       FROM groups tg
       JOIN groups g ON tg.path = g.path OR tg.path LIKE g.path || '/%'
       JOIN group_members gm ON gm.group_id = g.id
       JOIN users u ON u.id = gm.user_id
       LEFT JOIN custom_roles cr ON cr.id = gm.custom_role_id
      WHERE tg.path = ANY($1)`,
    [paths],
  );
  for (const row of rows) {
    if (!isRole(row.role) || ROLE_LEVEL[row.role] < ROLE_LEVEL.developer) continue;
    const set = members.get(row.group_path) ?? new Set<string>();
    set.add(row.username);
    members.set(row.group_path, set);
  }
  return members;
}

async function ownersResolver(q: Queryable, text: string): Promise<(owner: string) => boolean> {
  const names = new Set<string>();
  for (const token of text.split(/\s+/u)) names.add(token.startsWith("@") ? token.slice(1) : token);
  const all = [...names].filter((name) => name !== "");
  const users = new Set((await q.q<{ username: string }>("SELECT username FROM users WHERE username = ANY($1)", [all.filter((n) => !n.includes("/"))])).map((r) => r.username));
  const groups = new Set((await q.q<{ path: string }>("SELECT path FROM groups WHERE path = ANY($1)", [all.filter((n) => n.includes("/"))])).map((r) => r.path));
  return (owner) => (owner.includes("/") ? groups.has(owner) : users.has(owner));
}

function eligibleSet(users: readonly string[], groups: readonly string[], members: ReadonlyMap<string, Set<string>>): Set<string> {
  const set = new Set(users);
  for (const group of groups) for (const name of members.get(group) ?? []) set.add(name);
  return set;
}

async function maintainersAndApprovers(q: Queryable, project: ProjectRow, people: readonly Approver[]): Promise<Set<string>> {
  const eligible = new Set<string>();
  for (const person of people) {
    const access = await projectAccess(q, person.id, project);
    if (access.member && (access.level >= ROLE_LEVEL.maintainer || access.permissions.has("approve"))) eligible.add(person.username);
  }
  return eligible;
}

interface RuleInputs {
  readonly targetHead: string | null;
  readonly sourceHead: string | null;
  readonly mergeBase: string | null;
}

interface RuleSet {
  readonly specs: RuleSpec[];
  readonly problems: string[];
}

/** Rule order: project rules in creation order, then owners sections in file order, then `Security review`. */
async function ruleSpecs(q: Queryable, project: ProjectRow, mr: MrRow, inputs: RuleInputs, people: readonly Approver[]): Promise<RuleSet> {
  const ownersText = inputs.targetHead === null ? null : await repo.readFile(q, project.id, inputs.targetHead, OWNERS_PATH);
  const parsed = ownersText === null ? { sections: [], problems: [] } : parseOwners(ownersText, await ownersResolver(q, ownersText));
  const problems = parsed.problems.map((problem) => `Line ${problem.line}: ${problem.reason}`);
  if (!(await repo.isProtectedBranch(q, project.id, mr.target))) return { specs: [], problems };

  const projectRules = await q.q<ProjectRuleRow>("SELECT name, required, users, groups FROM approval_rules WHERE project_id = $1 ORDER BY id", [project.id]);
  let sections: SectionOwners[] = [];
  if (parsed.sections.length > 0 && inputs.sourceHead !== null) {
    const changes = await repo.changedFiles(q, project.id, inputs.mergeBase, inputs.sourceHead);
    const files = changes.flatMap((change) => (change.oldPath === null ? [change.path] : [change.path, change.oldPath]));
    sections = ownersForFiles(parsed.sections, files);
  }
  const groupPaths = new Set<string>();
  for (const rule of projectRules) for (const group of rule.groups) groupPaths.add(group);
  for (const section of sections) for (const owner of section.owners) if (owner.includes("/")) groupPaths.add(owner);
  const members = await developerMembers(q, [...groupPaths]);

  const specs: RuleSpec[] = [];
  for (const rule of projectRules) {
    const eligible = eligibleSet(rule.users, rule.groups, members);
    specs.push({ name: rule.name, kind: "rule", required: rule.required, optional: false, eligible: (username) => eligible.has(username) });
  }
  for (const section of sections) {
    const eligible = eligibleSet(section.owners.filter((o) => !o.includes("/")), section.owners.filter((o) => o.includes("/")), members);
    specs.push({ name: section.name, kind: "owners", required: section.count, optional: section.optional, eligible: (username) => eligible.has(username) });
  }
  if ((await blockingFindingCount(q, project.id, mr.id)) > 0) {
    const eligible = await maintainersAndApprovers(q, project, people);
    specs.push({ name: "Security review", kind: "security", required: 1, optional: false, eligible: (username) => eligible.has(username) });
  }
  return { specs, problems };
}

/** Evaluates a request against the repository and the other modules. `candidate` is a person about to approve, so the
 *  security rule knows whether they qualify. */
export async function evaluateRequest(q: Queryable, project: ProjectRow, mr: MrRow, candidate?: Approver): Promise<Evaluation> {
  const merged = mr.state === "merged";
  const latest = await latestVersion(q, mr.id);
  const branchSource = merged ? null : await repo.branchHead(q, project.id, mr.source);
  const sourceHead = branchSource ?? latest?.head ?? null;
  const targetHead = await repo.branchHead(q, project.id, mr.target);
  const mergeBase = merged || sourceHead === null || targetHead === null
    ? (latest?.base ?? null)
    : await repo.mergeBase(q, project.id, targetHead, sourceHead);

  const approvers = await approversOf(q, mr.id);
  const people = candidate === undefined || approvers.some((a) => a.id === candidate.id) ? approvers : [...approvers, candidate];
  const author = await usernameOf(q, mr.author_id);
  const { specs, problems } = await ruleSpecs(q, project, mr, { targetHead, sourceHead, mergeBase }, people);
  const approvedBy = approvers.map((a) => a.username);
  const rules = ruleViews(specs, approvedBy, author);
  const missing = missingApprovals(rules);

  let behindTarget = false;
  let conflicts = false;
  if (!merged && targetHead !== null && sourceHead !== null) {
    behindTarget = !(await repo.isAncestor(q, project.id, targetHead, sourceHead));
    if (behindTarget && !(await repo.isAncestor(q, project.id, sourceHead, targetHead))) {
      conflicts = (await repo.conflictsFor(q, project.id, targetHead, sourceHead, { ours: mr.target, theirs: mr.source })).length > 0;
    }
  }
  const stack = merged
    ? undefined
    : await q.maybe<{ iid: number }>(
      "SELECT iid FROM merge_requests WHERE project_id = $1 AND state = 'opened' AND source = $2 AND id <> $3 ORDER BY iid LIMIT 1",
      [project.id, mr.target, mr.id],
    );
  const pipeline = sourceHead === null ? null : await latestPipelineOnCommit(q, project.id, sourceHead);

  const checks = buildChecks({
    closed: mr.state === "closed",
    target: mr.target,
    targetExists: merged || targetHead !== null,
    stackedOn: stack?.iid ?? null,
    draft: isDraft(mr.title),
    conflicts,
    mergeMethod: project.merge_method,
    behindTarget,
    unresolvedThreads: await unresolvedThreadCount(q, mr.id),
    missingApprovals: missing.count,
    missingRuleNames: missing.names,
    pipelinesMustSucceed: project.pipelines_must_succeed,
    pipeline: pipeline === null ? null : { id: pipeline.id, status: pipeline.status },
    sourceShort: (sourceHead ?? "").slice(0, 7),
    blockingFindings: merged ? 0 : await blockingFindingCount(q, project.id, mr.id),
  });
  return { sourceHead, targetHead, mergeBase, checks, specs, rules, approvedBy, problems, author };
}

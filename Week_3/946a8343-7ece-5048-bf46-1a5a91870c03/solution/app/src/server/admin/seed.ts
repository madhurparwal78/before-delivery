// Seed orchestration (DP-09): one transaction creates users, groups, projects and everything in them, in the fixed order
// the modules need. Seeding bypasses protection, push rules, approvals and rate limits, and writes no live messages
// and no audit events. A bad reference or value is a 422 and nothing is written.
import { now } from "../clock.ts";
import type { Tx } from "../db.ts";
import type { GroupRow, ProjectRow, Role } from "../access.ts";
import { hashPassword } from "../auth.ts";
import { ApiError, validation, validationOne } from "../errors.ts";
import { isTimeZone } from "../../shared/zone.ts";
import { branchHead, commitToBranch, createTag, resolveRef } from "../repo/index.ts";
import { seedEpics, seedGroupLabels, seedProjectPlanning } from "../planning/index.ts";
import { seedMergeRequests } from "../mr/index.ts";
import { seedPipelines, seedProtectedEnvironments } from "../ci/index.ts";
import { seedTrains } from "../train/index.ts";
import type {
  MergeRequestSeedResult,
  PipelineSeedResult,
  PlanningSeedResult,
  SeedCommit,
  SeedCustomRole,
  SeedEpic,
  SeedGroup,
  SeedGroupLabel,
  SeedKeys,
  SeedMember,
  SeedProject,
  SeedRequest,
  SeedUser,
  TrainSeedResult,
} from "./seed-spec.ts";
import { createGroupRow } from "./groups.ts";
import { createProjectRow, protectDefaultBranch } from "./projects.ts";
import { groupPathProblem, isSegment, parentPath, SEGMENT_MESSAGE } from "./rules.ts";

const USERNAME = /^[a-z0-9_]{3,24}$/;

const fail = (field: string, message: string): never => {
  throw validationOne(field, message);
};

interface Seeded {
  users: Record<string, { id: number }>;
  groups: Record<string, { id: number; path: string }>;
  custom_roles: Record<string, { id: number }>;
  epics: Record<string, { id: number; iid: number }>;
  projects: Record<string, Record<string, unknown>>;
}

interface State {
  readonly tx: Tx;
  readonly userIds: Map<string, number>;
  readonly groups: Map<string, GroupRow>;
  readonly customRoles: Map<string, number>;
  readonly projectIds: Map<string, number>;
  readonly issueIds: SeedKeys["issueIds"];
}

async function userId(state: State, username: string, field: string): Promise<number> {
  const known = state.userIds.get(username);
  if (known !== undefined) return known;
  const found = await state.tx.maybe<{ id: number }>("SELECT id FROM users WHERE username = $1", [username]);
  if (found === undefined) return fail(field, `Unknown user ${username}.`);
  state.userIds.set(username, found.id);
  return found.id;
}

async function groupAt(state: State, path: string, field: string): Promise<GroupRow> {
  const known = state.groups.get(path);
  if (known !== undefined) return known;
  const found = await state.tx.maybe<GroupRow>("SELECT * FROM groups WHERE path = $1", [path]);
  if (found === undefined) return fail(field, `Unknown group ${path}.`);
  state.groups.set(path, found);
  return found;
}

// Every username the request names, so the modules can resolve people through `keys.userIds`.
function mentionedUsers(request: SeedRequest): Set<string> {
  const names = new Set<string>();
  for (const group of request.groups ?? []) for (const member of group.members ?? []) names.add(member.username);
  for (const epic of request.epics ?? []) names.add(epic.author);
  for (const project of request.projects ?? []) {
    for (const member of project.members ?? []) names.add(member.username);
    for (const commit of project.commits ?? []) names.add(commit.as);
    for (const tag of project.tags ?? []) names.add(tag.as);
    for (const issue of project.issues ?? []) {
      names.add(issue.author);
      for (const assignee of issue.assignees) names.add(assignee);
    }
    for (const mergeRequest of project.merge_requests ?? []) {
      names.add(mergeRequest.author);
      for (const name of [...mergeRequest.assignees, ...mergeRequest.reviewers, ...mergeRequest.approvals]) names.add(name);
      for (const thread of mergeRequest.threads) names.add(thread.author);
    }
    for (const page of project.wiki ?? []) names.add(page.author);
    for (const rule of project.approval_rules ?? []) for (const name of rule.users) names.add(name);
  }
  return names;
}

async function seedUsers(state: State, specs: SeedUser[], response: Seeded): Promise<void> {
  const hashes = await Promise.all(specs.map((spec) => hashPassword(spec.password)));
  for (const [index, spec] of specs.entries()) {
    const where = `users.${index}`;
    const username = spec.username;
    if (!USERNAME.test(username)) fail(`${where}.username`, "Username must be 3 to 24 characters: a-z, 0-9 and _.");
    if (spec.time_zone !== undefined && !isTimeZone(spec.time_zone)) fail(`${where}.time_zone`, `Unknown time zone ${spec.time_zone}.`);
    if (state.userIds.has(username) || (await state.tx.maybe("SELECT 1 FROM users WHERE username = $1", [username])) !== undefined) {
      fail(`${where}.username`, "That username is taken.");
    }
    const created = await state.tx.one<{ id: number }>(
      "INSERT INTO users (username, password, time_zone, created_at) VALUES ($1, $2, $3, $4) RETURNING id",
      [username, hashes[index] ?? null, spec.time_zone ?? "UTC", now()],
    );
    state.userIds.set(username, created.id);
    response.users[username] = { id: created.id };
  }
}

async function seedGroups(state: State, specs: SeedGroup[], response: Seeded): Promise<void> {
  for (const [index, spec] of specs.entries()) {
    const where = `groups.${index}`;
    const { key, path } = spec;
    const problem = groupPathProblem(path);
    if (problem !== null) fail(`${where}.path`, problem);
    const parent = parentPath(path);
    if (parent !== null) await groupAt(state, parent, `${where}.path`);
    if (state.groups.has(path) || (await state.tx.maybe("SELECT 1 FROM groups WHERE path = $1", [path])) !== undefined) {
      fail(`${where}.path`, "That path is taken.");
    }
    const parentRow = parent === null ? undefined : state.groups.get(parent);
    const row = await createGroupRow(state.tx, {
      path,
      name: path.slice(path.lastIndexOf("/") + 1),
      parentId: parentRow?.id ?? null,
      visibility: spec.visibility,
    });
    state.groups.set(path, row);
    response.groups[key] = { id: row.id, path };
  }
}

async function seedCustomRoles(state: State, specs: SeedCustomRole[], response: Seeded): Promise<void> {
  for (const [index, spec] of specs.entries()) {
    const where = `custom_roles.${index}`;
    const group = await groupAt(state, spec.group, `${where}.group`);
    const created = await state.tx.one<{ id: number }>(
      "INSERT INTO custom_roles (group_id, name, base, permissions) VALUES ($1, $2, $3, $4) RETURNING id",
      [group.id, spec.name, spec.base, spec.permissions],
    );
    state.customRoles.set(spec.key, created.id);
    response.custom_roles[spec.key] = { id: created.id };
  }
}

async function memberRows(
  state: State,
  members: readonly SeedMember[] | undefined,
  where: string,
  insert: (userId: number, role: Role | null, customRoleId: number | null) => Promise<void>,
): Promise<void> {
  const seen = new Set<string>();
  for (const [index, member] of (members ?? []).entries()) {
    const at = `${where}.members.${index}`;
    const id = await userId(state, member.username, `${at}.username`);
    if (seen.has(member.username)) fail(`${at}.username`, "That person is already a member.");
    seen.add(member.username);
    if ((member.role === undefined) === (member.custom_role === undefined)) fail(`${at}.role`, "A member has either role or custom_role.");
    if (member.role !== undefined) {
      await insert(id, member.role, null);
    } else {
      const customId = member.custom_role === undefined ? undefined : state.customRoles.get(member.custom_role);
      if (customId === undefined) fail(`${at}.custom_role`, `Unknown custom role ${member.custom_role ?? ""}.`);
      await insert(id, null, customId ?? null);
    }
  }
}

async function seedGroupMembers(state: State, specs: SeedGroup[]): Promise<void> {
  for (const [index, spec] of specs.entries()) {
    const group = await groupAt(state, spec.path, `groups.${index}.path`);
    await memberRows(state, spec.members, `groups.${index}`, async (id, role, customRoleId) => {
      await state.tx.q("INSERT INTO group_members (group_id, user_id, role, custom_role_id) VALUES ($1, $2, $3, $4)", [group.id, id, role, customRoleId]);
    });
  }
}

async function seedLabelsOfGroups(state: State, specs: SeedGroupLabel[]): Promise<void> {
  const byGroup = new Map<number, Array<{ name: string; description: string }>>();
  for (const [index, spec] of specs.entries()) {
    const group = await groupAt(state, spec.group, `group_labels.${index}.group`);
    byGroup.set(group.id, [...(byGroup.get(group.id) ?? []), { name: spec.name, description: spec.description }]);
  }
  for (const [groupId, labels] of byGroup) await seedGroupLabels(state.tx, groupId, labels);
}

async function seedCommits(state: State, project: ProjectRow, keys: SeedKeys, specs: SeedCommit[], where: string): Promise<void> {
  for (const [index, spec] of specs.entries()) {
    const at = `${where}.commits.${index}`;
    const { key, branch } = spec;
    const actorId = await userId(state, spec.as, `${at}.as`);
    const head = await branchHead(state.tx, project.id, branch);
    const given = spec.start_ref === "" ? null : spec.start_ref;
    const startRef = given === null ? null : (keys.commitIds.get(given) ?? given);
    if (head === null && startRef === null && (await state.tx.maybe("SELECT 1 FROM refs WHERE project_id = $1 AND kind = 'branch'", [project.id])) !== undefined) {
      fail(`${at}.start_ref`, "A new branch needs a start_ref.");
    }
    const parent = head ?? (startRef === null ? null : await resolveRef(state.tx, project.id, startRef));
    if (head === null && startRef !== null && parent === null) fail(`${at}.start_ref`, `Unknown ref ${given ?? ""}.`);
    try {
      const done = await commitToBranch(state.tx, {
        project,
        access: null,
        actor: { id: actorId, username: spec.as },
        branch,
        startRef: head === null ? startRef : null,
        baseCommit: parent,
        message: spec.message,
        actions: spec.actions,
        source: "seed",
        authoredAt: spec.timestamp,
      });
      keys.commitIds.set(key, done.commit);
    } catch (error) {
      if (error instanceof ApiError) throw validation({ [`${at}`]: error.message });
      throw error;
    }
  }
}

async function seedProject(state: State, spec: SeedProject, index: number, response: Seeded): Promise<void> {
  const where = `projects.${index}`;
  const { tx } = state;
  const { key, slug } = spec;
  const branch = spec.default_branch;
  const group = await groupAt(state, spec.group, `${where}.group`);
  if (!isSegment(slug)) fail(`${where}.slug`, SEGMENT_MESSAGE);
  const path = `${group.path}/${slug}`;
  if ((await tx.maybe("SELECT 1 FROM projects WHERE path = $1", [path])) !== undefined) fail(`${where}.slug`, "That path is taken.");

  const created = await createProjectRow(tx, {
    groupId: group.id, slug, path, visibility: spec.visibility, defaultBranch: branch, settings: spec.settings,
  });
  state.projectIds.set(key, created.id);
  const keys: SeedKeys = { userIds: state.userIds, commitIds: new Map(), issueIds: new Map(), mergeRequestIds: new Map() };

  await memberRows(state, spec.members, where, async (id, role, customRoleId) => {
    await tx.q("INSERT INTO project_members (project_id, user_id, role, custom_role_id) VALUES ($1, $2, $3, $4)", [created.id, id, role, customRoleId]);
  });

  if (spec.protected_branches === undefined) await protectDefaultBranch(tx, created.id, branch);
  for (const rule of spec.protected_branches ?? []) {
    await tx.q("INSERT INTO protected_branches (project_id, pattern, allowed_to_push, allowed_to_merge) VALUES ($1, $2, $3, $4)", [
      created.id, rule.name, rule.allowed_to_push, rule.allowed_to_merge,
    ]);
  }
  for (const rule of spec.protected_tags ?? []) {
    await tx.q("INSERT INTO protected_tags (project_id, pattern, allowed_to_create) VALUES ($1, $2, $3)", [created.id, rule.name, rule.allowed_to_create]);
  }
  for (const rule of spec.approval_rules ?? []) {
    await tx.q("INSERT INTO approval_rules (project_id, name, required, users, groups) VALUES ($1, $2, $3, $4, $5)", [
      created.id, rule.name, rule.required, rule.users, rule.groups,
    ]);
  }
  for (const [name, value] of Object.entries(spec.variables ?? {})) {
    await tx.q("INSERT INTO project_variables (project_id, key, value) VALUES ($1, $2, $3)", [created.id, name, value]);
  }

  const row = (): Promise<ProjectRow> => tx.one<ProjectRow>("SELECT * FROM projects WHERE id = $1", [created.id]);
  await seedCommits(state, await row(), keys, spec.commits ?? [], where);
  for (const [i, tag] of (spec.tags ?? []).entries()) {
    const at = `${where}.tags.${i}`;
    const target = tag.commit;
    const commit = keys.commitIds.get(target) ?? (await resolveRef(tx, created.id, target));
    if (commit === null) fail(`${at}.commit`, `Unknown commit ${target}.`);
    await createTag(tx, {
      project: await row(),
      access: null,
      name: tag.name,
      commit: commit ?? "",
      message: tag.message,
      creator: { id: await userId(state, tag.as, `${at}.as`), username: tag.as },
    });
  }

  const labels = spec.labels ?? [];
  const milestones = spec.milestones ?? [];
  const issues = spec.issues ?? [];
  const boards = spec.boards ?? [];
  const wiki = spec.wiki ?? [];
  const planning: PlanningSeedResult =
    labels.length + milestones.length + issues.length + boards.length + wiki.length === 0
      ? { milestones: {}, labels: {}, issues: {}, boards: {}, wiki: {} }
      : await seedProjectPlanning(tx, await row(), keys, { labels, milestones, issues, boards, wiki });
  for (const [issueKey, ids] of Object.entries(planning.issues)) state.issueIds.set(`${key}/${issueKey}`, ids);

  const requests = spec.merge_requests ?? [];
  const merged: MergeRequestSeedResult = requests.length === 0 ? { merge_requests: {}, threads: {} } : await seedMergeRequests(tx, await row(), keys, requests);
  const listed = spec.pipelines ?? [];
  const pipelines: PipelineSeedResult = listed.length === 0 ? { pipelines: {}, environments: {} } : await seedPipelines(tx, await row(), keys, listed);
  const protectedEnvironments = spec.protected_environments ?? [];
  const guarded: PipelineSeedResult["environments"] = protectedEnvironments.length === 0 ? {} : await seedProtectedEnvironments(tx, await row(), protectedEnvironments);
  const cars = spec.train ?? [];
  const trains: TrainSeedResult = cars.length === 0 ? { train: {} } : await seedTrains(tx, await row(), keys, cars);

  if (spec.push_rules !== undefined) {
    const rules = spec.push_rules;
    await tx.q("UPDATE push_rules SET branch_name = $2, commit_message = $3, forbidden_files = $4, required_files = $5, secrets = $6 WHERE project_id = $1", [
      created.id,
      rules.branch_name,
      rules.commit_message,
      rules.forbidden_files,
      rules.required_files,
      rules.secrets,
    ]);
  }

  const webhooks: Record<string, { id: number }> = {};
  for (const hook of spec.webhooks ?? []) {
    const made = await tx.one<{ id: number }>("INSERT INTO webhooks (project_id, url, secret, events, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id", [
      created.id, hook.url, hook.secret, hook.events, now(),
    ]);
    webhooks[hook.key] = { id: made.id };
  }

  response.projects[key] = {
    id: created.id,
    path,
    commits: Object.fromEntries(keys.commitIds),
    merge_requests: merged.merge_requests,
    threads: merged.threads,
    issues: planning.issues,
    milestones: planning.milestones,
    labels: planning.labels,
    pipelines: pipelines.pipelines,
    train: trains.train,
    boards: planning.boards,
    environments: { ...pipelines.environments, ...guarded },
    wiki: planning.wiki,
    webhooks,
    seq: (await row()).seq,
  };
}

async function seedAllEpics(state: State, specs: SeedEpic[], response: Seeded): Promise<void> {
  const byGroup = new Map<number, SeedEpic[]>();
  for (const [index, spec] of specs.entries()) {
    const group = await groupAt(state, spec.group, `epics.${index}.group`);
    byGroup.set(group.id, [...(byGroup.get(group.id) ?? []), spec]);
  }
  const keys: SeedKeys = { userIds: state.userIds, commitIds: new Map(), issueIds: state.issueIds, mergeRequestIds: new Map() };
  for (const [groupId, epics] of byGroup) Object.assign(response.epics, await seedEpics(state.tx, groupId, keys, state.projectIds, epics));
}

export async function runSeed(tx: Tx, request: SeedRequest): Promise<Seeded> {
  const response: Seeded = { users: {}, groups: {}, custom_roles: {}, epics: {}, projects: {} };
  const state: State = {
    tx,
    userIds: new Map(),
    groups: new Map(),
    customRoles: new Map(),
    projectIds: new Map(),
    issueIds: new Map(),
  };
  const groups = request.groups ?? [];
  await seedUsers(state, request.users ?? [], response);
  const names = [...mentionedUsers(request)].filter((name) => !state.userIds.has(name));
  if (names.length > 0) {
    for (const row of await tx.q<{ id: number; username: string }>("SELECT id, username FROM users WHERE username = ANY($1)", [names])) {
      state.userIds.set(row.username, row.id);
    }
  }
  await seedGroups(state, groups, response);
  await seedCustomRoles(state, request.custom_roles ?? [], response);
  await seedGroupMembers(state, groups);
  await seedLabelsOfGroups(state, request.group_labels ?? []);
  for (const [index, project] of (request.projects ?? []).entries()) await seedProject(state, project, index, response);
  await seedAllEpics(state, request.epics ?? [], response);
  return response;
}


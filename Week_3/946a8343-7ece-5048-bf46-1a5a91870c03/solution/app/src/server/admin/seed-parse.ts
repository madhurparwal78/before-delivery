// Reads the body of `POST /api/grading/seed` into the declared shapes; anything else is a 422 naming the field.
import { PERMISSIONS, ROLES } from "../access.ts";
import { FLAG_SETTINGS, MERGE_METHODS, VISIBILITIES, type ProjectSettings } from "../../shared/settings.ts";
import { Fields, type Parse } from "./fields.ts";
import { WEBHOOK_EVENTS } from "./rules.ts";
import type {
  SeedApprovalRule, SeedBoard, SeedCommit, SeedCustomRole, SeedEpic, SeedFileAction, SeedGroup, SeedGroupLabel, SeedIssue, SeedLabel,
  SeedMember, SeedMergeRequest, SeedMilestone, SeedPipeline, SeedProject, SeedProtectedBranch, SeedProtectedEnvironment, SeedProtectedTag,
  SeedPushRules, SeedRequest, SeedTag, SeedThread, SeedTrain, SeedUser, SeedWebhook, SeedWikiPage,
} from "./seed-spec.ts";

const FILE_ACTIONS = ["create", "update", "delete", "move"] as const;
const ISSUE_STATES = ["opened", "closed"] as const;
const REQUEST_STATES = ["opened", "closed", "merged"] as const;
const BOARD_KINDS = ["label", "assignee", "milestone"] as const;

const user: Parse<SeedUser> = (value, at) => {
  const f = new Fields(value, at);
  return { username: f.name("username"), password: f.name("password"), time_zone: f.maybeText("time_zone") };
};

const member: Parse<SeedMember> = (value, at) => {
  const f = new Fields(value, at);
  return { username: f.name("username"), role: f.maybeChoice("role", ROLES), custom_role: f.maybeText("custom_role") };
};

const group: Parse<SeedGroup> = (value, at) => {
  const f = new Fields(value, at);
  return { key: f.name("key"), path: f.name("path"), visibility: f.choice("visibility", VISIBILITIES), members: f.maybeEach("members", member) };
};

const customRole: Parse<SeedCustomRole> = (value, at) => {
  const f = new Fields(value, at);
  return { key: f.name("key"), group: f.name("group"), name: f.name("name"), base: f.choice("base", ROLES), permissions: f.choices("permissions", PERMISSIONS) };
};

const groupLabel: Parse<SeedGroupLabel> = (value, at) => {
  const f = new Fields(value, at);
  return { group: f.name("group"), name: f.name("name"), description: f.text("description") };
};

const epic: Parse<SeedEpic> = (value, at) => {
  const f = new Fields(value, at);
  return { key: f.name("key"), group: f.name("group"), title: f.name("title"), parent: f.nullableText("parent"), author: f.name("author"), issues: f.names("issues") };
};

const settings: Parse<Partial<ProjectSettings>> = (value, at) => {
  const f = new Fields(value, at);
  const read: Partial<ProjectSettings> = {};
  const method = f.maybeChoice("merge_method", MERGE_METHODS);
  if (method !== undefined) read.merge_method = method;
  for (const key of FLAG_SETTINGS) {
    const flag = f.maybeFlag(key);
    if (flag !== undefined) read[key] = flag;
  }
  return read;
};

const protectedBranch: Parse<SeedProtectedBranch> = (value, at) => {
  const f = new Fields(value, at);
  return { name: f.name("name"), allowed_to_push: f.choice("allowed_to_push", ROLES), allowed_to_merge: f.choice("allowed_to_merge", ROLES) };
};

const protectedTag: Parse<SeedProtectedTag> = (value, at) => {
  const f = new Fields(value, at);
  return { name: f.name("name"), allowed_to_create: f.choice("allowed_to_create", ROLES) };
};

const pushRules: Parse<SeedPushRules> = (value, at) => {
  const f = new Fields(value, at);
  return {
    branch_name: f.nullableText("branch_name"), commit_message: f.nullableText("commit_message"),
    forbidden_files: f.names("forbidden_files"), required_files: f.names("required_files"), secrets: f.flag("secrets"),
  };
};

const approvalRule: Parse<SeedApprovalRule> = (value, at) => {
  const f = new Fields(value, at);
  return { name: f.name("name"), required: f.count("required"), users: f.names("users"), groups: f.names("groups") };
};

const protectedEnvironment: Parse<SeedProtectedEnvironment> = (value, at) => {
  const f = new Fields(value, at);
  return { name: f.name("name"), roles: f.choice("roles", ROLES), approvals: f.count("approvals") };
};

const fileAction: Parse<SeedFileAction> = (value, at) => {
  const f = new Fields(value, at);
  return { action: f.choice("action", FILE_ACTIONS), path: f.name("path"), content: f.maybeText("content"), previous_path: f.maybeText("previous_path") };
};

const commit: Parse<SeedCommit> = (value, at) => {
  const f = new Fields(value, at);
  return {
    key: f.name("key"), branch: f.name("branch"), start_ref: f.nullableText("start_ref"), as: f.name("as"), timestamp: f.count("timestamp"),
    message: f.text("message"), actions: f.each("actions", fileAction),
  };
};

const tag: Parse<SeedTag> = (value, at) => {
  const f = new Fields(value, at);
  return { name: f.name("name"), commit: f.name("commit"), message: f.text("message"), as: f.name("as") };
};

const label: Parse<SeedLabel> = (value, at) => {
  const f = new Fields(value, at);
  return { name: f.name("name"), description: f.text("description") };
};

const milestone: Parse<SeedMilestone> = (value, at) => {
  const f = new Fields(value, at);
  return { key: f.name("key"), title: f.name("title"), start: f.name("start"), due: f.name("due"), time_zone: f.name("time_zone") };
};

const issue: Parse<SeedIssue> = (value, at) => {
  const f = new Fields(value, at);
  return {
    key: f.name("key"), title: f.name("title"), author: f.name("author"), description: f.text("description"), labels: f.names("labels"),
    assignees: f.names("assignees"), milestone: f.nullableText("milestone"), weight: f.nullableInt("weight"), confidential: f.flag("confidential"),
    state: f.maybeChoice("state", ISSUE_STATES) ?? "opened",
  };
};

const thread: Parse<SeedThread> = (value, at) => {
  const f = new Fields(value, at);
  return {
    key: f.name("key"), author: f.name("author"), body: f.text("body"), path: f.nullableText("path"), old_line: f.nullableInt("old_line"),
    new_line: f.nullableInt("new_line"), end_line: f.nullableInt("end_line"), resolved: f.flag("resolved"),
  };
};

const mergeRequest: Parse<SeedMergeRequest> = (value, at) => {
  const f = new Fields(value, at);
  return {
    key: f.name("key"), title: f.name("title"), source: f.name("source"), target: f.name("target"), author: f.name("author"),
    description: f.text("description"), assignees: f.names("assignees"), reviewers: f.names("reviewers"),
    delete_source_branch: f.flag("delete_source_branch"), state: f.maybeChoice("state", REQUEST_STATES) ?? "opened",
    approvals: f.names("approvals"), threads: f.each("threads", thread),
  };
};

const pipeline: Parse<SeedPipeline> = (value, at) => {
  const f = new Fields(value, at);
  return { key: f.name("key"), ref: f.name("ref"), commit: f.name("commit"), jobs: f.textMap("jobs") ?? {} };
};

const train: Parse<SeedTrain> = (value, at) => {
  const f = new Fields(value, at);
  return { target: f.name("target"), requests: f.names("requests") };
};

const board: Parse<SeedBoard> = (value, at) => {
  const f = new Fields(value, at);
  return { key: f.name("key"), name: f.name("name"), kind: f.choice("kind", BOARD_KINDS), lists: f.names("lists") };
};

const wikiPage: Parse<SeedWikiPage> = (value, at) => {
  const f = new Fields(value, at);
  return { slug: f.name("slug"), title: f.name("title"), content: f.text("content"), author: f.name("author") };
};

const webhook: Parse<SeedWebhook> = (value, at) => {
  const f = new Fields(value, at);
  return { key: f.name("key"), url: f.name("url"), secret: f.name("secret"), events: f.choices("events", WEBHOOK_EVENTS) };
};

const project: Parse<SeedProject> = (value, at) => {
  const f = new Fields(value, at);
  return {
    key: f.name("key"), group: f.name("group"), slug: f.name("slug"), visibility: f.choice("visibility", VISIBILITIES),
    default_branch: f.name("default_branch"), members: f.maybeEach("members", member), settings: f.maybeOne("settings", settings),
    protected_branches: f.maybeEach("protected_branches", protectedBranch), protected_tags: f.maybeEach("protected_tags", protectedTag),
    push_rules: f.maybeOne("push_rules", pushRules), approval_rules: f.maybeEach("approval_rules", approvalRule),
    protected_environments: f.maybeEach("protected_environments", protectedEnvironment), variables: f.textMap("variables"),
    commits: f.maybeEach("commits", commit), tags: f.maybeEach("tags", tag), labels: f.maybeEach("labels", label),
    milestones: f.maybeEach("milestones", milestone), issues: f.maybeEach("issues", issue), merge_requests: f.maybeEach("merge_requests", mergeRequest),
    pipelines: f.maybeEach("pipelines", pipeline), train: f.maybeEach("train", train), boards: f.maybeEach("boards", board),
    wiki: f.maybeEach("wiki", wikiPage), webhooks: f.maybeEach("webhooks", webhook),
  };
};

export const parseSeed: Parse<SeedRequest> = (value, at) => {
  const f = new Fields(value, at);
  return {
    users: f.maybeEach("users", user), groups: f.maybeEach("groups", group), custom_roles: f.maybeEach("custom_roles", customRole),
    group_labels: f.maybeEach("group_labels", groupLabel), epics: f.maybeEach("epics", epic), projects: f.maybeEach("projects", project),
  };
};

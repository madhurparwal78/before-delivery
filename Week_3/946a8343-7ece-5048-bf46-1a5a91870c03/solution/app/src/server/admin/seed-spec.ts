// The shape of `POST /api/grading/seed` (from the brief's API section). Modules implement the `seed*` functions for their
// own sections; the admin module orchestrates them in one transaction.
import type { Role, Visibility, Permission } from "../access.ts";
import type { ProjectSettings } from "../../shared/settings.ts";

export interface SeedUser { username: string; password: string; time_zone?: string }
export interface SeedMember { username: string; role?: Role; custom_role?: string }
export interface SeedGroup { key: string; path: string; visibility: Visibility; members?: SeedMember[] }
export interface SeedCustomRole { key: string; group: string; name: string; base: Role; permissions: Permission[] }
export interface SeedGroupLabel { group: string; name: string; description: string }
export interface SeedEpic { key: string; group: string; title: string; parent: string | null; author: string; issues: string[] }

export interface SeedFileAction { action: "create" | "update" | "delete" | "move"; path: string; content?: string; previous_path?: string }
export interface SeedCommit {
  key: string;
  branch: string;
  start_ref: string | null;
  as: string;
  timestamp: number;
  message: string;
  actions: SeedFileAction[];
}
export interface SeedTag { name: string; commit: string; message: string; as: string }
export interface SeedLabel { name: string; description: string }
export interface SeedMilestone { key: string; title: string; start: string; due: string; time_zone: string }
export interface SeedIssue {
  key: string;
  title: string;
  author: string;
  description: string;
  labels: string[];
  assignees: string[];
  milestone: string | null;
  weight: number | null;
  confidential: boolean;
  state: "opened" | "closed";
}
export interface SeedThread {
  key: string;
  author: string;
  body: string;
  path: string | null;
  old_line: number | null;
  new_line: number | null;
  end_line: number | null;
  resolved: boolean;
}
export interface SeedMergeRequest {
  key: string;
  title: string;
  source: string;
  target: string;
  author: string;
  description: string;
  assignees: string[];
  reviewers: string[];
  delete_source_branch: boolean;
  state: "opened" | "closed" | "merged";
  approvals: string[];
  threads: SeedThread[];
}
export interface SeedPipeline { key: string; ref: string; commit: string; jobs: Record<string, string> }
export interface SeedTrain { target: string; requests: string[] }
export interface SeedBoard { key: string; name: string; kind: "label" | "assignee" | "milestone"; lists: string[] }
export interface SeedWikiPage { slug: string; title: string; content: string; author: string }
export interface SeedWebhook { key: string; url: string; secret: string; events: string[] }
export interface SeedPushRules {
  branch_name: string | null;
  commit_message: string | null;
  forbidden_files: string[];
  required_files: string[];
  secrets: boolean;
}
export interface SeedApprovalRule { name: string; required: number; users: string[]; groups: string[] }
export interface SeedProtectedBranch { name: string; allowed_to_push: Role; allowed_to_merge: Role }
export interface SeedProtectedTag { name: string; allowed_to_create: Role }
export interface SeedProtectedEnvironment { name: string; roles: Role; approvals: number }

export interface SeedProject {
  key: string;
  group: string;
  slug: string;
  visibility: Visibility;
  default_branch: string;
  members?: SeedMember[];
  settings?: Partial<ProjectSettings>;
  protected_branches?: SeedProtectedBranch[];
  protected_tags?: SeedProtectedTag[];
  push_rules?: SeedPushRules;
  approval_rules?: SeedApprovalRule[];
  protected_environments?: SeedProtectedEnvironment[];
  variables?: Record<string, string>;
  commits?: SeedCommit[];
  tags?: SeedTag[];
  labels?: SeedLabel[];
  milestones?: SeedMilestone[];
  issues?: SeedIssue[];
  merge_requests?: SeedMergeRequest[];
  pipelines?: SeedPipeline[];
  train?: SeedTrain[];
  boards?: SeedBoard[];
  wiki?: SeedWikiPage[];
  webhooks?: SeedWebhook[];
}

export interface SeedRequest {
  users?: SeedUser[];
  groups?: SeedGroup[];
  custom_roles?: SeedCustomRole[];
  group_labels?: SeedGroupLabel[];
  epics?: SeedEpic[];
  projects?: SeedProject[];
}

// What the seed knows while it runs: keys to ids, filled section by section.
export interface SeedKeys {
  readonly userIds: Map<string, number>;
  readonly commitIds: Map<string, string>;
  readonly issueIds: Map<string, { id: number; iid: number }>;
  readonly mergeRequestIds: Map<string, { id: number; iid: number }>;
}

interface SeedIds { readonly id: number; readonly iid: number }

// What each module returns for its sections; the admin module merges them into the response.
export interface PlanningSeedResult {
  readonly milestones: Record<string, { id: number }>;
  readonly labels: Record<string, { id: number }>;
  readonly issues: Record<string, SeedIds>;
  readonly boards: Record<string, { id: number; lists: Record<string, number> }>;
  readonly wiki: Record<string, { version: number }>;
}

export interface MergeRequestSeedResult {
  readonly merge_requests: Record<string, SeedIds>;
  readonly threads: Record<string, { id: number }>;
}

export interface PipelineSeedResult {
  readonly pipelines: Record<string, { id: number; jobs: Record<string, number> }>;
  readonly environments: Record<string, { id: number }>;
}

export interface TrainSeedResult {
  readonly train: Record<string, { position: number; sha: string; pipeline_id: number | null }>;
}

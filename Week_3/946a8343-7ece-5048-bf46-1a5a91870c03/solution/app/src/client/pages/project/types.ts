// Response shapes of the project shell and administration pages (see PLAN.md "API additions" and the admin routes).

export interface Tag {
  name: string;
  commit: string;
  message: string;
}

export interface LatestPipeline {
  id: number;
  status: string;
  sha: string;
  ref: string;
}

export interface Overview {
  open_merge_requests: number;
  pipelines_passed: number | null;
  open_issues: number;
  latest_tag: Tag | null;
  latest_pipeline: LatestPipeline | null;
  tags: Tag[];
}

export type ActivityKind = "push" | "merge_request" | "issue" | "pipeline";

export interface ActivityEvent {
  kind: ActivityKind;
  title: string;
  detail: string;
  at: string;
  href: string;
}

export interface ActivityList {
  events: ActivityEvent[];
}

export interface ProjectInfo {
  id: number;
  path: string;
  name: string;
  visibility: string;
  default_branch: string;
  group: { id: number; path: string };
}

export interface Member {
  username: string;
  role: string | null;
  custom_role: string | null;
  effective_role: string | null;
}

export interface CustomRole {
  id: number;
  name: string;
  base: string;
  permissions: string[];
}

export interface GroupRef {
  id: number;
  path: string;
  name: string;
  visibility?: string;
}

export interface GroupView {
  id: number;
  path: string;
  name: string;
  visibility: string;
  my_role: string | null;
  my_permissions: string[];
  subgroups: GroupRef[];
  projects: Array<{ id: number; path: string; name: string; visibility: string }>;
  members: Member[];
  custom_roles: CustomRole[];
}

export interface EpicRow {
  iid: number;
  title: string;
  state: string;
  confidential: boolean;
  author: string;
}

export interface BranchRule {
  name: string;
  allowed_to_push: string;
  allowed_to_merge: string;
}

export interface TagRule {
  name: string;
  allowed_to_create: string;
}

export interface PushRules {
  branch_name: string | null;
  commit_message: string | null;
  forbidden_files: string[];
  required_files: string[];
  secrets: boolean;
}

export interface ApprovalRule {
  id: number;
  name: string;
  required: number;
  users: string[];
  groups: string[];
}

export interface ProtectedEnvironment {
  name: string;
  roles: string;
  approvals: number;
}

export interface Variable {
  key: string;
  value: string;
}

export interface Webhook {
  id: number;
  url: string;
  events: string[];
}

export interface SettingsData {
  merge_method: string;
  merge_trains: boolean;
  pipelines_must_succeed: boolean;
  reset_approvals_on_push: boolean;
  author_can_approve: boolean;
  auto_resolve_outdated: boolean;
  default_branch: string;
  visibility: string;
  protected_branches: BranchRule[];
  protected_tags: TagRule[];
  push_rules: PushRules;
  approval_rules: ApprovalRule[];
  protected_environments: ProtectedEnvironment[];
  variables: Variable[];
  members: Member[];
  webhooks: Webhook[];
}

export interface DeliveryAttempt {
  number: number;
  status_code: number | null;
  at: string;
}

export interface Delivery {
  id: number;
  uuid: string;
  short_id: string;
  event: string;
  attempts: DeliveryAttempt[];
  state: string;
  next_at: string | null;
}

export interface AuditEvent {
  id: number;
  actor: string;
  action: string;
  target: string;
  before: unknown;
  after: unknown;
  at: string;
}

export interface SearchResult {
  project: string;
  project_id: number;
  iid?: number;
  title?: string;
  state?: string;
  confidential?: boolean;
  slug?: string;
  text?: string;
  path?: string;
  line?: number;
}

export interface SearchAnswer {
  count: number;
  results: SearchResult[];
}

export type TransferStatus = "preview" | "running" | "finished" | "failed";

export interface TransferState {
  id: number;
  status: TransferStatus;
  progress: number;
  error: string | null;
  download: string | null;
}

export interface ImportPreview {
  id: number;
  preview: { commits: number; issues: number; requests: number };
}

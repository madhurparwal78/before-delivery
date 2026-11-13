-- Idempotent schema for Spurline.
CREATE TABLE IF NOT EXISTS users (
  id bigserial PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  time_zone text NOT NULL DEFAULT 'UTC',
  created_at bigint NOT NULL,
  is_system boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at bigint NOT NULL,
  last_used bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  path text NOT NULL UNIQUE,
  parent_id bigint REFERENCES groups(id) ON DELETE CASCADE,
  visibility text NOT NULL DEFAULT 'private',
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id bigint NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text,
  custom_role_id bigint,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS custom_roles (
  id bigserial PRIMARY KEY,
  group_id bigint NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name text NOT NULL,
  base text NOT NULL,
  permissions text[] NOT NULL DEFAULT '{}',
  created_at bigint NOT NULL,
  UNIQUE (group_id, name)
);

CREATE TABLE IF NOT EXISTS projects (
  id bigserial PRIMARY KEY,
  group_id bigint NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  slug text NOT NULL,
  path text NOT NULL UNIQUE,
  visibility text NOT NULL DEFAULT 'private',
  default_branch text NOT NULL DEFAULT 'main',
  merge_method text NOT NULL DEFAULT 'merge_commit',
  merge_trains boolean NOT NULL DEFAULT false,
  pipelines_must_succeed boolean NOT NULL DEFAULT false,
  reset_approvals_on_push boolean NOT NULL DEFAULT true,
  author_can_approve boolean NOT NULL DEFAULT false,
  auto_resolve_outdated boolean NOT NULL DEFAULT false,
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text,
  custom_role_id bigint,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS labels (
  id bigserial PRIMARY KEY,
  group_id bigint REFERENCES groups(id) ON DELETE CASCADE,
  project_id bigint REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at bigint NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS labels_one_scope ON labels (group_id, project_id, name);

CREATE TABLE IF NOT EXISTS push_rules (
  project_id bigint PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  branch_name text,
  commit_message text,
  forbidden_files text[] NOT NULL DEFAULT '{}',
  required_files text[] NOT NULL DEFAULT '{}',
  secrets boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS approval_rules (
  id bigserial PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  required_count int NOT NULL,
  users text[] NOT NULL DEFAULT '{}',
  groups text[] NOT NULL DEFAULT '{}',
  created_at bigint NOT NULL
);


CREATE TABLE IF NOT EXISTS protected_branches (
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pattern text NOT NULL,
  allowed_to_push text NOT NULL,
  allowed_to_merge text NOT NULL,
  PRIMARY KEY (project_id, pattern)
);

CREATE TABLE IF NOT EXISTS protected_tags (
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pattern text NOT NULL,
  allowed_to_create text NOT NULL,
  PRIMARY KEY (project_id, pattern)
);
CREATE TABLE IF NOT EXISTS protected_environments (
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  roles text NOT NULL,
  approvals int NOT NULL,
  PRIMARY KEY (project_id, name)
);

CREATE TABLE IF NOT EXISTS variables (
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key text NOT NULL,
  value text NOT NULL,
  PRIMARY KEY (project_id, key)
);

CREATE TABLE IF NOT EXISTS blobs (
  id text PRIMARY KEY,
  size bigint NOT NULL,
  content text,
  inline_exceeded boolean NOT NULL
);

CREATE TABLE IF NOT EXISTS trees (
  id text PRIMARY KEY,
  entries jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS commits (
  id text PRIMARY KEY,
  tree text NOT NULL,
  parents text[] NOT NULL,
  author text NOT NULL,
  author_time bigint NOT NULL,
  committer text NOT NULL,
  commit_time bigint NOT NULL,
  message text NOT NULL
);

CREATE TABLE IF NOT EXISTS refs (
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  name text NOT NULL,
  commit_id text NOT NULL,
  PRIMARY KEY (project_id, kind, name)
);

CREATE TABLE IF NOT EXISTS mr_iids (
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  next_iid int NOT NULL,
  PRIMARY KEY (project_id, kind)
);

CREATE TABLE IF NOT EXISTS merge_requests (
  id bigserial PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  iid int NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  state text NOT NULL,
  draft boolean NOT NULL DEFAULT false,
  author_id bigint NOT NULL REFERENCES users(id),
  source text NOT NULL,
  target text NOT NULL,
  assignees text[] NOT NULL DEFAULT '{}',
  reviewers text[] NOT NULL DEFAULT '{}',
  delete_source_branch boolean NOT NULL DEFAULT false,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  merged_at bigint,
  merge_commit text,
  auto_merge boolean NOT NULL DEFAULT false,
  auto_merge_reason text,
  UNIQUE (project_id, iid)
);

CREATE TABLE IF NOT EXISTS mr_versions (
  id bigserial PRIMARY KEY,
  mr_id bigint NOT NULL REFERENCES merge_requests(id) ON DELETE CASCADE,
  number int NOT NULL,
  head text NOT NULL,
  base text NOT NULL,
  start_commit text NOT NULL,
  created_at bigint NOT NULL,
  UNIQUE (mr_id, number)
);

CREATE TABLE IF NOT EXISTS threads (
  id bigserial PRIMARY KEY,
  mr_id bigint NOT NULL REFERENCES merge_requests(id) ON DELETE CASCADE,
  path text,
  old_line int,
  new_line int,
  end_line int,
  version int NOT NULL,
  side text NOT NULL,
  current_line int,
  resolved boolean NOT NULL DEFAULT false,
  outdated boolean NOT NULL DEFAULT false,
  moved_to_issue int,
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id bigserial PRIMARY KEY,
  project_id bigint NOT NULL,
  author text NOT NULL,
  body text NOT NULL,
  system boolean NOT NULL DEFAULT false,
  pending boolean NOT NULL DEFAULT false,
  mr_id bigint REFERENCES merge_requests(id) ON DELETE CASCADE,
  thread_id bigint REFERENCES threads(id) ON DELETE CASCADE,
  issue_id bigint,
  issue_iid int,
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_reviews (
  id bigserial PRIMARY KEY,
  mr_id bigint NOT NULL REFERENCES merge_requests(id) ON DELETE CASCADE,
  author_id bigint NOT NULL REFERENCES users(id),
  summary text,
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS suggestions (
  id bigserial PRIMARY KEY,
  note_id bigint NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  path text NOT NULL,
  start_line int NOT NULL,
  end_line int NOT NULL,
  lines jsonb NOT NULL,
  state text NOT NULL DEFAULT 'open',
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id bigserial PRIMARY KEY,
  mr_id bigint NOT NULL REFERENCES merge_requests(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sha text NOT NULL,
  created_at bigint NOT NULL,
  UNIQUE (mr_id, user_id)
);

CREATE TABLE IF NOT EXISTS pipelines (
  id bigserial PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ref text NOT NULL,
  sha text NOT NULL,
  source text NOT NULL,
  status text NOT NULL,
  errors jsonb NOT NULL DEFAULT '[]',
  config_valid boolean NOT NULL DEFAULT true,
  mr_id bigint REFERENCES merge_requests(id) ON DELETE SET NULL,
  train_mr_id bigint REFERENCES merge_requests(id) ON DELETE SET NULL,
  created_at bigint NOT NULL,
  finished_at bigint
);
CREATE INDEX IF NOT EXISTS pipelines_project ON pipelines (project_id, id);

CREATE TABLE IF NOT EXISTS jobs (
  id bigserial PRIMARY KEY,
  pipeline_id bigint NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  stage text NOT NULL,
  stage_index int NOT NULL,
  config_index int NOT NULL,
  status text NOT NULL,
  attempt int NOT NULL DEFAULT 1,
  retried boolean NOT NULL DEFAULT false,
  failure_reason text,
  needs text[] NOT NULL DEFAULT '{}',
  layer int NOT NULL DEFAULT 0,
  row int NOT NULL DEFAULT 0,
  x int NOT NULL DEFAULT 0,
  y int NOT NULL DEFAULT 0,
  started_at bigint,
  finished_at bigint,
  start_at bigint,
  wait_until bigint,
  wait_started_at bigint,
  script jsonb NOT NULL,
  config jsonb NOT NULL,
  env_name text,
  when_kind text NOT NULL DEFAULT 'on_success',
  allow_failure boolean NOT NULL DEFAULT false,
  interruptible boolean NOT NULL DEFAULT false,
  resource_group text,
  retry_config jsonb,
  timeout_ms bigint,
  started_by bigint REFERENCES users(id),
  deploy_number int,
  environment_id bigint,
  has_env_action boolean NOT NULL DEFAULT false,
  artifacts jsonb NOT NULL DEFAULT '{}',
  cache_config jsonb NOT NULL DEFAULT '{}',
  dependencies text[] NOT NULL DEFAULT '{}',
  matrix_values jsonb NOT NULL DEFAULT '{}',
  previous_attempt bigint,
  next_attempt bigint
);
CREATE INDEX IF NOT EXISTS jobs_pipeline ON jobs (pipeline_id);
CREATE INDEX IF NOT EXISTS jobs_project ON jobs (project_id, id);

CREATE TABLE IF NOT EXISTS job_log_lines (
  job_id bigint NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  n int NOT NULL,
  stream text NOT NULL,
  text text NOT NULL,
  PRIMARY KEY (job_id, n)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id bigserial PRIMARY KEY,
  job_id bigint NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  path text NOT NULL,
  size bigint NOT NULL,
  expires_at bigint,
  object_key text,
  keep boolean NOT NULL DEFAULT false,
  created_at bigint NOT NULL,
  UNIQUE (job_id, path)
);

CREATE TABLE IF NOT EXISTS environments (
  id bigserial PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  tier text NOT NULL,
  state text NOT NULL DEFAULT 'available',
  auto_stop_at bigint,
  current_number int NOT NULL DEFAULT 0,
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS deployments (
  id bigserial PRIMARY KEY,
  environment_id bigint NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  number int NOT NULL,
  status text NOT NULL,
  sha text NOT NULL,
  pipeline_id bigint,
  job_id bigint,
  created_at bigint NOT NULL,
  finished_at bigint,
  rolled_back boolean NOT NULL DEFAULT false,
  UNIQUE (environment_id, number)
);

CREATE TABLE IF NOT EXISTS deployment_approvals (
  id bigserial PRIMARY KEY,
  deployment_id bigint NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL,
  granted_at bigint NOT NULL,
  expires_at bigint
);

CREATE TABLE IF NOT EXISTS deploy_artifacts (
  deployment_id bigint NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  path text NOT NULL,
  object_key text NOT NULL,
  size bigint NOT NULL,
  PRIMARY KEY (deployment_id, path)
);

CREATE TABLE IF NOT EXISTS reports (
  id bigserial PRIMARY KEY,
  job_id bigint NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  pipeline_id bigint NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  kind text NOT NULL,
  data jsonb NOT NULL,
  created_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_pipeline ON reports (pipeline_id, kind);

CREATE TABLE IF NOT EXISTS findings (
  id bigserial PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mr_id bigint NOT NULL REFERENCES merge_requests(id) ON DELETE CASCADE,
  report_id text NOT NULL,
  severity text NOT NULL,
  title text NOT NULL,
  path text NOT NULL,
  line int NOT NULL,
  state text NOT NULL DEFAULT 'detected',
  reason text,
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS issues (
  id bigserial PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  iid int NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'opened',
  author_id bigint NOT NULL REFERENCES users(id),
  confidential boolean NOT NULL DEFAULT false,
  weight int,
  estimate_ms bigint,
  spent_ms bigint,
  due_date text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  UNIQUE (project_id, iid)
);

CREATE TABLE IF NOT EXISTS issue_labels (
  issue_id bigint NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  label_id bigint NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (issue_id, label_id)
);

CREATE TABLE IF NOT EXISTS issue_assignees (
  issue_id bigint NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (issue_id, user_id)
);

CREATE TABLE IF NOT EXISTS milestones (
  id bigserial PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  start_date text,
  due_date text,
  time_zone text NOT NULL DEFAULT 'UTC',
  state text NOT NULL DEFAULT 'active',
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS issue_milestones (
  issue_id bigint NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  milestone_id bigint NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  PRIMARY KEY (issue_id, milestone_id)
);

CREATE TABLE IF NOT EXISTS epics (
  id bigserial PRIMARY KEY,
  group_id bigint NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  iid int NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  author_id bigint NOT NULL REFERENCES users(id),
  state text NOT NULL DEFAULT 'opened',
  confidential boolean NOT NULL DEFAULT false,
  parent_id bigint REFERENCES epics(id) ON DELETE SET NULL,
  created_at bigint NOT NULL,
  UNIQUE (group_id, iid)
);

CREATE TABLE IF NOT EXISTS epic_iids (
  group_id bigint NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  next_iid int NOT NULL,
  PRIMARY KEY (group_id)
);

CREATE TABLE IF NOT EXISTS epic_issues (
  epic_id bigint NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
  issue_id bigint NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  PRIMARY KEY (epic_id, issue_id)
);

CREATE TABLE IF NOT EXISTS epic_children (
  parent_id bigint NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
  child_id bigint NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
  PRIMARY KEY (parent_id, child_id)
);

CREATE TABLE IF NOT EXISTS boards (
  id bigserial PRIMARY KEY,
  group_id bigint REFERENCES groups(id) ON DELETE CASCADE,
  project_id bigint REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL,
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS board_lists (
  id bigserial PRIMARY KEY,
  board_id bigint NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  title text NOT NULL,
  position int NOT NULL,
  label_id bigint REFERENCES labels(id) ON DELETE CASCADE,
  assignee_id bigint REFERENCES users(id) ON DELETE CASCADE,
  milestone_id bigint REFERENCES milestones(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'label'
);

CREATE TABLE IF NOT EXISTS board_positions (
  board_id bigint NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  issue_id bigint NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  list_id bigint NOT NULL REFERENCES board_lists(id) ON DELETE CASCADE,
  position bigint NOT NULL,
  version int NOT NULL DEFAULT 0,
  PRIMARY KEY (board_id, issue_id)
);

CREATE TABLE IF NOT EXISTS issue_links (
  id bigserial PRIMARY KEY,
  from_issue bigint NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  to_issue bigint NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  kind text NOT NULL
);

CREATE TABLE IF NOT EXISTS wiki_pages (
  id bigserial PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slug text NOT NULL,
  UNIQUE (project_id, slug)
);

CREATE TABLE IF NOT EXISTS wiki_versions (
  id bigserial PRIMARY KEY,
  page_id bigint NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  version int NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  author text NOT NULL,
  created_at bigint NOT NULL,
  UNIQUE (page_id, version)
);

CREATE TABLE IF NOT EXISTS webhooks (
  id bigserial PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url text NOT NULL,
  secret text NOT NULL,
  events text[] NOT NULL DEFAULT '{}',
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS deliveries (
  id bigserial PRIMARY KEY,
  webhook_id bigint NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event text NOT NULL,
  payload text NOT NULL,
  state text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  next_at bigint,
  retry_step int NOT NULL DEFAULT 0,
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id bigserial PRIMARY KEY,
  delivery_id bigint NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  number int NOT NULL,
  status_code int,
  at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  project_id bigint,
  group_id bigint,
  actor text NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  before jsonb,
  after jsonb,
  at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_project ON audit_events (project_id, id);
CREATE INDEX IF NOT EXISTS audit_group ON audit_events (group_id, id);

CREATE TABLE IF NOT EXISTS live_messages (
  id bigserial PRIMARY KEY,
  project_id bigint NOT NULL,
  seq bigint NOT NULL,
  type text NOT NULL,
  data jsonb NOT NULL,
  created_at bigint NOT NULL,
  UNIQUE (project_id, seq)
);

CREATE TABLE IF NOT EXISTS train_cars (
  mr_id bigint PRIMARY KEY REFERENCES merge_requests(id) ON DELETE CASCADE,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target text NOT NULL,
  position int NOT NULL,
  sha text NOT NULL,
  pipeline_id bigint,
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS presence (
  project_id bigint NOT NULL,
  user_id bigint NOT NULL,
  mr_id bigint,
  last_seen bigint NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS exports (
  id bigserial PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status text NOT NULL,
  progress int NOT NULL DEFAULT 0,
  error text,
  object_key text,
  created_at bigint NOT NULL,
  finished_at bigint
);

CREATE TABLE IF NOT EXISTS imports (
  id bigserial PRIMARY KEY,
  group_id bigint NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  slug text NOT NULL,
  status text NOT NULL,
  progress int NOT NULL DEFAULT 0,
  project_id bigint,
  pack text NOT NULL,
  created_at bigint NOT NULL,
  finished_at bigint
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  status int NOT NULL,
  body text,
  created_at bigint NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS rate_counters (
  user_id bigint NOT NULL,
  name text NOT NULL,
  window_start bigint NOT NULL,
  count int NOT NULL,
  PRIMARY KEY (user_id, name)
);

CREATE TABLE IF NOT EXISTS quick_events (
  id bigserial PRIMARY KEY,
  project_id bigint NOT NULL,
  kind text NOT NULL,
  ref_id bigint NOT NULL,
  day text NOT NULL,
  at bigint NOT NULL,
  weight int,
  milestone_id bigint,
  labels_added text[] NOT NULL DEFAULT '{}',
  labels_removed text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS quick_events_ref ON quick_events (kind, ref_id);

CREATE TABLE IF NOT EXISTS artifacts_cache (
  project_id bigint NOT NULL,
  key text NOT NULL,
  created_at bigint NOT NULL,
  PRIMARY KEY (project_id, key)
);

CREATE TABLE IF NOT EXISTS tags_meta (
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  message text NOT NULL DEFAULT '',
  PRIMARY KEY (project_id, name)
);

CREATE TABLE IF NOT EXISTS sink_requests (
  name text PRIMARY KEY,
  status int NOT NULL DEFAULT 200,
  requests jsonb NOT NULL DEFAULT '[]'
);

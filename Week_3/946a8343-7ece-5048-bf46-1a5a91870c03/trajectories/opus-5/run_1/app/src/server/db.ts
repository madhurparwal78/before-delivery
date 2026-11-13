import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from './config';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

export type Sql = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T[]>;
  one<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T | null>;
};

function wrap(client: PoolClient | Pool): Sql {
  return {
    async query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
      const result = await client.query<T>(text, params as never[]);
      return result.rows;
    },
    async one<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
      const result = await client.query<T>(text, params as never[]);
      return result.rows.length > 0 ? result.rows[0] : null;
    },
  };
}

export const db: Sql = wrap(pool);

export async function withTx<T>(run: (sql: Sql, client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await run(wrap(client), client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // the connection is unusable; releasing it is enough
    }
    throw error;
  } finally {
    client.release();
  }
}

const schema = `
create table if not exists users (
  id bigserial primary key,
  username text unique not null,
  password_hash text not null,
  time_zone text not null default 'UTC',
  can_sign_in boolean not null default true
);
create table if not exists sessions (
  token text primary key,
  user_id bigint not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists groups (
  id bigserial primary key,
  parent_id bigint references groups(id) on delete cascade,
  name text not null,
  path text unique not null,
  visibility text not null default 'private'
);
create table if not exists custom_roles (
  id bigserial primary key,
  group_id bigint not null references groups(id) on delete cascade,
  name text not null,
  base text not null,
  permissions jsonb not null default '[]'
);
create table if not exists projects (
  id bigserial primary key,
  group_id bigint not null references groups(id) on delete cascade,
  slug text not null,
  path text unique not null,
  visibility text not null default 'private',
  default_branch text not null default 'main',
  settings jsonb not null default '{}',
  seq bigint not null default 0,
  next_mr_iid int not null default 1,
  next_issue_iid int not null default 1
);
create table if not exists memberships (
  id bigserial primary key,
  subject_type text not null,
  subject_id bigint not null,
  user_id bigint not null references users(id) on delete cascade,
  role text,
  custom_role_id bigint references custom_roles(id) on delete set null,
  unique (subject_type, subject_id, user_id)
);
create table if not exists blobs (
  project_id bigint not null references projects(id) on delete cascade,
  id text not null,
  size int not null,
  content text,
  object_key text,
  primary key (project_id, id)
);
create table if not exists trees (
  project_id bigint not null references projects(id) on delete cascade,
  id text not null,
  entries jsonb not null,
  primary key (project_id, id)
);
create table if not exists commits (
  project_id bigint not null references projects(id) on delete cascade,
  id text not null,
  tree text not null,
  parents jsonb not null,
  author text not null,
  authored_at bigint not null,
  committer text not null,
  committed_at bigint not null,
  message text not null,
  primary key (project_id, id)
);
create table if not exists refs (
  project_id bigint not null references projects(id) on delete cascade,
  kind text not null,
  name text not null,
  commit_id text not null,
  message text,
  primary key (project_id, kind, name)
);
create table if not exists protected_branches (
  project_id bigint not null references projects(id) on delete cascade,
  pattern text not null,
  allowed_to_push text not null,
  allowed_to_merge text not null,
  primary key (project_id, pattern)
);
create table if not exists protected_tags (
  project_id bigint not null references projects(id) on delete cascade,
  pattern text not null,
  allowed_to_create text not null,
  primary key (project_id, pattern)
);
create table if not exists push_rules (
  project_id bigint primary key references projects(id) on delete cascade,
  rules jsonb not null
);
create table if not exists approval_rules (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  name text not null,
  required int not null,
  users jsonb not null default '[]',
  groups jsonb not null default '[]'
);
create table if not exists project_variables (
  project_id bigint not null references projects(id) on delete cascade,
  key text not null,
  value text not null,
  primary key (project_id, key)
);
create table if not exists protected_environments (
  project_id bigint not null references projects(id) on delete cascade,
  name text not null,
  roles text not null,
  approvals int not null,
  primary key (project_id, name)
);
create table if not exists merge_requests (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  iid int not null,
  title text not null,
  description text not null default '',
  author text not null,
  source text not null,
  target text not null,
  state text not null default 'opened',
  delete_source_branch boolean not null default false,
  assignees jsonb not null default '[]',
  reviewers jsonb not null default '[]',
  auto_merge boolean not null default false,
  auto_merge_sha text,
  merge_commit text,
  created_at timestamptz not null default now(),
  merged_at timestamptz,
  unique (project_id, iid)
);
create table if not exists mr_versions (
  id bigserial primary key,
  mr_id bigint not null references merge_requests(id) on delete cascade,
  number int not null,
  base text not null,
  head text not null,
  start_commit text not null,
  created_at timestamptz not null default now(),
  unique (mr_id, number)
);
create table if not exists threads (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  mr_id bigint references merge_requests(id) on delete cascade,
  position jsonb,
  current_line int,
  resolved boolean not null default false,
  outdated boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists notes (
  id bigserial primary key,
  project_id bigint references projects(id) on delete cascade,
  group_id bigint references groups(id) on delete cascade,
  mr_id bigint references merge_requests(id) on delete cascade,
  issue_id bigint,
  epic_id bigint,
  thread_id bigint references threads(id) on delete cascade,
  author text not null,
  body text not null,
  system boolean not null default false,
  pending boolean not null default false,
  created_at timestamptz not null default now(),
  created_ms bigint not null default 0
);
create table if not exists suggestions (
  id bigserial primary key,
  note_id bigint not null references notes(id) on delete cascade,
  thread_id bigint not null references threads(id) on delete cascade,
  mr_id bigint not null references merge_requests(id) on delete cascade,
  path text not null,
  start_line int not null,
  end_line int not null,
  lines jsonb not null,
  state text not null default 'open'
);
create table if not exists approvals (
  id bigserial primary key,
  mr_id bigint not null references merge_requests(id) on delete cascade,
  username text not null,
  unique (mr_id, username)
);
create table if not exists train_cars (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  target text not null,
  mr_id bigint not null references merge_requests(id) on delete cascade,
  position int not null,
  sha text not null,
  pipeline_id bigint,
  created_ms bigint not null
);
create table if not exists pipelines (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  ref text not null,
  sha text not null,
  source text not null,
  status text not null,
  errors jsonb not null default '[]',
  variables jsonb not null default '{}',
  mr_iid int,
  interruptible boolean not null default true,
  created_ms bigint not null,
  created_at timestamptz not null default now()
);
create table if not exists jobs (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  pipeline_id bigint not null references pipelines(id) on delete cascade,
  name text not null,
  stage text not null,
  stage_index int not null,
  config_order int not null,
  status text not null,
  attempt int not null default 1,
  retried boolean not null default false,
  failure_reason text,
  spec jsonb not null,
  variables jsonb not null default '{}',
  needs jsonb,
  layer int not null default 0,
  row_index int not null default 0,
  started_ms bigint,
  finished_ms bigint,
  start_at_ms bigint,
  script_index int not null default 0,
  wait_start_ms bigint,
  wait_ms bigint,
  log jsonb not null default '[]',
  log_sealed boolean not null default false,
  workspace jsonb not null default '{}',
  retry_count int not null default 0,
  resource_group text,
  deployment_id bigint
);
create table if not exists artifacts (
  id bigserial primary key,
  job_id bigint not null references jobs(id) on delete cascade,
  path text not null,
  size int not null,
  expires_ms bigint,
  object_key text not null
);
create table if not exists caches (
  project_id bigint not null references projects(id) on delete cascade,
  key text not null,
  updated_ms bigint not null,
  object_key text not null,
  primary key (project_id, key)
);
create table if not exists reports (
  job_id bigint not null references jobs(id) on delete cascade,
  kind text not null,
  data jsonb not null,
  object_key text,
  primary key (job_id, kind)
);
create table if not exists environments (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  name text not null,
  tier text not null,
  state text not null default 'available',
  auto_stop_ms bigint,
  on_stop text,
  unique (project_id, name)
);
create table if not exists deployments (
  id bigserial primary key,
  environment_id bigint not null references environments(id) on delete cascade,
  number int not null,
  status text not null,
  sha text not null,
  pipeline_id bigint,
  job_id bigint,
  deployer text,
  required int not null default 0,
  artifact_keys jsonb not null default '[]',
  created_ms bigint not null,
  finished_ms bigint,
  unique (environment_id, number)
);
create table if not exists deployment_approvals (
  id bigserial primary key,
  deployment_id bigint not null references deployments(id) on delete cascade,
  username text not null,
  status text not null,
  granted_ms bigint not null,
  unique (deployment_id, username)
);
create table if not exists labels (
  id bigserial primary key,
  project_id bigint references projects(id) on delete cascade,
  group_id bigint references groups(id) on delete cascade,
  name text not null,
  description text not null default ''
);
create table if not exists milestones (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  title text not null,
  start_date date,
  due_date date,
  time_zone text not null default 'UTC',
  state text not null default 'active'
);
create table if not exists issues (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  iid int not null,
  title text not null,
  description text not null default '',
  author text not null,
  state text not null default 'opened',
  labels jsonb not null default '[]',
  assignees jsonb not null default '[]',
  milestone_id bigint references milestones(id) on delete set null,
  weight int,
  confidential boolean not null default false,
  due_date date,
  estimate_m int,
  spent_m int not null default 0,
  position double precision not null default 0,
  card_version int not null default 0,
  created_ms bigint not null default 0,
  closed_ms bigint,
  unique (project_id, iid)
);
create table if not exists issue_events (
  id bigserial primary key,
  issue_id bigint not null references issues(id) on delete cascade,
  at_ms bigint not null,
  kind text not null,
  data jsonb not null default '{}'
);
create table if not exists issue_links (
  id bigserial primary key,
  issue_id bigint not null references issues(id) on delete cascade,
  target_id bigint not null references issues(id) on delete cascade,
  kind text not null
);
create table if not exists epics (
  id bigserial primary key,
  group_id bigint not null references groups(id) on delete cascade,
  iid int not null,
  title text not null,
  description text not null default '',
  author text not null,
  state text not null default 'opened',
  parent_id bigint references epics(id) on delete set null,
  confidential boolean not null default false,
  labels jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (group_id, iid)
);
create table if not exists epic_issues (
  epic_id bigint not null references epics(id) on delete cascade,
  issue_id bigint not null references issues(id) on delete cascade,
  primary key (epic_id, issue_id)
);
create table if not exists boards (
  id bigserial primary key,
  project_id bigint references projects(id) on delete cascade,
  group_id bigint references groups(id) on delete cascade,
  name text not null,
  kind text not null,
  lists jsonb not null default '[]'
);
create table if not exists wiki_pages (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  slug text not null,
  version int not null,
  title text not null,
  content text not null,
  author text not null,
  created_at timestamptz not null default now(),
  unique (project_id, slug, version)
);
create table if not exists webhooks (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  url text not null,
  secret text not null,
  events jsonb not null default '[]'
);
create table if not exists deliveries (
  id bigserial primary key,
  webhook_id bigint not null references webhooks(id) on delete cascade,
  uuid text not null,
  event text not null,
  body text not null,
  state text not null default 'pending',
  attempts jsonb not null default '[]',
  next_ms bigint
);
create table if not exists findings (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  mr_id bigint not null references merge_requests(id) on delete cascade,
  report_id text not null,
  severity text not null,
  title text not null,
  path text not null,
  line int not null,
  state text not null default 'detected',
  reason text,
  unique (mr_id, report_id)
);
create table if not exists audit_events (
  id bigserial primary key,
  project_id bigint references projects(id) on delete cascade,
  group_id bigint references groups(id) on delete cascade,
  actor text not null,
  action text not null,
  target text not null,
  before_value jsonb,
  after_value jsonb,
  at_ms bigint not null
);
create table if not exists exports (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  status text not null default 'running',
  progress int not null default 0,
  error text,
  object_key text,
  next_step_ms bigint not null
);
create table if not exists imports (
  id bigserial primary key,
  group_id bigint not null references groups(id) on delete cascade,
  slug text not null,
  content text not null,
  status text not null default 'preview',
  progress int not null default 0,
  error text,
  project_id bigint,
  next_step_ms bigint not null default 0,
  counts jsonb not null default '{}'
);
create table if not exists live_messages (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  seq bigint not null,
  type text not null,
  data jsonb not null,
  at_ms bigint not null
);
create table if not exists idempotency_keys (
  key text not null,
  user_id bigint not null,
  body_hash text not null,
  status int not null,
  response jsonb not null,
  at_ms bigint not null,
  primary key (key, user_id)
);
create table if not exists rate_events (
  id bigserial primary key,
  bucket text not null,
  at_ms bigint not null
);
create table if not exists instance_state (
  key text primary key,
  value jsonb not null
);
create index if not exists live_messages_project on live_messages(project_id, seq);
create index if not exists notes_mr on notes(mr_id);
create index if not exists notes_issue on notes(issue_id);
create index if not exists jobs_pipeline on jobs(pipeline_id);
create index if not exists rate_events_bucket on rate_events(bucket, at_ms);
alter table jobs alter column needs drop not null;
`;

export async function applySchema(): Promise<void> {
  await pool.query(schema);
}

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query('select 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

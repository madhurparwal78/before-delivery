-- CI tables: pipelines, jobs, logs, workspaces, artifacts, caches, reports, environments, deployments, findings.

CREATE TABLE IF NOT EXISTS ci_pipelines (
  id             serial PRIMARY KEY,
  project_id     integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ref            text NOT NULL,
  sha            text NOT NULL,
  source         text NOT NULL CHECK (source IN ('push', 'train', 'web')),
  status         text NOT NULL,
  errors         jsonb NOT NULL DEFAULT '[]',
  actor_id       integer,
  actor_name     text NOT NULL,
  run_variables  jsonb NOT NULL DEFAULT '{}',
  predefined     jsonb NOT NULL DEFAULT '{}',
  mr_iids        integer[] NOT NULL DEFAULT '{}',
  created_at     bigint NOT NULL,
  finished_at    bigint
);
CREATE INDEX IF NOT EXISTS ci_pipelines_project ON ci_pipelines (project_id, id DESC);
CREATE INDEX IF NOT EXISTS ci_pipelines_sha ON ci_pipelines (project_id, sha, id DESC);

CREATE TABLE IF NOT EXISTS ci_jobs (
  id               serial PRIMARY KEY,
  pipeline_id      integer NOT NULL REFERENCES ci_pipelines(id) ON DELETE CASCADE,
  project_id       integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name             text NOT NULL,
  stage            text NOT NULL,
  stage_index      integer NOT NULL,
  config_order     integer NOT NULL,
  status           text NOT NULL,
  attempt          integer NOT NULL DEFAULT 1,
  retried          boolean NOT NULL DEFAULT false,
  auto_retries     integer NOT NULL DEFAULT 0,
  failure_reason   text,
  spec             jsonb NOT NULL,
  play_variables   jsonb NOT NULL DEFAULT '{}',
  actor_id         integer,
  actor_name       text NOT NULL,
  created_at       bigint NOT NULL,
  started_at       bigint,
  finished_at      bigint,
  start_at         bigint,
  pc               integer NOT NULL DEFAULT 0,
  wait_started_at  bigint,
  wait_ms          integer NOT NULL DEFAULT 0,
  log_lines        integer NOT NULL DEFAULT 0,
  log_sealed       boolean NOT NULL DEFAULT false,
  emitted          jsonb NOT NULL DEFAULT '[]',
  downloaded_from  integer[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ci_jobs_pipeline ON ci_jobs (pipeline_id, config_order, id);
CREATE INDEX IF NOT EXISTS ci_jobs_project_status ON ci_jobs (project_id, status);

CREATE TABLE IF NOT EXISTS ci_job_lines (
  job_id  integer NOT NULL REFERENCES ci_jobs(id) ON DELETE CASCADE,
  n       integer NOT NULL,
  stream  text NOT NULL,
  text    text NOT NULL,
  PRIMARY KEY (job_id, n)
);

CREATE TABLE IF NOT EXISTS ci_workspace (
  job_id   integer NOT NULL REFERENCES ci_jobs(id) ON DELETE CASCADE,
  path     text NOT NULL,
  content  text NOT NULL,
  origin   text NOT NULL,
  PRIMARY KEY (job_id, path)
);

CREATE TABLE IF NOT EXISTS ci_artifacts (
  job_id      integer NOT NULL REFERENCES ci_jobs(id) ON DELETE CASCADE,
  path        text NOT NULL,
  size        integer NOT NULL,
  expires_at  bigint,
  expired     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (job_id, path)
);
CREATE INDEX IF NOT EXISTS ci_artifacts_due ON ci_artifacts (expires_at) WHERE NOT expired AND expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS ci_caches (
  project_id  integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key         text NOT NULL,
  saved_at    bigint NOT NULL,
  PRIMARY KEY (project_id, key)
);

CREATE TABLE IF NOT EXISTS ci_reports (
  job_id  integer NOT NULL REFERENCES ci_jobs(id) ON DELETE CASCADE,
  kind    text NOT NULL,
  data    jsonb NOT NULL,
  PRIMARY KEY (job_id, kind)
);

CREATE TABLE IF NOT EXISTS ci_environments (
  id            serial PRIMARY KEY,
  project_id    integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name          text NOT NULL,
  tier          text NOT NULL,
  state         text NOT NULL DEFAULT 'available',
  auto_stop_at  bigint,
  kept          boolean NOT NULL DEFAULT false,
  created_at    bigint NOT NULL,
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS ci_deployments (
  id              serial PRIMARY KEY,
  environment_id  integer NOT NULL REFERENCES ci_environments(id) ON DELETE CASCADE,
  project_id      integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number          integer NOT NULL,
  pipeline_id     integer REFERENCES ci_pipelines(id) ON DELETE SET NULL,
  job_id          integer REFERENCES ci_jobs(id) ON DELETE SET NULL,
  sha             text NOT NULL,
  status          text NOT NULL,
  required        integer NOT NULL DEFAULT 0,
  deployer_id     integer,
  deployer_name   text NOT NULL,
  artifacts       jsonb NOT NULL DEFAULT '[]',
  created_at      bigint NOT NULL,
  finished_at     bigint,
  UNIQUE (environment_id, number)
);
CREATE INDEX IF NOT EXISTS ci_deployments_job ON ci_deployments (job_id);
CREATE INDEX IF NOT EXISTS ci_deployments_project ON ci_deployments (project_id, finished_at);

CREATE TABLE IF NOT EXISTS ci_deployment_approvals (
  id             serial PRIMARY KEY,
  deployment_id  integer NOT NULL REFERENCES ci_deployments(id) ON DELETE CASCADE,
  user_id        integer NOT NULL,
  username       text NOT NULL,
  status         text NOT NULL,
  granted_at     bigint NOT NULL,
  lapse_seen     boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS ci_deployment_approvals_deployment ON ci_deployment_approvals (deployment_id, id);

CREATE TABLE IF NOT EXISTS ci_findings (
  id          serial PRIMARY KEY,
  project_id  integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mr_id       integer NOT NULL,
  report_id   text NOT NULL,
  severity    text NOT NULL,
  title       text NOT NULL,
  path        text NOT NULL,
  line        integer NOT NULL,
  state       text NOT NULL DEFAULT 'detected',
  reason      text,
  UNIQUE (mr_id, report_id)
);
CREATE INDEX IF NOT EXISTS ci_findings_project ON ci_findings (project_id, mr_id);

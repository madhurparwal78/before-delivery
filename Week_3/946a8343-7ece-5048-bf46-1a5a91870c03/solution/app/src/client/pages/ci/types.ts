// Response shapes of the pipeline, job, environment and metrics API (see the brief's API tables and app/src/server/ci/views.ts).
export interface PipelineSummary {
  id: number;
  ref: string;
  sha: string;
  source: string;
  status: string;
  actor: string;
  created_at: string;
  finished_at: string | null;
  coverage: number | null;
}

export interface JobSummary {
  id: number;
  pipeline_id: number;
  name: string;
  stage: string;
  status: string;
  attempt: number;
  retried: boolean;
  failure_reason: string | null;
  layer: number;
  row: number;
  x: number;
  y: number;
  needs: string[];
  when: string;
  allow_failure: boolean;
  started_at: string | null;
  finished_at: string | null;
  start_at: string | null;
}

export interface StageSummary {
  name: string;
  status: string;
}

export interface PipelineDetail extends PipelineSummary {
  project_id: number;
  source: string;
  errors: string[];
  stages: StageSummary[];
  jobs: JobSummary[];
}

export interface Artifact {
  path: string;
  size: number;
  expires_at: string | null;
  expired: boolean;
}

export interface JobEnvironment {
  id: number | null;
  name: string;
  action: string;
  tier: string | null;
  state: string | null;
  deployment: { id: number; number: number; status: string } | null;
}

export interface JobDetail extends JobSummary {
  project_id: number;
  ref: string;
  sha: string;
  log_sealed: boolean;
  waiting: boolean;
  artifacts: Artifact[];
  environment: JobEnvironment | null;
}

export interface Approval {
  user: string;
  status: string;
  expires_at: string | null;
  expired: boolean;
}

export interface Deployment {
  id: number;
  number: number;
  status: string;
  sha: string;
  pipeline_id: number | null;
  job_id: number | null;
  required: number;
  approvals: Approval[];
  approved: number;
  deployer: string;
  created_at: string;
  finished_at: string | null;
}

export interface Environment {
  id: number;
  name: string;
  tier: string;
  state: string;
  auto_stop_at: string | null;
  protection: { roles: string; approvals: number } | null;
  deployments: Deployment[];
}

export interface Metrics {
  deployment_frequency: number | null;
  lead_time_hours: number | null;
  change_failure_rate: number | null;
  recovery_time_hours: number | null;
}

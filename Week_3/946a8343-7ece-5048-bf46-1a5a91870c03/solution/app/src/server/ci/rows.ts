// Row shapes of the CI tables and the lookups every part of the module shares.
import type { Queryable } from "../db.ts";
import { iso } from "../clock.ts";
import type { ReportKind } from "./commands.ts";
import type { ResolvedJob } from "./config/types.ts";
import type { JobStatus } from "./status.ts";

export interface PipelineRow {
  readonly id: number;
  readonly project_id: number;
  readonly ref: string;
  readonly sha: string;
  readonly source: "push" | "train" | "web";
  readonly status: string;
  readonly errors: string[];
  readonly actor_id: number | null;
  readonly actor_name: string;
  readonly run_variables: Record<string, string>;
  readonly predefined: Record<string, string>;
  readonly mr_iids: number[];
  readonly created_at: number;
  readonly finished_at: number | null;
}

interface EmittedReport {
  readonly kind: ReportKind;
  readonly path: string;
  readonly content: string;
}

export interface JobRow {
  readonly id: number;
  readonly pipeline_id: number;
  readonly project_id: number;
  readonly name: string;
  readonly stage: string;
  readonly stage_index: number;
  readonly config_order: number;
  readonly status: JobStatus;
  readonly attempt: number;
  readonly retried: boolean;
  readonly auto_retries: number;
  readonly failure_reason: string | null;
  readonly spec: ResolvedJob;
  readonly play_variables: Record<string, string>;
  readonly actor_id: number | null;
  readonly actor_name: string;
  readonly created_at: number;
  readonly started_at: number | null;
  readonly finished_at: number | null;
  readonly start_at: number | null;
  readonly pc: number;
  readonly wait_started_at: number | null;
  readonly wait_ms: number;
  readonly log_lines: number;
  readonly log_sealed: boolean;
  readonly emitted: EmittedReport[];
  readonly downloaded_from: number[];
}

export interface EnvironmentRow {
  readonly id: number;
  readonly project_id: number;
  readonly name: string;
  readonly tier: string;
  readonly state: "available" | "stopping" | "stopped";
  readonly auto_stop_at: number | null;
  readonly kept: boolean;
  readonly created_at: number;
}

export interface DeploymentArtifact {
  readonly job_id: number;
  readonly path: string;
}

export interface DeploymentRow {
  readonly id: number;
  readonly environment_id: number;
  readonly project_id: number;
  readonly number: number;
  readonly pipeline_id: number | null;
  readonly job_id: number | null;
  readonly sha: string;
  readonly status: string;
  readonly required: number;
  readonly deployer_id: number | null;
  readonly deployer_name: string;
  readonly artifacts: DeploymentArtifact[];
  readonly created_at: number;
  readonly finished_at: number | null;
}

export const isoOrNull = (ms: number | null): string | null => (ms === null ? null : iso(ms));

export async function loadPipeline(q: Queryable, id: number): Promise<PipelineRow | undefined> {
  return q.maybe<PipelineRow>("SELECT * FROM ci_pipelines WHERE id = $1", [id]);
}

export async function loadJob(q: Queryable, id: number): Promise<JobRow | undefined> {
  return q.maybe<JobRow>("SELECT * FROM ci_jobs WHERE id = $1", [id]);
}

export async function loadJobsOf(q: Queryable, pipelineId: number): Promise<JobRow[]> {
  return q.q<JobRow>("SELECT * FROM ci_jobs WHERE pipeline_id = $1 ORDER BY config_order, id", [pipelineId]);
}

export async function latestJobsOf(q: Queryable, pipelineId: number): Promise<JobRow[]> {
  return q.q<JobRow>("SELECT * FROM ci_jobs WHERE pipeline_id = $1 AND NOT retried ORDER BY config_order, id", [pipelineId]);
}

export async function loadEnvironment(q: Queryable, id: number): Promise<EnvironmentRow | undefined> {
  return q.maybe<EnvironmentRow>("SELECT * FROM ci_environments WHERE id = $1", [id]);
}

export async function loadDeployment(q: Queryable, id: number): Promise<DeploymentRow | undefined> {
  return q.maybe<DeploymentRow>("SELECT * FROM ci_deployments WHERE id = $1", [id]);
}

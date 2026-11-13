// JSON shapes of pipelines, jobs and environments.
import { iso, now } from "../clock.ts";
import type { Queryable } from "../db.ts";
import { layoutGraph } from "../../shared/pipeline-layout.ts";
import { deploymentViews, protectionOf, type DeploymentView, type Protection } from "./deployments.ts";
import { pipelineCoverage } from "./request-reports.ts";
import {
  isoOrNull, loadJobsOf,
  type DeploymentRow, type EnvironmentRow, type JobRow, type PipelineRow,
} from "./rows.ts";
import { rollup, type RolledStatus } from "./status.ts";

interface JobView {
  readonly id: number;
  readonly pipeline_id: number;
  readonly name: string;
  readonly stage: string;
  readonly status: string;
  readonly attempt: number;
  readonly retried: boolean;
  readonly failure_reason: string | null;
  readonly layer: number;
  readonly row: number;
  readonly x: number;
  readonly y: number;
  readonly needs: string[];
  readonly when: string;
  readonly allow_failure: boolean;
  readonly started_at: string | null;
  readonly finished_at: string | null;
  readonly start_at: string | null;
}

interface Place {
  readonly layer: number;
  readonly row: number;
  readonly x: number;
  readonly y: number;
}

function jobView(job: JobRow, place: Place): JobView {
  return {
    id: job.id, pipeline_id: job.pipeline_id, name: job.name, stage: job.stage, status: job.status, attempt: job.attempt,
    retried: job.retried, failure_reason: job.failure_reason, layer: place.layer, row: place.row, x: place.x, y: place.y,
    needs: job.spec.needs ?? [], when: job.spec.when, allow_failure: job.spec.allowFailure,
    started_at: isoOrNull(job.started_at), finished_at: isoOrNull(job.finished_at), start_at: isoOrNull(job.start_at),
  };
}

/** Graph coordinates of each job name, from the latest attempts. */
function placesOf(jobs: readonly JobRow[]): Map<string, Place> {
  const latest = jobs.filter((job) => !job.retried);
  const positions = layoutGraph(latest.map((job) => ({ name: job.name, stageIndex: job.stage_index, needs: job.spec.needs ?? [] })));
  return new Map(positions.map((position) => [position.name, position] as const));
}

interface PipelineView {
  readonly id: number;
  readonly project_id: number;
  readonly ref: string;
  readonly sha: string;
  readonly source: string;
  readonly status: string;
  readonly errors: string[];
  readonly actor: string;
  readonly created_at: string;
  readonly finished_at: string | null;
  readonly coverage: number | null;
  readonly stages: { name: string; status: RolledStatus }[];
  readonly jobs: JobView[];
}

function stagesOf(jobs: readonly JobRow[]): { name: string; status: RolledStatus }[] {
  const names = new Map<number, string>();
  for (const job of jobs) names.set(job.stage_index, job.stage);
  return [...names.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, name]) => ({
      name,
      status: rollup(jobs.filter((job) => !job.retried && job.stage_index === index).map((job) => ({ status: job.status, allowFailure: job.spec.allowFailure }))),
    }));
}

export async function pipelineView(q: Queryable, pipeline: PipelineRow): Promise<PipelineView> {
  const jobs = await loadJobsOf(q, pipeline.id);
  const places = placesOf(jobs);
  return {
    id: pipeline.id, project_id: pipeline.project_id, ref: pipeline.ref, sha: pipeline.sha, source: pipeline.source,
    status: pipeline.status, errors: pipeline.errors, actor: pipeline.actor_name, created_at: iso(pipeline.created_at),
    finished_at: isoOrNull(pipeline.finished_at), coverage: await pipelineCoverage(q, pipeline.id), stages: stagesOf(jobs),
    jobs: jobs.map((job) => jobView(job, places.get(job.name) ?? { layer: job.stage_index, row: 0, x: 0, y: 0 })),
  };
}

export function pipelineListItem(pipeline: PipelineRow, coverage: number | null): Record<string, unknown> {
  return {
    id: pipeline.id, ref: pipeline.ref, sha: pipeline.sha, source: pipeline.source, status: pipeline.status,
    actor: pipeline.actor_name, created_at: iso(pipeline.created_at), finished_at: isoOrNull(pipeline.finished_at), coverage,
  };
}

interface ArtifactRow {
  readonly path: string;
  readonly size: number;
  readonly expires_at: number | null;
  readonly expired: boolean;
}

export async function jobDetail(q: Queryable, job: JobRow, pipeline: PipelineRow): Promise<Record<string, unknown>> {
  const siblings = await loadJobsOf(q, job.pipeline_id);
  const place = placesOf(siblings).get(job.name) ?? { layer: job.stage_index, row: 0, x: 0, y: 0 };
  const artifacts = await q.q<ArtifactRow>("SELECT path, size, expires_at, expired FROM ci_artifacts WHERE job_id = $1 ORDER BY path", [job.id]);
  const dep = await q.maybe<DeploymentRow>("SELECT * FROM ci_deployments WHERE job_id = $1", [job.id]);
  const env = dep === undefined ? undefined : await q.maybe<EnvironmentRow>("SELECT * FROM ci_environments WHERE id = $1", [dep.environment_id]);
  const spec = job.spec.environment;
  return {
    ...jobView(job, place),
    project_id: job.project_id,
    ref: pipeline.ref,
    sha: pipeline.sha,
    log_sealed: job.log_sealed,
    waiting: job.status === "running" && job.wait_started_at !== null,
    artifacts: artifacts.map((row) => ({
      path: row.path, size: row.size, expires_at: isoOrNull(row.expires_at),
      expired: row.expired || (row.expires_at !== null && row.expires_at <= now()),
    })),
    environment:
      spec === null
        ? null
        : {
            id: env?.id ?? null, name: env?.name ?? spec.name, action: spec.action, tier: env?.tier ?? null, state: env?.state ?? null,
            deployment: dep === undefined ? null : { id: dep.id, number: dep.number, status: dep.status },
          },
  };
}

interface EnvironmentView {
  readonly id: number;
  readonly name: string;
  readonly tier: string;
  readonly state: string;
  readonly auto_stop_at: string | null;
  readonly protection: Protection | null;
  readonly deployments: DeploymentView[];
}

export async function environmentView(q: Queryable, env: EnvironmentRow): Promise<EnvironmentView> {
  const deployments = await q.q<DeploymentRow>("SELECT * FROM ci_deployments WHERE environment_id = $1 ORDER BY number DESC", [env.id]);
  return {
    id: env.id, name: env.name, tier: env.tier, state: env.state, auto_stop_at: isoOrNull(env.auto_stop_at),
    protection: await protectionOf(q, env.project_id, env.name), deployments: await deploymentViews(q, deployments),
  };
}

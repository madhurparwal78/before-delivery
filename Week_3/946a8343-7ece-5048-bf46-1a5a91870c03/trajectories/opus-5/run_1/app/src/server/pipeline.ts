import { ProjectRow } from './access';
import { nowMs } from './clock';
import { ExpandContext, JobSpec, expandConfig, graphPositions, mainConfigPath } from './ciconfig';
import { Sql } from './db';
import { Tx, emit } from './live';
import { changedPaths } from './diff';
import { filesOfCommit, loadCommit, shortId } from './repo';
import { settleStatuses } from './runner';

export type JobRow = {
  id: number;
  project_id: number;
  pipeline_id: number;
  name: string;
  stage: string;
  stage_index: number;
  config_order: number;
  status: string;
  attempt: number;
  retried: boolean;
  failure_reason: string | null;
  spec: JobSpec;
  variables: Record<string, string>;
  needs: string[] | null;
  layer: number;
  row_index: number;
  started_ms: number | null;
  finished_ms: number | null;
  start_at_ms: number | null;
  script_index: number;
  wait_start_ms: number | null;
  wait_ms: number | null;
  log: { stream: string; text: string }[];
  log_sealed: boolean;
  workspace: Record<string, string>;
  retry_count: number;
  resource_group: string | null;
  deployment_id: number | null;
};

export type PipelineRow = {
  id: number;
  project_id: number;
  ref: string;
  sha: string;
  source: string;
  status: string;
  errors: string[];
  variables: Record<string, string>;
  mr_iid: number | null;
  created_ms: number;
};

export const finishedStatuses = ['success', 'failed', 'canceled', 'skipped', 'warning'];

export function isFinished(status: string): boolean {
  return finishedStatuses.includes(status);
}

export function rollup(jobs: { status: string; retried: boolean; spec: JobSpec }[]): string {
  const live = jobs.filter((job) => !job.retried);
  if (live.length === 0) return 'success';
  if (live.every((job) => job.status === 'created')) return 'created';
  if (live.some((job) => ['running', 'pending', 'created'].includes(job.status))) return 'running';
  if (
    live.some((job) => job.status === 'manual' && !job.spec.allow_failure) &&
    !live.some((job) => job.status === 'running')
  ) {
    return 'blocked';
  }
  if (live.some((job) => job.status === 'failed')) return 'failed';
  if (live.some((job) => job.status === 'canceled')) return 'canceled';
  if (live.some((job) => job.status === 'warning')) return 'warning';
  if (live.every((job) => job.status === 'skipped')) return 'skipped';
  if (live.some((job) => job.status === 'scheduled')) return 'scheduled';
  return 'success';
}

export async function jobsOfPipeline(sql: Sql, pipelineId: number): Promise<JobRow[]> {
  const rows = await sql.query<JobRow>(
    `select id, project_id, pipeline_id, name, stage, stage_index, config_order, status, attempt, retried,
            failure_reason, spec, variables, needs, layer, row_index, started_ms, finished_ms, start_at_ms,
            script_index, wait_start_ms, wait_ms, log, log_sealed, workspace, retry_count, resource_group, deployment_id
     from jobs where pipeline_id = $1 order by stage_index, config_order, id`,
    [pipelineId],
  );
  return rows.map(normalizeJob);
}

export function normalizeJob(row: JobRow): JobRow {
  return {
    ...row,
    id: Number(row.id),
    project_id: Number(row.project_id),
    pipeline_id: Number(row.pipeline_id),
    started_ms: row.started_ms === null ? null : Number(row.started_ms),
    finished_ms: row.finished_ms === null ? null : Number(row.finished_ms),
    start_at_ms: row.start_at_ms === null ? null : Number(row.start_at_ms),
    wait_start_ms: row.wait_start_ms === null ? null : Number(row.wait_start_ms),
    wait_ms: row.wait_ms === null ? null : Number(row.wait_ms),
    deployment_id: row.deployment_id === null ? null : Number(row.deployment_id),
  };
}

export async function loadPipeline(sql: Sql, id: number): Promise<PipelineRow | null> {
  const row = await sql.one<PipelineRow>(
    `select id, project_id, ref, sha, source, status, errors, variables, mr_iid, created_ms
     from pipelines where id = $1`,
    [id],
  );
  return row === null
    ? null
    : { ...row, id: Number(row.id), project_id: Number(row.project_id), created_ms: Number(row.created_ms) };
}

export type CreateInput = {
  project: ProjectRow;
  ref: string;
  sha: string;
  source: 'push' | 'train' | 'web';
  variables?: Record<string, string>;
  beforeSha?: string | null;
  mrIid?: number | null;
  trainTarget?: string | null;
  actor: string;
};

export type CreateResult = { id: number } | { created: false; reason: string };

export async function predefinedVariables(
  sql: Sql,
  input: CreateInput,
  pipelineId: number,
): Promise<Record<string, string>> {
  const commit = await loadCommit(sql, input.project.id, input.sha);
  const refName = input.source === 'train' && input.trainTarget !== null && input.trainTarget !== undefined
    ? input.trainTarget
    : input.ref;
  const mr = await sql.one<{ iid: number; source: string; target: string }>(
    `select iid, source, target from merge_requests
     where project_id = $1 and source = $2 and state in ('opened') order by iid limit 1`,
    [input.project.id, input.ref],
  );
  return {
    CI_PIPELINE_ID: String(pipelineId),
    CI_PIPELINE_SOURCE: input.source,
    CI_COMMIT_SHA: input.sha,
    CI_COMMIT_SHORT_SHA: shortId(input.sha),
    CI_COMMIT_REF_NAME: refName,
    CI_COMMIT_BRANCH: refName,
    CI_COMMIT_MESSAGE: commit.message,
    CI_DEFAULT_BRANCH: input.project.default_branch,
    CI_PROJECT_ID: String(input.project.id),
    CI_PROJECT_PATH: input.project.path,
    CI_JOB_ID: '',
    CI_JOB_NAME: '',
    CI_JOB_STAGE: '',
    CI_MERGE_REQUEST_IID: mr === null ? '' : String(mr.iid),
    CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: mr === null ? '' : mr.source,
    CI_MERGE_REQUEST_TARGET_BRANCH_NAME: mr === null ? '' : mr.target,
    CI_TRAIN: input.source === 'train' ? 'true' : '',
    CI_ENVIRONMENT_NAME: '',
  };
}

export async function projectVariables(sql: Sql, projectId: number): Promise<Record<string, string>> {
  const rows = await sql.query<{ key: string; value: string }>(
    'select key, value from project_variables where project_id = $1',
    [projectId],
  );
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export async function createPipeline(t: Tx, input: CreateInput): Promise<CreateResult> {
  const files = await filesOfCommit(t.sql, input.project.id, input.sha);
  if (!files.has(mainConfigPath)) {
    return { created: false, reason: 'Pipeline not created: no pipeline config file.' };
  }
  const before =
    input.beforeSha === null || input.beforeSha === undefined
      ? new Map<string, string>()
      : await filesOfCommit(t.sql, input.project.id, input.beforeSha);
  const changed = input.source === 'web' ? [] : changedPaths(before, files);
  const row = await t.sql.one<{ id: string }>(
    `insert into pipelines (project_id, ref, sha, source, status, errors, variables, mr_iid, created_ms)
     values ($1, $2, $3, $4, 'created', '[]', $5, $6, $7) returning id`,
    [
      input.project.id,
      input.ref,
      input.sha,
      input.source,
      JSON.stringify(input.variables ?? {}),
      input.mrIid ?? null,
      nowMs(),
    ],
  );
  const pipelineId = Number(row?.id);
  const predefined = await predefinedVariables(t.sql, input, pipelineId);
  const ctx: ExpandContext = {
    files,
    predefined,
    projectVariables: await projectVariables(t.sql, input.project.id),
    runVariables: input.variables ?? {},
    changedFiles: changed,
    treePaths: [...files.keys()],
  };
  const expanded = expandConfig(ctx);
  if (expanded.workflowExcluded) {
    await t.sql.query('delete from pipelines where id = $1', [pipelineId]);
    return { created: false, reason: 'Pipeline not created: workflow rules excluded it.' };
  }
  if (!expanded.valid) {
    await t.sql.query("update pipelines set status = 'failed', errors = $2 where id = $1", [
      pipelineId,
      JSON.stringify(expanded.errors),
    ]);
    await emit(t, input.project.id, 'pipeline', {
      pipeline_id: pipelineId,
      status: 'failed',
      ref: input.ref,
      announcement: `Pipeline ${pipelineId} failed: config has errors`,
    });
    return { id: pipelineId };
  }
  if (expanded.jobs.length === 0) {
    await t.sql.query('delete from pipelines where id = $1', [pipelineId]);
    return { created: false, reason: 'Pipeline not created: no jobs matched.' };
  }
  const positions = graphPositions(expanded.jobs);
  for (const spec of expanded.jobs) {
    const place = positions.get(spec.name) ?? { layer: spec.stage_index, row: 0, x: 40, y: 40 };
    await t.sql.query(
      `insert into jobs (project_id, pipeline_id, name, stage, stage_index, config_order, status, spec, variables,
                         needs, layer, row_index, resource_group, log, workspace)
       values ($1, $2, $3, $4, $5, $6, 'created', $7, $8, $9, $10, $11, $12, '[]', '{}')`,
      [
        input.project.id,
        pipelineId,
        spec.name,
        spec.stage,
        spec.stage_index,
        spec.config_order,
        JSON.stringify(spec),
        JSON.stringify(spec.variables),
        spec.needs === null ? null : JSON.stringify(spec.needs),
        place.layer,
        place.row,
        spec.resource_group,
      ],
    );
  }
  if (input.source === 'push') {
    await cancelOlderPipelines(t, input.project, input.ref, pipelineId);
  }
  await settleStatuses(t, input.project, pipelineId);
  await emit(t, input.project.id, 'pipeline', { pipeline_id: pipelineId, ref: input.ref, status: 'running' });
  return { id: pipelineId };
}

export async function cancelOlderPipelines(
  t: Tx,
  project: ProjectRow,
  ref: string,
  newPipelineId: number,
): Promise<void> {
  const rows = await t.sql.query<{ id: string }>(
    `select id from pipelines
     where project_id = $1 and ref = $2 and source = 'push' and id < $3 and status not in ('success','failed','canceled','skipped')`,
    [project.id, ref, newPipelineId],
  );
  for (const row of rows) {
    const pipelineId = Number(row.id);
    const jobs = await jobsOfPipeline(t.sql, pipelineId);
    const blocked = jobs.some((job) => !job.spec.interruptible && job.started_ms !== null);
    if (blocked) continue;
    for (const job of jobs) {
      if (isFinished(job.status)) continue;
      await appendLog(t, job, 'sys', `Canceled by newer pipeline ${newPipelineId}.`);
      await t.sql.query("update jobs set status = 'canceled', finished_ms = $2 where id = $1", [job.id, nowMs()]);
      await appendLog(t, job, 'sys', 'Job finished: canceled');
    }
    await t.sql.query("update pipelines set status = 'canceled' where id = $1", [pipelineId]);
    await emit(t, project.id, 'pipeline', {
      pipeline_id: pipelineId,
      status: 'canceled',
      announcement: `Pipeline ${pipelineId} was canceled`,
    });
  }
}

export async function appendLog(t: Tx, job: { id: number; project_id: number }, stream: 'out' | 'sys', text: string): Promise<void> {
  await t.sql.query(
    `update jobs set log = log || $2::jsonb where id = $1`,
    [job.id, JSON.stringify([{ stream, text }])],
  );
  await emit(t, job.project_id, 'job_log', { job_id: job.id, stream, text });
}

export function formatLogLines(log: { stream: string; text: string }[]): string[] {
  return log.map((entry, index) => `${index + 1} ${entry.stream} ${entry.text}`);
}

export function durationText(job: JobRow): string {
  if (job.started_ms === null) return 'not started';
  if (job.finished_ms === null) return 'in progress';
  const seconds = Math.round((job.finished_ms - job.started_ms) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export async function updatePipelineStatus(t: Tx, pipelineId: number): Promise<string> {
  const jobs = await jobsOfPipeline(t.sql, pipelineId);
  const status = rollup(jobs);
  const current = await loadPipeline(t.sql, pipelineId);
  if (current !== null && current.status !== status) {
    await t.sql.query('update pipelines set status = $2 where id = $1', [pipelineId, status]);
  }
  return status;
}

export async function pipelineJson(sql: Sql, pipelineId: number): Promise<Record<string, unknown> | null> {
  const pipeline = await loadPipeline(sql, pipelineId);
  if (pipeline === null) return null;
  const jobs = await jobsOfPipeline(sql, pipelineId);
  const stageNames: string[] = [];
  for (const job of jobs) {
    if (!stageNames.includes(job.stage)) stageNames.push(job.stage);
  }
  return {
    id: pipeline.id,
    ref: pipeline.ref,
    sha: pipeline.sha,
    source: pipeline.source,
    status: pipeline.status,
    errors: pipeline.errors,
    stages: stageNames.map((name) => ({
      name,
      status: rollup(jobs.filter((job) => job.stage === name)),
    })),
    jobs: jobs.map((job) => ({
      id: job.id,
      name: job.name,
      stage: job.stage,
      status: job.status,
      attempt: job.attempt,
      retried: job.retried,
      failure_reason: job.failure_reason,
      layer: job.layer,
      row: job.row_index,
      x: 40 + job.layer * 240,
      y: 40 + job.row_index * 96,
      needs: job.needs ?? [],
      duration: durationText(job),
      started_at: job.started_ms === null ? null : new Date(job.started_ms).toISOString(),
      finished_at: job.finished_ms === null ? null : new Date(job.finished_ms).toISOString(),
      start_at: job.start_at_ms === null ? null : new Date(job.start_at_ms).toISOString(),
    })),
  };
}

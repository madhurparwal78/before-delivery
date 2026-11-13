// Job and pipeline state changes outside the script runner: becoming ready, skipping, retrying, playing, canceling,
// and the stage and pipeline status that follows (DP-25).
import { now } from "../clock.ts";
import type { Say } from "../db.ts";
import { onPipelineChanged as requestsOnPipelineChanged } from "../mr/index.ts";
import { onPipelineChanged as trainOnPipelineChanged } from "../train/index.ts";
import { expandVariables } from "./config/expand.ts";
import type { CiContext } from "./context.ts";
import { openDeployment, syncDeployment } from "./deployments.ts";
import { announceJobChange, JobLog, updateJob, uploadLog, type JobPatch } from "./jobstore.ts";
import { clearWorkspace } from "./files.ts";
import {
  latestJobsOf, loadPipeline,
  type JobRow, type PipelineRow,
} from "./rows.ts";
import { isFinished, judge, rollup, statusFor, type GraphJob, type JobStatus } from "./status.ts";
import { jobVariables, projectVariables } from "./variables.ts";

const sayPages = (job: Pick<JobRow, "id" | "pipeline_id">): string[] => [`pipeline:${job.pipeline_id}`, `job:${job.id}`];

function jobSay(job: JobRow): Say[] {
  if (job.status === "running") return [{ text: `Job ${job.name} started`, pages: sayPages(job) }];
  if (job.status === "success") return [{ text: `Job ${job.name} succeeded`, pages: sayPages(job) }];
  if (job.status === "failed") return [{ text: `Job ${job.name} failed`, pages: sayPages(job) }];
  return [];
}

/** Writes a job's new state, tells the pages, and keeps its deployment in step. */
export async function transition(ctx: CiContext, job: JobRow, patch: JobPatch & { status: JobStatus }): Promise<JobRow> {
  const next = await updateJob(ctx.tx, job.id, patch);
  ctx.touched.set(next.id, { id: next.id, name: next.name, status: next.status });
  await ctx.emit("job", { pipeline_id: next.pipeline_id, job_id: next.id, name: next.name, status: next.status }, next.status === job.status ? undefined : jobSay(next));
  announceJobChange(ctx, next.id);
  if (next.status !== job.status) await syncDeployment(ctx, next);
  return next;
}

export async function insertJobs(ctx: CiContext, pipeline: PipelineRow, specs: readonly JobRow["spec"][]): Promise<void> {
  for (const [order, spec] of specs.entries()) {
    await ctx.tx.q(
      `INSERT INTO ci_jobs (pipeline_id, project_id, name, stage, stage_index, config_order, status, spec, actor_id, actor_name, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'created', $7::jsonb, $8, $9, $10)`,
      [pipeline.id, pipeline.project_id, spec.name, spec.stage, spec.stageIndex, order, JSON.stringify(spec), pipeline.actor_id, pipeline.actor_name, now()],
    );
  }
}

async function makeReady(ctx: CiContext, pipeline: PipelineRow, job: JobRow, shared: Readonly<Record<string, string>>): Promise<JobRow> {
  let status: "pending" | "manual" | "scheduled" = statusFor(job.spec.when);
  const environment = job.spec.environment;
  if (environment !== null && environment.action === "start") {
    const name = expandVariables(environment.name, jobVariables(pipeline, job, shared));
    const gated = await openDeployment(ctx, job, pipeline, jobVariables(pipeline, job, shared, name));
    if (gated) status = "manual";
  }
  if (status === "scheduled") return transition(ctx, job, { status, start_at: now() + (job.spec.startInMs ?? 0) });
  return transition(ctx, job, { status });
}

function graphOf(jobs: readonly JobRow[]): GraphJob[] {
  return jobs.map((job) => ({ name: job.name, stageIndex: job.stage_index, status: job.status, allowFailure: job.spec.allowFailure }));
}

async function cloneAttempt(ctx: CiContext, pipeline: PipelineRow, old: JobRow, automatic: boolean, vars: Readonly<Record<string, string>>): Promise<JobRow> {
  const retiredOld = await updateJob(ctx.tx, old.id, { retried: true });
  await ctx.emit("job", { pipeline_id: old.pipeline_id, job_id: old.id, name: old.name, status: retiredOld.status });
  const next = await ctx.tx.one<JobRow>(
    `INSERT INTO ci_jobs (pipeline_id, project_id, name, stage, stage_index, config_order, status, attempt, auto_retries, spec, play_variables, actor_id, actor_name, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13) RETURNING *`,
    [
      old.pipeline_id, old.project_id, old.name, old.stage, old.stage_index, old.config_order, old.attempt + 1,
      automatic ? old.auto_retries + 1 : 0, JSON.stringify(old.spec), JSON.stringify(old.play_variables),
      automatic ? old.actor_id : ctx.actorId, automatic ? old.actor_name : ctx.actor, now(),
    ],
  );
  ctx.touched.set(next.id, { id: next.id, name: next.name, status: next.status });
  const environment = next.spec.environment;
  if (environment !== null && environment.action === "start") {
    const name = expandVariables(environment.name, jobVariables(pipeline, next, vars));
    await openDeployment(ctx, next, pipeline, jobVariables(pipeline, next, vars, name), true);
  }
  await ctx.emit("job", { pipeline_id: next.pipeline_id, job_id: next.id, name: next.name, status: next.status });
  announceJobChange(ctx, next.id);
  return next;
}

function mayRetry(ctx: CiContext, job: JobRow): boolean {
  const reason = job.failure_reason;
  if (job.retried || (job.status !== "failed" && job.status !== "warning") || reason === null) return false;
  if (ctx.noRetry.has(job.pipeline_id)) return false;
  const rule = job.spec.retry;
  return job.auto_retries < rule.max && rule.when.some((when) => when === reason);
}

/** Step 4 for one pipeline: ready jobs move on, automatic retries appear, and the pipeline status follows. */
export async function refreshPipeline(ctx: CiContext, pipelineId: number, announceCreation = false): Promise<void> {
  const pipeline = await loadPipeline(ctx.tx, pipelineId);
  if (pipeline === undefined) return;
  if (pipeline.errors.length === 0) {
    const shared = await projectVariables(ctx.tx, ctx.project.id);
    for (let pass = 0; pass < 100; pass++) {
      const jobs = await latestJobsOf(ctx.tx, pipelineId);
      const graph = graphOf(jobs);
      let moved = false;
      for (const [index, job] of jobs.entries()) {
        if (job.status === "created") {
          const verdict = judge({ stageIndex: job.stage_index, needs: job.spec.needs, when: job.spec.when }, graph);
          if (verdict === "wait") continue;
          const next = verdict === "skip" ? await transition(ctx, job, { status: "skipped" }) : await makeReady(ctx, pipeline, job, shared);
          const entry = graph[index];
          if (entry !== undefined) graph[index] = { ...entry, status: next.status };
          moved = true;
        } else if (mayRetry(ctx, job)) {
          await cloneAttempt(ctx, pipeline, job, true, shared);
          moved = true;
        }
      }
      if (!moved) break;
    }
  }
  await settlePipelineStatus(ctx, pipelineId, announceCreation);
}

async function settlePipelineStatus(ctx: CiContext, pipelineId: number, force: boolean): Promise<void> {
  const pipeline = await loadPipeline(ctx.tx, pipelineId);
  if (pipeline === undefined) return;
  const jobs = await latestJobsOf(ctx.tx, pipelineId);
  const status = pipeline.errors.length > 0 ? "failed" : jobs.length === 0 ? pipeline.status : rollup(jobs.map((job) => ({ status: job.status, allowFailure: job.spec.allowFailure })));
  if (status === pipeline.status && !force) return;
  const finished = isFinished(status);
  await ctx.tx.q("UPDATE ci_pipelines SET status = $2, finished_at = $3 WHERE id = $1", [pipelineId, status, finished ? (pipeline.finished_at ?? now()) : null]);
  const failedJob = jobs.find((job) => job.status === "failed");
  let say: Say[] = [];
  if (status === "failed" && pipeline.errors.length > 0) say = [{ text: `Pipeline ${pipelineId} failed: config has errors`, pages: [`pipeline:${pipelineId}`] }];
  else if (status === "failed" && failedJob !== undefined) say = [{ text: `Pipeline ${pipelineId} failed: job ${failedJob.name}`, pages: [`pipeline:${pipelineId}`] }];
  else if (status === "success") say = [{ text: `Pipeline ${pipelineId} succeeded`, pages: [`pipeline:${pipelineId}`] }];
  else if (status === "canceled") say = [{ text: `Pipeline ${pipelineId} was canceled`, pages: [`pipeline:${pipelineId}`] }];
  await ctx.emit("pipeline", { pipeline_id: pipelineId, status, ref: pipeline.ref, sha: pipeline.sha, iids: pipeline.mr_iids }, status === pipeline.status ? undefined : say);
  if (ctx.quiet) return;
  if (finished && status !== pipeline.status) {
    await ctx.webhook("pipeline", { pipeline: { id: pipelineId, ref: pipeline.ref, sha: pipeline.sha, status, source: pipeline.source } });
  }
  await requestsOnPipelineChanged(ctx.tx, ctx.project, pipelineId);
  if (finished && !ctx.skipTrain.has(pipelineId)) await trainOnPipelineChanged(ctx.tx, ctx.project, pipelineId);
}

export async function refreshOpenPipelines(ctx: CiContext): Promise<void> {
  const open = await ctx.tx.q<{ id: number }>(
    "SELECT id FROM ci_pipelines WHERE project_id = $1 AND status NOT IN ('success', 'failed', 'canceled', 'skipped', 'warning') ORDER BY id",
    [ctx.project.id],
  );
  for (const { id } of open) await refreshPipeline(ctx, id);
}

/** Ends an unfinished job as canceled; `reason`, when given, is the last log line before `Job finished: canceled`. */
export async function cancelJob(ctx: CiContext, job: JobRow, reason: string | null): Promise<JobRow> {
  if (isFinished(job.status)) return job;
  const log = new JobLog(job);
  if (reason !== null) log.sys(reason);
  log.sys("Job finished: canceled");
  await log.flush(ctx, job);
  const sealed = await uploadLog(ctx.tx, job.id);
  const next = await transition(ctx, job, { status: "canceled", finished_at: now(), log_sealed: sealed });
  await clearWorkspace(ctx.tx, job.id);
  return next;
}

/** Cancels every unfinished job of a pipeline. */
export async function cancelPipelineJobs(ctx: CiContext, pipelineId: number, reason: string | null): Promise<void> {
  ctx.noRetry.add(pipelineId);
  for (const job of await latestJobsOf(ctx.tx, pipelineId)) await cancelJob(ctx, job, reason);
  await refreshPipeline(ctx, pipelineId);
}

/** Makes a manual job pending at once (play), or a finished one a fresh pending attempt. */
export async function enqueueJob(ctx: CiContext, job: JobRow, variables: Readonly<Record<string, string>> = {}): Promise<JobRow> {
  const pipeline = await loadPipeline(ctx.tx, job.pipeline_id);
  if (pipeline === undefined) return job;
  let next: JobRow;
  if (job.status === "manual") {
    next = await transition(ctx, job, { status: "pending", play_variables: { ...job.play_variables, ...variables }, actor_id: ctx.actorId, actor_name: ctx.actor });
  } else if (isFinished(job.status)) {
    next = await cloneAttempt(ctx, pipeline, { ...job, play_variables: { ...job.play_variables, ...variables } }, false, await projectVariables(ctx.tx, ctx.project.id));
  } else {
    return job;
  }
  await refreshPipeline(ctx, pipeline.id);
  return next;
}

/** `Retry job`: any finished job becomes a new pending attempt, whatever its status. */
export async function retryJob(ctx: CiContext, job: JobRow): Promise<JobRow> {
  const pipeline = await loadPipeline(ctx.tx, job.pipeline_id);
  if (pipeline === undefined) return job;
  const next = await cloneAttempt(ctx, pipeline, job, false, await projectVariables(ctx.tx, ctx.project.id));
  await refreshPipeline(ctx, pipeline.id);
  return next;
}

/** `Retry pipeline`: failed and canceled jobs get new attempts; skipped jobs go back to `created`. */
export async function retryPipeline(ctx: CiContext, pipelineId: number): Promise<void> {
  const pipeline = await loadPipeline(ctx.tx, pipelineId);
  if (pipeline === undefined) return;
  const shared = await projectVariables(ctx.tx, ctx.project.id);
  ctx.noRetry.delete(pipelineId);
  for (const job of await latestJobsOf(ctx.tx, pipelineId)) {
    if (job.status === "failed" || job.status === "canceled") await cloneAttempt(ctx, pipeline, job, false, shared);
    else if (job.status === "skipped") await transition(ctx, job, { status: "created" });
  }
  await refreshPipeline(ctx, pipelineId);
}

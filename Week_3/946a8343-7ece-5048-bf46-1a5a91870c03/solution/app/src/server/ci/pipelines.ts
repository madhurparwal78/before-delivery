// Pipeline creation from `spurline.pipeline.yml` (DP-23, DP-25), the push hook, lint, and pipeline lookups.
import type { ProjectRow } from "../access.ts";
import { config } from "../config.ts";
import { now } from "../clock.ts";
import type { Queryable, Tx } from "../db.ts";
import { branchHead, changedFiles, getCommit, listPaths, readFile, resolveRef } from "../repo/index.ts";
import type { BranchUpdate, Person, PipelineOutcome } from "../repo/types.ts";
import { findMergeRequest } from "../mr/index.ts";
import { resolvePipelineConfig } from "./config/resolve.ts";
import type { ConfigResult, ResolveOptions } from "./config/types.ts";
import { CiContext } from "./context.ts";
import { cancelPipelineJobs, insertJobs, refreshPipeline } from "./lifecycle.ts";
import { loadPipeline } from "./rows.ts";
import { timeOutPipeline } from "./scheduler.ts";
import { FINISHED_STATUSES } from "./status.ts";
import { projectVariables } from "./variables.ts";

const CONFIG_PATH = "spurline.pipeline.yml";

interface CreatePipelineInput {
  readonly project: ProjectRow;
  readonly ref: string;
  readonly sha: string;
  readonly source: "push" | "train" | "web";
  readonly actor: Person;
  readonly variables?: Readonly<Record<string, string>>;
  /** For train pipelines: the target branch (CI_COMMIT_REF_NAME) and the car's request iid. */
  readonly trainTarget?: string;
  readonly mergeRequestIid?: number;
  /** Commit that `changes` rules compare against (train: merge base with the target; push: previous head). */
  readonly changesBase?: string | null;
}

type Source = (path: string) => Promise<string | null>;

/** Resolves a config whose included files are fetched on demand (the engine reads them synchronously). */
async function resolveWithFiles(options: Omit<ResolveOptions, "load">, fetch: Source): Promise<ConfigResult> {
  const known = new Map<string, string | null>();
  for (let attempt = 0; attempt < 64; attempt++) {
    const missing = new Set<string>();
    const result = resolvePipelineConfig({
      ...options,
      load: (path) => {
        if (known.has(path)) return known.get(path) ?? null;
        missing.add(path);
        return null;
      },
    });
    if (missing.size === 0) return result;
    for (const path of missing) known.set(path, await fetch(path));
  }
  return resolvePipelineConfig({ ...options, load: (path) => known.get(path) ?? null });
}

interface OpenRequest {
  readonly iid: number;
  readonly source: string;
  readonly target: string;
}

async function openRequestsFrom(q: Queryable, projectId: number, branch: string): Promise<OpenRequest[]> {
  return q.q<OpenRequest>("SELECT iid, source, target FROM merge_requests WHERE project_id = $1 AND source = $2 AND state = 'opened' ORDER BY iid", [projectId, branch]);
}

const rejected = (reason: string): PipelineOutcome => ({ created: false, reason });

async function changedPaths(q: Queryable, projectId: number, base: string | null | undefined, sha: string): Promise<string[] | null> {
  if (base === undefined || base === null) return null;
  const changes = await changedFiles(q, projectId, base, sha);
  return changes.flatMap((change) => (change.oldPath === null ? [change.path] : [change.path, change.oldPath]));
}

export async function createPipeline(tx: Tx, input: CreatePipelineInput, quiet = false): Promise<PipelineOutcome> {
  const { project, sha, source } = input;
  const text = await readFile(tx, project.id, sha, CONFIG_PATH);
  if (text === null) return rejected("Pipeline not created: no pipeline config.");
  const commit = await getCommit(tx, project.id, sha);
  const id = (await tx.one<{ id: number }>("SELECT nextval(pg_get_serial_sequence('ci_pipelines', 'id'))::int AS id")).id;
  const isTrain = source === "train";
  const branch = isTrain ? (input.trainTarget ?? input.ref) : ((await branchHead(tx, project.id, input.ref)) === null ? "" : input.ref);
  const refName = isTrain ? (input.trainTarget ?? input.ref) : input.ref;
  const requests = isTrain ? [] : await openRequestsFrom(tx, project.id, input.ref);
  const trainRequest = isTrain && input.mergeRequestIid !== undefined ? await findMergeRequest(tx, project.id, input.mergeRequestIid) : undefined;
  const lead = requests[0];
  const predefined: Record<string, string> = {
    CI_PIPELINE_ID: String(id),
    CI_PIPELINE_SOURCE: source,
    CI_COMMIT_SHA: sha,
    CI_COMMIT_SHORT_SHA: sha.slice(0, 7),
    CI_COMMIT_REF_NAME: refName,
    CI_COMMIT_BRANCH: branch,
    CI_COMMIT_MESSAGE: commit?.message ?? "",
    CI_DEFAULT_BRANCH: project.default_branch,
    CI_PROJECT_ID: String(project.id),
    CI_PROJECT_PATH: project.path,
    CI_MERGE_REQUEST_IID: String(trainRequest?.iid ?? lead?.iid ?? ""),
    CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: trainRequest?.source ?? lead?.source ?? "",
    CI_MERGE_REQUEST_TARGET_BRANCH_NAME: trainRequest?.target ?? lead?.target ?? "",
    CI_TRAIN: isTrain ? "true" : "",
  };
  const run = input.variables ?? {};
  const actorId = input.actor.id > 0 ? input.actor.id : null;
  const resolved = await resolveWithFiles(
    {
      mainPath: CONFIG_PATH,
      content: text,
      predefined,
      variables: { ...(await projectVariables(tx, project.id)), ...run },
      changedFiles: await changedPaths(tx, project.id, input.changesBase, sha),
      treeFiles: await listPaths(tx, project.id, sha),
      retryMax: config.retryMax,
      defaultTimeoutMs: config.jobTimeoutMs,
    },
    (path) => readFile(tx, project.id, sha, path),
  );
  if (resolved.errors.length === 0) {
    if (!resolved.workflowPasses) return rejected("Pipeline not created: workflow rules excluded it.");
    if (resolved.jobs.length === 0) return rejected("Pipeline not created: no jobs matched.");
  }
  await tx.q(
    `INSERT INTO ci_pipelines (id, project_id, ref, sha, source, status, errors, actor_id, actor_name, run_variables, predefined, mr_iids, created_at)
     VALUES ($1, $2, $3, $4, $5, 'created', $6::jsonb, $7, $8, $9::jsonb, $10::jsonb, $11, $12)`,
    [id, project.id, input.ref, sha, source, JSON.stringify(resolved.errors), actorId, input.actor.username, JSON.stringify(run), JSON.stringify(predefined), requests.map((request) => request.iid), now()],
  );
  const pipeline = await loadPipeline(tx, id);
  if (pipeline === undefined) throw new Error("pipeline was not stored");
  const ctx = new CiContext(tx, project, input.actor.username, actorId, quiet);
  await insertJobs(ctx, pipeline, resolved.jobs);
  await refreshPipeline(ctx, id, true);
  return { id };
}

/** CI part of the push transaction. */
export async function onBranchPushed(tx: Tx, update: BranchUpdate): Promise<PipelineOutcome> {
  const outcome = await createPipeline(tx, {
    project: update.project,
    ref: update.branch,
    sha: update.newHead,
    source: "push",
    actor: update.actor,
    changesBase: update.oldHead,
  });
  if ("id" in outcome) await cancelSupersededPipelines(tx, update.project, update.branch, outcome.id, update.actor);
  return outcome;
}

/** Older push pipelines of a branch in which no job that may not be interrupted has started lose their unfinished jobs. */
async function cancelSupersededPipelines(tx: Tx, project: ProjectRow, branch: string, newId: number, actor: Person): Promise<void> {
  const older = await tx.q<{ id: number }>(
    `SELECT p.id FROM ci_pipelines p
      WHERE p.project_id = $1 AND p.ref = $2 AND p.source = 'push' AND p.id < $3 AND p.status <> ALL($4::text[])
        AND NOT EXISTS (SELECT 1 FROM ci_jobs j WHERE j.pipeline_id = p.id AND j.started_at IS NOT NULL AND NOT (j.spec->>'interruptible')::boolean)
      ORDER BY p.id`,
    [project.id, branch, newId, [...FINISHED_STATUSES]],
  );
  const ctx = new CiContext(tx, project, actor.username, actor.id);
  for (const { id } of older) await cancelPipelineJobs(ctx, id, `Canceled by newer pipeline ${newId}.`);
}

/** Cancels the unfinished jobs of a pipeline, logging `reason` as each job's last line before `Job finished: canceled`. */
export async function cancelPipeline(tx: Tx, pipelineId: number, reason: string | null, actor: Person | null = null): Promise<void> {
  const pipeline = await loadPipeline(tx, pipelineId);
  if (pipeline === undefined) return;
  const project = await tx.one<ProjectRow>("SELECT * FROM projects WHERE id = $1", [pipeline.project_id]);
  const ctx = new CiContext(tx, project, actor?.username ?? "system", actor?.id ?? null);
  await cancelPipelineJobs(ctx, pipelineId, reason);
}

/** A train car whose pipeline did not finish in time: its unfinished jobs fail as `job_timeout`. */
export async function failPipelineForTimeout(tx: Tx, pipelineId: number): Promise<void> {
  const pipeline = await loadPipeline(tx, pipelineId);
  if (pipeline === undefined) return;
  const project = await tx.one<ProjectRow>("SELECT * FROM projects WHERE id = $1", [pipeline.project_id]);
  await timeOutPipeline(new CiContext(tx, project, "system"), pipelineId);
}

export interface PipelineBrief {
  readonly id: number;
  readonly status: string;
  readonly sha: string;
  readonly source: string;
}

export async function latestPipelineOnCommit(q: Queryable, projectId: number, sha: string): Promise<PipelineBrief | null> {
  const row = await q.maybe<PipelineBrief>(
    "SELECT id, status, sha, source FROM ci_pipelines WHERE project_id = $1 AND sha = $2 AND source <> 'train' ORDER BY id DESC LIMIT 1",
    [projectId, sha],
  );
  return row ?? null;
}

export async function getPipelineBrief(q: Queryable, pipelineId: number): Promise<PipelineBrief | null> {
  const row = await q.maybe<PipelineBrief>("SELECT id, status, sha, source FROM ci_pipelines WHERE id = $1", [pipelineId]);
  return row ?? null;
}

interface LintBody {
  readonly content: string;
  readonly ref: string | null;
  readonly variables: Readonly<Record<string, string>>;
  readonly changedFiles: readonly string[] | null;
}

interface LintResult {
  readonly valid: boolean;
  readonly errors: string[];
  readonly summary: string;
  readonly jobs: { name: string; stage: string; variables: Record<string, string> }[];
}

export async function lintConfig(q: Queryable, project: ProjectRow, body: LintBody): Promise<LintResult> {
  const sha = body.ref === null ? null : await resolveRef(q, project.id, body.ref);
  const branch = body.ref !== null && sha !== null && (await branchHead(q, project.id, body.ref)) !== null ? body.ref : "";
  const predefined: Record<string, string> = {
    CI_PIPELINE_SOURCE: "web",
    CI_COMMIT_REF_NAME: body.ref ?? "",
    CI_COMMIT_BRANCH: branch,
    CI_COMMIT_SHA: sha ?? "",
    CI_COMMIT_SHORT_SHA: sha?.slice(0, 7) ?? "",
    CI_DEFAULT_BRANCH: project.default_branch,
    CI_PROJECT_ID: String(project.id),
    CI_PROJECT_PATH: project.path,
    CI_TRAIN: "",
  };
  const result = await resolveWithFiles(
    {
      mainPath: CONFIG_PATH,
      content: body.content,
      predefined,
      variables: { ...(await projectVariables(q, project.id)), ...body.variables },
      changedFiles: body.changedFiles,
      treeFiles: sha === null ? [] : await listPaths(q, project.id, sha),
      retryMax: config.retryMax,
      defaultTimeoutMs: config.jobTimeoutMs,
    },
    async (path) => (sha === null ? null : readFile(q, project.id, sha, path)),
  );
  const valid = result.errors.length === 0;
  return {
    valid,
    errors: result.errors,
    summary: valid ? result.summary : "",
    jobs: valid ? result.jobs.map((job) => ({ name: job.name, stage: job.stage, variables: job.variables })) : [],
  };
}

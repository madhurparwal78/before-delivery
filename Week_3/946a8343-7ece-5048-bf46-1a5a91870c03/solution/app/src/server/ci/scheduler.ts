// The scheduler round (DP-25): timeouts and delayed jobs, starts, one turn per running job, log sealing, statuses.
import { config } from "../config.ts";
import { now } from "../clock.ts";
import { db, withTx, type Tx } from "../db.ts";
import { findProject } from "../access.ts";
import { onRound } from "../deadlines.ts";
import { readFile } from "../repo/index.ts";
import { StorageUnavailable } from "../s3.ts";
import { expandVariables } from "./config/expand.ts";
import { parseCommand } from "./commands.ts";
import { CiContext } from "./context.ts";
import { outdatedText } from "./deployments.ts";
import {
  clearWorkspace, downloadDependencies, putWorkspaceFile, restoreCache, saveCache, storeReports, uploadArtifacts, workspaceFile,
} from "./files.ts";
import { JobLog, announceJobChange, updateJob, uploadLog } from "./jobstore.ts";
import { refreshOpenPipelines, refreshPipeline, transition } from "./lifecycle.ts";
import { parseReport } from "./report-data.ts";
import { syncRequestsOnHead } from "./request-reports.ts";
import { latestJobsOf, loadPipeline, type JobRow, type PipelineRow } from "./rows.ts";
import { isFinished } from "./status.ts";
import { jobVariables, projectVariables } from "./variables.ts";

const ORDER = "ORDER BY pipeline_id, stage_index, config_order, id";

interface Shared {
  readonly variables: Readonly<Record<string, string>>;
  readonly pipelines: Map<number, PipelineRow>;
}

async function pipelineOf(ctx: CiContext, shared: Shared, id: number): Promise<PipelineRow> {
  const known = shared.pipelines.get(id);
  if (known !== undefined) return known;
  const loaded = await loadPipeline(ctx.tx, id);
  if (loaded === undefined) throw new Error(`pipeline ${id} is missing`);
  shared.pipelines.set(id, loaded);
  return loaded;
}

function varsOf(job: JobRow, pipeline: PipelineRow, shared: Shared): Record<string, string> {
  const spec = job.spec.environment;
  const name = spec === null ? null : expandVariables(spec.name, jobVariables(pipeline, job, shared.variables));
  return jobVariables(pipeline, job, shared.variables, name);
}

/** Failing or finishing without a script turn: logs the closing line, seals the log, ends the job. */
async function endJob(ctx: CiContext, job: JobRow, log: JobLog, status: "success" | "failed" | "warning", reason: string | null): Promise<void> {
  log.sys(`Job finished: ${status}`);
  await log.flush(ctx, job);
  ctx.sealTried.add(job.id);
  const sealed = await uploadLog(ctx.tx, job.id);
  await transition(ctx, job, { status, finished_at: now(), failure_reason: reason, log_sealed: sealed });
  await clearWorkspace(ctx.tx, job.id);
}

/** A failed job that may fail is a `warning`; an outdated deployment never is. */
const failedStatus = (job: JobRow, reason: string): "failed" | "warning" =>
  job.spec.allowFailure && reason !== "outdated_deployment" ? "warning" : "failed";

async function failEarly(ctx: CiContext, job: JobRow, log: JobLog, reason: string): Promise<void> {
  await endJob(ctx, job, log, failedStatus(job, reason), reason);
}

async function startJob(ctx: CiContext, shared: Shared, pending: JobRow): Promise<void> {
  const pipeline = await pipelineOf(ctx, shared, pending.pipeline_id);
  let job = await transition(ctx, pending, { status: "running", started_at: now(), pc: 0, wait_started_at: null, wait_ms: 0 });
  const log = new JobLog(job);
  const outdated = await outdatedText(ctx.tx, job);
  if (outdated !== null) {
    log.sys(outdated);
    await failEarly(ctx, job, log, "outdated_deployment");
    return;
  }
  const vars = varsOf(job, pipeline, shared);
  await restoreCache(ctx.tx, job, vars, log);
  const downloads = await downloadDependencies(ctx.tx, job, log);
  if (!downloads.ok) {
    await failEarly(ctx, job, log, "system_failure");
    return;
  }
  if (downloads.downloadedFrom.length > 0) job = await updateJob(ctx.tx, job.id, { downloaded_from: downloads.downloadedFrom });
  log.sys("section_start script");
  await log.flush(ctx, job);
}

/** The script is over (all commands ran, `exit`, or a failing command): the finishing work of the turn. */
async function finishScript(ctx: CiContext, shared: Shared, job: JobRow, log: JobLog, failure: string | null): Promise<void> {
  const pipeline = await pipelineOf(ctx, shared, job.pipeline_id);
  const vars = varsOf(job, pipeline, shared);
  let reason = failure;
  log.sys("section_end script");
  const when = job.spec.artifacts?.when;
  const ok = failure === null;
  if (when === "always" || (ok && when === "on_success") || (!ok && when === "on_failure")) {
    const stored = await uploadArtifacts(ctx.tx, job, vars, log);
    if (!stored && ok) reason = "system_failure";
  }
  if (!(await storeReports(ctx.tx, job)) && reason === null) {
    log.sys("Artifact upload failed: file storage is unavailable.");
    reason = "system_failure";
  } else if (!ctx.quiet && job.emitted.some((report) => report.kind === "security")) {
    await syncRequestsOnHead(ctx.tx, ctx.project, pipeline);
  }
  if (reason === null) await saveCache(ctx.tx, job, vars, log);
  const status = reason === null ? "success" : failedStatus(job, reason);
  await endJob(ctx, job, log, status, reason);
}

async function readEmitted(ctx: CiContext, job: JobRow, pipeline: PipelineRow, path: string): Promise<string | null> {
  const written = await workspaceFile(ctx.tx, job.id, path);
  if (written !== null) return written;
  try {
    return await readFile(ctx.tx, job.project_id, pipeline.sha, path);
  } catch (error) {
    if (error instanceof StorageUnavailable) return null;
    throw error;
  }
}

/** One turn of a running job: the next command, or the end of a wait. */
async function turn(ctx: CiContext, shared: Shared, running: JobRow): Promise<void> {
  const script = running.spec.script;
  const log = new JobLog(running);
  if (running.wait_started_at !== null) {
    if (now() < running.wait_started_at + running.wait_ms) return;
    const job = await updateJob(ctx.tx, running.id, { pc: running.pc + 1, wait_started_at: null, wait_ms: 0 });
    ctx.changed = true;
    if (job.pc >= script.length) await finishScript(ctx, shared, job, log, null);
    return;
  }
  const pipeline = await pipelineOf(ctx, shared, running.pipeline_id);
  const command = parseCommand(expandVariables(script[running.pc] ?? "", varsOf(running, pipeline, shared)));
  let failure: string | null = null;
  let finished = false;
  let job = running;
  switch (command.kind) {
    case "print":
      log.out(command.text);
      break;
    case "write":
      await putWorkspaceFile(ctx.tx, job.id, command.path, `${command.text}\n`, "write");
      log.sys(`Wrote ${command.path}`);
      break;
    case "wait":
      log.sys(`Waiting ${command.ms} ms`);
      job = await updateJob(ctx.tx, job.id, { wait_started_at: now(), wait_ms: command.ms });
      await log.flush(ctx, job);
      ctx.changed = true;
      return;
    case "exit":
      log.sys(`Exit code ${command.code}`);
      finished = true;
      if (command.code !== 0) failure = "script_failure";
      break;
    case "emit": {
      const text = await readEmitted(ctx, job, pipeline, command.path);
      if (text === null || parseReport(command.report, text) === null) {
        log.sys(`Report ${command.path} is not valid ${command.report} JSON.`);
        failure = "script_failure";
        finished = true;
      } else {
        log.sys(`Stored ${command.report} report from ${command.path}`);
        job = await updateJob(ctx.tx, job.id, { emitted: [...job.emitted, { kind: command.report, path: command.path, content: text }] });
      }
      break;
    }
    case "unknown":
      log.sys(`Unknown command: ${command.text}`);
      failure = "script_failure";
      finished = true;
      break;
  }
  job = await updateJob(ctx.tx, job.id, { pc: job.pc + 1 });
  ctx.changed = true;
  if (finished || job.pc >= script.length) {
    await finishScript(ctx, shared, job, log, failure);
    return;
  }
  await log.flush(ctx, job);
}

async function timeOut(ctx: CiContext, job: JobRow): Promise<void> {
  const log = new JobLog(job);
  log.sys("Job exceeded its time limit.");
  await failEarly(ctx, job, log, "job_timeout");
}

/** Fails every unfinished job of a pipeline as timed out (a train car that did not finish in time). */
export async function timeOutPipeline(ctx: CiContext, pipelineId: number): Promise<void> {
  ctx.noRetry.add(pipelineId);
  ctx.skipTrain.add(pipelineId);
  for (const job of await latestJobsOf(ctx.tx, pipelineId)) {
    if (!isFinished(job.status)) await timeOut(ctx, job);
  }
  await refreshPipeline(ctx, pipelineId);
}

async function sealWaiting(ctx: CiContext): Promise<void> {
  const rows = await ctx.tx.q<JobRow>("SELECT * FROM ci_jobs WHERE project_id = $1 AND finished_at IS NOT NULL AND NOT log_sealed ORDER BY id", [ctx.project.id]);
  for (const job of rows) {
    if (ctx.sealTried.has(job.id)) continue;
    if (!(await uploadLog(ctx.tx, job.id))) continue;
    const sealed = await updateJob(ctx.tx, job.id, { log_sealed: true });
    await ctx.emit("job", { pipeline_id: sealed.pipeline_id, job_id: sealed.id, name: sealed.name, status: sealed.status });
    announceJobChange(ctx, sealed.id);
  }
}

async function round(ctx: CiContext): Promise<void> {
  const shared: Shared = { variables: await projectVariables(ctx.tx, ctx.project.id), pipelines: new Map() };
  const pid = ctx.project.id;
  const stamp = now();
  // 1. delayed jobs that are due, and running jobs past their time limit
  const due = await ctx.tx.q<JobRow>("SELECT * FROM ci_jobs WHERE project_id = $1 AND status = 'scheduled' AND start_at <= $2 ORDER BY id", [pid, stamp]);
  for (const job of due) await transition(ctx, job, { status: "pending" });
  const running = await ctx.tx.q<JobRow>("SELECT * FROM ci_jobs WHERE project_id = $1 AND status = 'running' ORDER BY id", [pid]);
  for (const job of running) {
    const limit = job.spec.timeoutMs ?? config.jobTimeoutMs;
    if (job.started_at !== null && stamp > job.started_at + limit) await timeOut(ctx, job);
  }
  // 2. start pending jobs in order while there is room
  const busy = await ctx.tx.q<{ grp: string | null }>(
    "SELECT spec->>'resourceGroup' AS grp FROM ci_jobs WHERE project_id = $1 AND status = 'running'",
    [pid],
  );
  let count = busy.length;
  const groups = new Set(busy.flatMap((row) => (row.grp === null ? [] : [row.grp])));
  const pending = await ctx.tx.q<JobRow>(`SELECT * FROM ci_jobs WHERE project_id = $1 AND status = 'pending' ${ORDER}`, [pid]);
  for (const job of pending) {
    if (count >= config.parallelLimit) break;
    const group = job.spec.resourceGroup;
    if (group !== null && groups.has(group)) continue;
    if (group !== null) groups.add(group);
    count += 1;
    await startJob(ctx, shared, job);
  }
  // 3. every running job takes one turn
  const turns = await ctx.tx.q<JobRow>(`SELECT * FROM ci_jobs WHERE project_id = $1 AND status = 'running' ${ORDER}`, [pid]);
  for (const job of turns) await turn(ctx, shared, job);
  await sealWaiting(ctx);
  // 4. statuses
  await refreshOpenPipelines(ctx);
}

interface RunnerResult {
  readonly rounds: number;
  readonly jobs: { id: number; name: string; status: string }[];
  readonly seq: number;
}

async function oneRound(projectId: number): Promise<{ changed: boolean; jobs: Map<number, { id: number; name: string; status: string }>; seq: number }> {
  return withTx(async (tx: Tx) => {
    const project = await findProject(tx, projectId);
    if (project === undefined) return { changed: false, jobs: new Map(), seq: 0 };
    await tx.lockProject(projectId);
    const ctx = new CiContext(tx, project, "system");
    await round(ctx);
    return { changed: ctx.changed, jobs: ctx.touched, seq: await tx.currentSeq(projectId) };
  });
}

async function run(projectId: number, limit: number, untilIdle: boolean): Promise<RunnerResult> {
  const touched = new Map<number, { id: number; name: string; status: string }>();
  let seq = 0;
  let rounds = 0;
  while (rounds < limit) {
    const outcome = await oneRound(projectId);
    rounds += 1;
    seq = outcome.seq;
    for (const [id, job] of outcome.jobs) touched.set(id, job);
    if (untilIdle && !outcome.changed) break;
  }
  return { rounds, jobs: [...touched.values()].sort((a, b) => a.id - b.id), seq };
}

/** `runner/step`: exactly `count` rounds. */
export async function runRounds(projectId: number, count: number): Promise<RunnerResult> {
  return run(projectId, Math.max(0, count), false);
}

/** `runner/settle`: rounds until one changes nothing, at most 500. */
export async function settle(projectId: number): Promise<RunnerResult> {
  return run(projectId, 500, true);
}

/** Production timer: one round for every project that has jobs to move or logs to seal. */
async function roundForBusyProjects(): Promise<void> {
  const projects = await db.q<{ project_id: number }>(
    `SELECT DISTINCT project_id FROM ci_jobs
      WHERE status IN ('pending', 'running', 'scheduled') OR (finished_at IS NOT NULL AND NOT log_sealed)`,
  );
  for (const { project_id: projectId } of projects) {
    try {
      await oneRound(projectId);
    } catch (error) {
      console.error(`scheduler round of project ${projectId} failed`, error);
    }
  }
}

export function registerRound(): void {
  onRound(roundForBusyProjects);
}

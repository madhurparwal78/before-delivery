// Seeding: protected environments and pipelines built from the config at a commit, without live messages or audit.
import type { ProjectRow } from "../access.ts";
import { now } from "../clock.ts";
import type { Tx } from "../db.ts";
import { validationOne } from "../errors.ts";
import type { PipelineSeedResult, SeedKeys, SeedPipeline, SeedProtectedEnvironment } from "../admin/seed-spec.ts";
import { expandVariables } from "./config/expand.ts";
import { parseCommand } from "./commands.ts";
import { CiContext } from "./context.ts";
import { seedEnvironment } from "./deployments.ts";
import { clearWorkspace, dependencyJobs, putWorkspaceFile, uploadArtifacts } from "./files.ts";
import { JobLog, updateJob, uploadLog } from "./jobstore.ts";
import { refreshPipeline, transition } from "./lifecycle.ts";
import { createPipeline } from "./pipelines.ts";
import { latestJobsOf, loadPipeline, type JobRow } from "./rows.ts";
import { isFinished, isJobStatus } from "./status.ts";
import { jobVariables, projectVariables } from "./variables.ts";

const SEEDER = { id: 0, username: "system" } as const;

export async function seedProtectedEnvironments(
  tx: Tx,
  project: ProjectRow,
  specs: readonly SeedProtectedEnvironment[],
): Promise<PipelineSeedResult["environments"]> {
  const result: Record<string, { id: number }> = {};
  for (const spec of specs) {
    await tx.q(
      `INSERT INTO protected_environments (project_id, name, roles, approvals) VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, name) DO UPDATE SET roles = $3, approvals = $4`,
      [project.id, spec.name, spec.roles, spec.approvals],
    );
    result[spec.name] = { id: await seedEnvironment(tx, project.id, spec.name) };
  }
  return result;
}

/** A seeded success keeps what its `write` commands produced as artifacts, as a real run would. */
async function storeSeededArtifacts(ctx: CiContext, job: JobRow, vars: Readonly<Record<string, string>>): Promise<void> {
  if (job.spec.artifacts === null) return;
  for (const line of job.spec.script) {
    const command = parseCommand(expandVariables(line, vars));
    if (command.kind === "write") await putWorkspaceFile(ctx.tx, job.id, command.path, `${command.text}\n`, "write");
  }
  await uploadArtifacts(ctx.tx, job, vars, new JobLog(job));
  await clearWorkspace(ctx.tx, job.id);
}

async function settleSeededJob(ctx: CiContext, job: JobRow, status: string): Promise<void> {
  if (!isJobStatus(status)) throw validationOne("pipelines", `Unknown job status ${status}.`);
  if (!isFinished(status)) {
    await transition(ctx, job, { status });
    return;
  }
  const pipeline = await loadPipeline(ctx.tx, job.pipeline_id);
  if (pipeline !== undefined && status === "success") {
    await storeSeededArtifacts(ctx, job, jobVariables(pipeline, job, await projectVariables(ctx.tx, ctx.project.id)));
    const fed: number[] = [];
    for (const dependency of await dependencyJobs(ctx.tx, job)) {
      if ((await ctx.tx.maybe("SELECT 1 FROM ci_artifacts WHERE job_id = $1 LIMIT 1", [dependency.id])) !== undefined) fed.push(dependency.id);
    }
    await updateJob(ctx.tx, job.id, { downloaded_from: fed });
  }
  const log = new JobLog(job);
  log.sys(`Job finished: ${status}`);
  await log.flush(ctx, job);
  const sealed = await uploadLog(ctx.tx, job.id);
  const ran = status !== "skipped";
  await transition(ctx, job, {
    status,
    started_at: ran ? now() : null,
    finished_at: ran ? now() : null,
    failure_reason: status === "failed" ? "script_failure" : null,
    log_sealed: sealed,
  });
}

export async function seedPipelines(tx: Tx, project: ProjectRow, keys: SeedKeys, specs: readonly SeedPipeline[]): Promise<PipelineSeedResult> {
  const pipelines: Record<string, { id: number; jobs: Record<string, number> }> = {};
  const ctx = new CiContext(tx, project, SEEDER.username, null, true);
  for (const spec of specs) {
    const sha = keys.commitIds.get(spec.commit);
    if (sha === undefined) throw validationOne(`pipelines.${spec.key}.commit`, `Unknown commit ${spec.commit}.`);
    const outcome = await createPipeline(tx, { project, ref: spec.ref, sha, source: "push", actor: SEEDER, changesBase: null }, true);
    if (!("id" in outcome)) throw validationOne(`pipelines.${spec.key}`, outcome.reason);
    for (const name of Object.keys(spec.jobs)) {
      if (!(await latestJobsOf(tx, outcome.id)).some((job) => job.name === name)) {
        throw validationOne(`pipelines.${spec.key}.jobs`, `Unknown job ${name}.`);
      }
    }
    for (const configured of await latestJobsOf(tx, outcome.id)) {
      const status = spec.jobs[configured.name];
      if (status === undefined) continue;
      const current = (await latestJobsOf(tx, outcome.id)).find((job) => job.id === configured.id);
      if (current !== undefined) await settleSeededJob(ctx, current, status);
      await refreshPipeline(ctx, outcome.id);
    }
    const jobs: Record<string, number> = {};
    for (const job of await latestJobsOf(tx, outcome.id)) jobs[job.name] = job.id;
    pipelines[spec.key] = { id: outcome.id, jobs };
  }
  const environments: Record<string, { id: number }> = {};
  const rows = await tx.q<{ id: number; name: string }>("SELECT id, name FROM ci_environments WHERE project_id = $1", [project.id]);
  for (const row of rows) environments[row.name] = { id: row.id };
  return { pipelines, environments };
}

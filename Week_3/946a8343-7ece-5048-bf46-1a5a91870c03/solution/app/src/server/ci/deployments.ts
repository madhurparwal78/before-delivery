// Environments, deployments, protected-environment approvals, rollback and auto-stop (DP-30, DP-31, DP-32).
import { atLeast, findProject, isRole, type Access, type UserRow } from "../access.ts";
import { config } from "../config.ts";
import { iso, now } from "../clock.ts";
import { db, withTx, type Queryable, type Tx } from "../db.ts";
import { conflict, denied, notFound, storageUnavailable } from "../errors.ts";
import { storage, StorageUnavailable } from "../s3.ts";
import { artifactObject, isExpired } from "./files.ts";
import { expandVariables } from "./config/expand.ts";
import { CiContext } from "./context.ts";
import { cancelJob, enqueueJob, refreshPipeline, transition } from "./lifecycle.ts";
import {
  isoOrNull, loadEnvironment, loadJob, loadPipeline,
  type DeploymentArtifact, type DeploymentRow, type EnvironmentRow, type JobRow, type PipelineRow,
} from "./rows.ts";
import { jobVariables, projectVariables } from "./variables.ts";
import { isOneOf } from "../json.ts";

const REVIEW_PREFIX = "review/";
const TIERS = ["production", "staging", "testing", "development", "other"] as const;

function tierFor(name: string, explicit: string | null): string {
  if (isOneOf(TIERS, explicit)) return explicit;
  return name === "production" ? "production" : "other";
}

export interface Protection {
  readonly roles: string;
  readonly approvals: number;
}

export async function protectionOf(q: Queryable, projectId: number, name: string): Promise<Protection | null> {
  const row = await q.maybe<Protection>("SELECT roles, approvals FROM protected_environments WHERE project_id = $1 AND name = $2", [projectId, name]);
  return row ?? null;
}

async function ensureEnvironment(ctx: CiContext, name: string, tier: string | null): Promise<EnvironmentRow> {
  const found = await ctx.tx.maybe<EnvironmentRow>("SELECT * FROM ci_environments WHERE project_id = $1 AND name = $2", [ctx.project.id, name]);
  if (found === undefined) {
    const created = await ctx.tx.one<EnvironmentRow>(
      "INSERT INTO ci_environments (project_id, name, tier, created_at) VALUES ($1, $2, $3, $4) RETURNING *",
      [ctx.project.id, name, tierFor(name, tier), now()],
    );
    await ctx.emit("environment", { environment_id: created.id });
    return created;
  }
  if (found.state === "available") return found;
  const reopened = await ctx.tx.one<EnvironmentRow>("UPDATE ci_environments SET state = 'available' WHERE id = $1 RETURNING *", [found.id]);
  await ctx.emit("environment", { environment_id: found.id });
  return reopened;
}

export async function seedEnvironment(tx: Tx, projectId: number, name: string): Promise<number> {
  const row = await tx.one<{ id: number }>(
    `INSERT INTO ci_environments (project_id, name, tier, created_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [projectId, name, tierFor(name, null), now()],
  );
  return row.id;
}

const deploymentTarget = (ctx: CiContext, env: EnvironmentRow, number: number): string => `${ctx.project.path}:${env.name}#${number}`;

async function announceDeployment(ctx: CiContext, env: EnvironmentRow, dep: DeploymentRow, say?: string): Promise<void> {
  await ctx.emit(
    "deployment",
    { environment_id: env.id, number: dep.number },
    say === undefined ? undefined : [{ text: say, pages: [`env:${env.id}`] }],
  );
  await ctx.webhook("deployment", { deployment: { environment: env.name, number: dep.number, status: dep.status, sha: dep.sha } });
}

async function moveDeployment(ctx: CiContext, env: EnvironmentRow, dep: DeploymentRow, status: string, finished: boolean, say?: string): Promise<DeploymentRow> {
  const moved = await ctx.tx.one<DeploymentRow>(
    "UPDATE ci_deployments SET status = $2, finished_at = CASE WHEN $3 THEN $4 ELSE finished_at END WHERE id = $1 RETURNING *",
    [dep.id, status, finished, now()],
  );
  await ctx.audit("deployment.status", deploymentTarget(ctx, env, dep.number), { status: dep.status }, { status });
  await announceDeployment(ctx, env, moved, say);
  return moved;
}

/** Creates the deployment of a start job that has become eligible. True when a protected environment gates it. */
export async function openDeployment(
  ctx: CiContext,
  job: JobRow,
  pipeline: PipelineRow,
  vars: Readonly<Record<string, string>>,
  ignoreGate = false,
): Promise<boolean> {
  const spec = job.spec.environment;
  if (spec === null || spec.action !== "start") return false;
  const name = expandVariables(spec.name, vars);
  const env = await ensureEnvironment(ctx, name, spec.tier);
  const protection = await protectionOf(ctx.tx, ctx.project.id, name);
  const required = ignoreGate ? 0 : (protection?.approvals ?? 0);
  const gated = required > 0;
  const number = (await ctx.tx.one<{ next: number }>("SELECT COALESCE(MAX(number), 0) + 1 AS next FROM ci_deployments WHERE environment_id = $1", [env.id])).next;
  const dep = await ctx.tx.one<DeploymentRow>(
    `INSERT INTO ci_deployments (environment_id, project_id, number, pipeline_id, job_id, sha, status, required, deployer_id, deployer_name, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [env.id, ctx.project.id, number, pipeline.id, job.id, pipeline.sha, gated ? "awaiting_approval" : "created", required, job.actor_id, job.actor_name, now()],
  );
  await ctx.audit("deployment.status", deploymentTarget(ctx, env, number), null, { status: dep.status });
  await announceDeployment(ctx, env, dep);
  return gated;
}

async function recordedArtifacts(q: Queryable, job: JobRow): Promise<DeploymentArtifact[]> {
  const sources = [job.id, ...job.downloaded_from];
  const rows = await q.q<DeploymentArtifact>("SELECT job_id, path FROM ci_artifacts WHERE job_id = ANY($1::int[]) ORDER BY job_id, path", [sources]);
  return rows;
}

async function markStopped(ctx: CiContext, job: JobRow): Promise<void> {
  const spec = job.spec.environment;
  const pipeline = await loadPipeline(ctx.tx, job.pipeline_id);
  if (spec === null || pipeline === undefined) return;
  const vars = jobVariables(pipeline, job, await projectVariables(ctx.tx, ctx.project.id));
  const env = await ctx.tx.maybe<EnvironmentRow>("SELECT * FROM ci_environments WHERE project_id = $1 AND name = $2", [ctx.project.id, expandVariables(spec.name, vars)]);
  if (env === undefined || env.state === "stopped") return;
  await ctx.tx.q("UPDATE ci_environments SET state = 'stopped', auto_stop_at = NULL WHERE id = $1", [env.id]);
  await ctx.emit("environment", { environment_id: env.id });
}

/** Keeps the deployment of a job in step with the job's status. Called on every job transition. */
export async function syncDeployment(ctx: CiContext, job: JobRow): Promise<void> {
  const dep = await ctx.tx.maybe<DeploymentRow>("SELECT * FROM ci_deployments WHERE job_id = $1", [job.id]);
  if (dep === undefined) {
    if (job.spec.environment?.action === "stop" && job.status === "success") await markStopped(ctx, job);
    return;
  }
  const env = await loadEnvironment(ctx.tx, dep.environment_id);
  if (env === undefined) return;
  if (job.status === "running" && (dep.status === "created" || dep.status === "approved")) {
    await moveDeployment(ctx, env, dep, "running", false);
  } else if (job.status === "success" && (dep.status === "running" || dep.status === "created" || dep.status === "approved")) {
    const finished = await moveDeployment(ctx, env, dep, "success", true);
    await ctx.tx.q("UPDATE ci_deployments SET artifacts = $2::jsonb WHERE id = $1", [finished.id, JSON.stringify(await recordedArtifacts(ctx.tx, job))]);
    await scheduleAutoStop(ctx, env, job);
  } else if ((job.status === "failed" || job.status === "warning") && dep.status !== "failed" && dep.status !== "rolled_back") {
    await moveDeployment(ctx, env, dep, "failed", true);
  } else if (job.status === "canceled" && dep.status !== "canceled") {
    await moveDeployment(ctx, env, dep, "canceled", true);
  }
}

async function scheduleAutoStop(ctx: CiContext, env: EnvironmentRow, job: JobRow): Promise<void> {
  const autoStopIn = job.spec.environment?.autoStopInMs ?? null;
  if (env.kept || (!env.name.startsWith(REVIEW_PREFIX) && autoStopIn === null)) return;
  await ctx.tx.q("UPDATE ci_environments SET auto_stop_at = $2 WHERE id = $1", [env.id, now() + (autoStopIn ?? config.autoStopMs)]);
  await ctx.emit("environment", { environment_id: env.id });
}

interface ApprovalView {
  readonly user: string;
  readonly status: string;
  readonly expires_at: string | null;
  readonly expired: boolean;
}

export interface DeploymentView {
  readonly id: number;
  readonly number: number;
  readonly status: string;
  readonly sha: string;
  readonly pipeline_id: number | null;
  readonly job_id: number | null;
  readonly required: number;
  readonly approvals: ApprovalView[];
  readonly approved: number;
  readonly deployer: string;
  readonly created_at: string;
  readonly finished_at: string | null;
}

interface ApprovalRow {
  readonly id: number;
  readonly deployment_id: number;
  readonly user_id: number;
  readonly username: string;
  readonly status: string;
  readonly granted_at: number;
}

const lapsed = (approval: ApprovalRow): boolean => approval.status === "approved" && now() >= approval.granted_at + config.deployApprovalMs;

export async function deploymentViews(q: Queryable, deployments: readonly DeploymentRow[]): Promise<DeploymentView[]> {
  if (deployments.length === 0) return [];
  const rows = await q.q<ApprovalRow>(
    "SELECT * FROM ci_deployment_approvals WHERE deployment_id = ANY($1::int[]) ORDER BY id",
    [deployments.map((dep) => dep.id)],
  );
  return deployments.map((dep) => {
    const own = rows.filter((row) => row.deployment_id === dep.id);
    const approvals = own.map((row) => ({
      user: row.username,
      status: row.status,
      expires_at: row.status === "approved" ? iso(row.granted_at + config.deployApprovalMs) : null,
      expired: lapsed(row),
    }));
    return {
      id: dep.id, number: dep.number, status: dep.status, sha: dep.sha, pipeline_id: dep.pipeline_id, job_id: dep.job_id,
      required: dep.required, approvals, approved: own.filter((row) => row.status === "approved" && !lapsed(row)).length,
      deployer: dep.deployer_name, created_at: iso(dep.created_at), finished_at: isoOrNull(dep.finished_at),
    };
  });
}

export async function deploymentView(q: Queryable, dep: DeploymentRow): Promise<DeploymentView> {
  const [view] = await deploymentViews(q, [dep]);
  if (view === undefined) throw new Error("deployment view");
  return view;
}

async function currentDeployment(q: Queryable, environmentId: number): Promise<DeploymentRow | undefined> {
  return q.maybe<DeploymentRow>("SELECT * FROM ci_deployments WHERE environment_id = $1 AND status = 'success' ORDER BY number DESC LIMIT 1", [environmentId]);
}

/** A deploy job that starts while a newer pipeline already deployed fails with the published text; null when it may run. */
export async function outdatedText(q: Queryable, job: JobRow): Promise<string | null> {
  const dep = await q.maybe<DeploymentRow>("SELECT * FROM ci_deployments WHERE job_id = $1", [job.id]);
  if (dep === undefined) return null;
  const current = await currentDeployment(q, dep.environment_id);
  if (current === undefined || current.pipeline_id === null || current.pipeline_id <= job.pipeline_id) return null;
  return `This deployment is outdated: deployment ${current.number} is newer.`;
}

interface Decision {
  readonly user: UserRow;
  readonly access: Access;
  readonly deployment: DeploymentRow;
}

/** The published refusals, in the published order. */
export async function assertMayDecide(ctx: CiContext, decision: Decision): Promise<void> {
  const { user, access, deployment: dep } = decision;
  const env = await loadEnvironment(ctx.tx, dep.environment_id);
  if (env === undefined) throw new Error("deployment without environment");
  if (dep.deployer_id !== null && dep.deployer_id === user.id) {
    throw denied("self_approval", "You can't approve your own deployment.");
  }
  const protection = await protectionOf(ctx.tx, ctx.project.id, env.name);
  const minimum = protection !== null && isRole(protection.roles) ? protection.roles : "maintainer";
  if (!atLeast(access, minimum)) {
    throw denied("forbidden", `You aren't allowed to approve deployments to ${env.name}.`);
  }
  if (dep.status !== "awaiting_approval") throw conflict("not_awaiting", "This deployment isn't waiting for approval.");
  const existing = await ctx.tx.q<ApprovalRow>("SELECT * FROM ci_deployment_approvals WHERE deployment_id = $1 AND user_id = $2", [dep.id, user.id]);
  if (existing.some((row) => row.status === "approved" && !lapsed(row))) {
    throw conflict("already_approved", "You already approved this deployment.");
  }
}

export async function recordDecision(ctx: CiContext, decision: Decision, status: "approved" | "rejected"): Promise<DeploymentRow> {
  const { user, deployment: dep } = decision;
  const env = await loadEnvironment(ctx.tx, dep.environment_id);
  if (env === undefined) throw new Error("deployment without environment");
  await ctx.tx.q(
    "INSERT INTO ci_deployment_approvals (deployment_id, user_id, username, status, granted_at) VALUES ($1, $2, $3, $4, $5)",
    [dep.id, user.id, user.username, status, now()],
  );
  await ctx.audit("deployment.approval", deploymentTarget(ctx, env, dep.number), null, { user: user.username, status });
  const job = dep.job_id === null ? undefined : await loadJob(ctx.tx, dep.job_id);
  if (status === "rejected") {
    if (job !== undefined) {
      await cancelJob(ctx, job, `Deployment rejected by ${user.username}.`);
      await refreshPipeline(ctx, job.pipeline_id);
    }
    return ctx.tx.one<DeploymentRow>("SELECT * FROM ci_deployments WHERE id = $1", [dep.id]);
  }
  const given = (await deploymentView(ctx.tx, dep)).approved;
  const note = `Deployment approval recorded: ${given} of ${dep.required}.`;
  if (given < dep.required) {
    await announceDeployment(ctx, env, dep, note);
    return dep;
  }
  const approved = await moveDeployment(ctx, env, dep, "approved", false, note);
  if (job !== undefined && job.status === "manual") {
    await transition(ctx, job, { status: "pending" });
    await refreshPipeline(ctx, job.pipeline_id);
  }
  return approved;
}

/** Approvals older than `SPUR_DEPLOY_APPROVAL_MS` stop counting; pages learn about it when the server clock passes them. */
export async function lapseApprovals(): Promise<void> {
  const cutoff = now() - config.deployApprovalMs;
  const due = await db.q<{ project_id: number }>(
    `SELECT DISTINCT d.project_id FROM ci_deployment_approvals a JOIN ci_deployments d ON d.id = a.deployment_id
      WHERE a.status = 'approved' AND NOT a.lapse_seen AND a.granted_at <= $1`,
    [cutoff],
  );
  for (const { project_id: projectId } of due) {
    await withTx(async (tx) => {
      await tx.lockProject(projectId);
      const rows = await tx.q<{ id: number; deployment_id: number }>(
        `UPDATE ci_deployment_approvals a SET lapse_seen = true FROM ci_deployments d
          WHERE d.id = a.deployment_id AND d.project_id = $1 AND a.status = 'approved' AND NOT a.lapse_seen AND a.granted_at <= $2
          RETURNING a.id, a.deployment_id`,
        [projectId, cutoff],
      );
      for (const deploymentId of new Set(rows.map((row) => row.deployment_id))) {
        const dep = await tx.one<DeploymentRow>("SELECT * FROM ci_deployments WHERE id = $1", [deploymentId]);
        await tx.emit(projectId, "deployment", { environment_id: dep.environment_id, number: dep.number });
      }
    });
  }
}

interface RollbackResult {
  readonly number: number;
}

/** `Roll back to deployment <n>`: a new success deployment from n's commit and its recorded artifact objects. */
export async function rollbackDeployment(ctx: CiContext, env: EnvironmentRow, target: number): Promise<RollbackResult> {
  const source = await ctx.tx.maybe<DeploymentRow>("SELECT * FROM ci_deployments WHERE environment_id = $1 AND number = $2", [env.id, target]);
  if (source === undefined) throw notFound();
  if (source.artifacts.length === 0) throw conflict("artifact_gone", `Can't roll back: deployment ${target} has no artifact.`);
  const gone = conflict("artifact_gone", "Can't roll back: its artifact has expired.");
  for (const artifact of source.artifacts) {
    const row = await ctx.tx.maybe<{ expired: boolean; expires_at: number | null }>(
      "SELECT expired, expires_at FROM ci_artifacts WHERE job_id = $1 AND path = $2",
      [artifact.job_id, artifact.path],
    );
    if (row === undefined || isExpired(row)) throw gone;
  }
  try {
    for (const artifact of source.artifacts) {
      if (!(await storage.has(artifactObject(artifact.job_id, artifact.path)))) throw gone;
    }
  } catch (error) {
    if (error instanceof StorageUnavailable) throw storageUnavailable();
    throw error;
  }
  const previous = await currentDeployment(ctx.tx, env.id);
  const number = (await ctx.tx.one<{ next: number }>("SELECT COALESCE(MAX(number), 0) + 1 AS next FROM ci_deployments WHERE environment_id = $1", [env.id])).next;
  const stamp = now();
  const created = await ctx.tx.one<DeploymentRow>(
    `INSERT INTO ci_deployments (environment_id, project_id, number, pipeline_id, job_id, sha, status, required, deployer_id, deployer_name, artifacts, created_at, finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'success', 0, NULL, $7, $8::jsonb, $9, $9) RETURNING *`,
    [env.id, ctx.project.id, number, source.pipeline_id, source.job_id, source.sha, ctx.actor, JSON.stringify(source.artifacts), stamp],
  );
  await ctx.audit("deployment.status", deploymentTarget(ctx, env, number), null, { status: "success" });
  await announceDeployment(ctx, env, created);
  if (previous !== undefined) await moveDeployment(ctx, env, previous, "rolled_back", false);
  return { number };
}

export async function stopEnvironment(ctx: CiContext, env: EnvironmentRow): Promise<void> {
  const latest = await ctx.tx.maybe<DeploymentRow>("SELECT * FROM ci_deployments WHERE environment_id = $1 ORDER BY number DESC LIMIT 1", [env.id]);
  const startJob = latest?.job_id == null ? undefined : await loadJob(ctx.tx, latest.job_id);
  const onStop = startJob?.spec.environment?.onStop ?? null;
  const stopJob =
    onStop === null || latest?.pipeline_id == null
      ? undefined
      : await ctx.tx.maybe<JobRow>("SELECT * FROM ci_jobs WHERE pipeline_id = $1 AND name = $2 AND NOT retried", [latest.pipeline_id, onStop]);
  if (stopJob === undefined) {
    await ctx.tx.q("UPDATE ci_environments SET state = 'stopped', auto_stop_at = NULL WHERE id = $1", [env.id]);
    await ctx.emit("environment", { environment_id: env.id });
    return;
  }
  await ctx.tx.q("UPDATE ci_environments SET state = 'stopping', auto_stop_at = NULL WHERE id = $1", [env.id]);
  await ctx.emit("environment", { environment_id: env.id });
  await enqueueJob(ctx, stopJob);
}

/** Server deadline: review environments (and those with `auto_stop_in`) stop when their time comes. */
export async function stopDueEnvironments(): Promise<void> {
  const due = await db.q<{ project_id: number }>(
    "SELECT DISTINCT project_id FROM ci_environments WHERE state = 'available' AND auto_stop_at IS NOT NULL AND auto_stop_at <= $1",
    [now()],
  );
  for (const { project_id: projectId } of due) {
    await withTx(async (tx) => {
      const project = await findProject(tx, projectId);
      if (project === undefined) return;
      await tx.lockProject(projectId);
      const ctx = new CiContext(tx, project, "system");
      const envs = await tx.q<EnvironmentRow>(
        "SELECT * FROM ci_environments WHERE project_id = $1 AND state = 'available' AND auto_stop_at IS NOT NULL AND auto_stop_at <= $2 ORDER BY id",
        [projectId, now()],
      );
      for (const env of envs) await stopEnvironment(ctx, env);
    });
  }
}

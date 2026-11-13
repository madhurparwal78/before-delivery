// HTTP routes of the CI module: pipelines, jobs, logs, artifacts, lint, environments, deployments, metrics, findings.
import { projectScope, requireAction, type Access, type ProjectRow } from "../access.ts";
import { audit } from "../audit.ts";
import { db, withTx, type Queryable, type Tx } from "../db.ts";
import { FieldErrors, conflict, notFound, storageUnavailable, validation, validationOne } from "../errors.ts";
import { intParam, json, type Ctx, type JsonReply, type RawReply, type Router } from "../http.ts";
import { refreshChecks } from "../mr/index.ts";
import { resolveRef } from "../repo/index.ts";
import { storage, StorageUnavailable } from "../s3.ts";
import { isTimeZone } from "../../shared/zone.ts";
import { CiContext } from "./context.ts";
import { projectMetrics } from "./delivery.ts";
import { assertMayDecide, deploymentView, recordDecision, rollbackDeployment, stopEnvironment } from "./deployments.ts";
import { artifactObject, isExpired } from "./files.ts";
import { announceJobChange, logLines } from "./jobstore.ts";
import { cancelJob, cancelPipelineJobs, enqueueJob, refreshPipeline, retryJob, retryPipeline } from "./lifecycle.ts";
import { createPipeline, lintConfig } from "./pipelines.ts";
import { pipelineCoverage } from "./request-reports.ts";
import {
  loadDeployment, loadEnvironment, loadJob, loadPipeline,
  type EnvironmentRow, type JobRow, type PipelineRow,
} from "./rows.ts";
import { isFinished } from "./status.ts";
import { streamJobLog } from "./stream.ts";
import { environmentView, jobDetail, pipelineListItem, pipelineView } from "./views.ts";
import { isOneOf, isRecord } from "../json.ts";

type Body = Readonly<Record<string, unknown>>;

function bodyOf(value: unknown): Body {
  return isRecord(value) ? value : {};
}

function stringMap(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") return null;
    result[key] = item;
  }
  return result;
}

const contextFor = (tx: Tx, project: ProjectRow, ctx: Ctx): CiContext => new CiContext(tx, project, ctx.user.username, ctx.user.id);

interface JobScope {
  readonly job: JobRow;
  readonly pipeline: PipelineRow;
  readonly project: ProjectRow;
  readonly access: Access;
}

async function jobScope(q: Queryable, ctx: Ctx, jobId: number): Promise<JobScope> {
  const job = await loadJob(q, jobId);
  if (job === undefined) throw notFound();
  const { project, access } = await projectScope(q, ctx.user, job.project_id);
  const pipeline = await loadPipeline(q, job.pipeline_id);
  if (pipeline === undefined) throw notFound();
  return { job, pipeline, project, access };
}

async function pipelineScope(q: Queryable, ctx: Ctx, pipelineId: number): Promise<{ pipeline: PipelineRow; project: ProjectRow; access: Access }> {
  const pipeline = await loadPipeline(q, pipelineId);
  if (pipeline === undefined) throw notFound();
  const { project, access } = await projectScope(q, ctx.user, pipeline.project_id);
  return { pipeline, project, access };
}

async function environmentScope(q: Queryable, ctx: Ctx, environmentId: number): Promise<{ env: EnvironmentRow; project: ProjectRow; access: Access }> {
  const env = await loadEnvironment(q, environmentId);
  if (env === undefined) throw notFound();
  const { project, access } = await projectScope(q, ctx.user, env.project_id);
  return { env, project, access };
}

async function seqReply(tx: Tx, projectId: number, status: number, body: Record<string, unknown> = {}): Promise<JsonReply> {
  return json(status, { ...body, seq: await tx.currentSeq(projectId) });
}

function registerPipelineRoutes(router: Router): void {
  router.post("/api/projects/:id/pipelines", (ctx) =>
    withTx(async (tx) => {
      const { project, access } = await projectScope(tx, ctx.user, intParam(ctx, "id"));
      requireAction(access, "job.run");
      await tx.lockProject(project.id);
      const body = bodyOf(ctx.body);
      const fields = new FieldErrors();
      const ref = typeof body["ref"] === "string" ? body["ref"] : "";
      if (ref === "") fields.add("ref", "Choose a branch or tag to run the pipeline on.");
      const variables = stringMap(body["variables"]);
      if (variables === null) fields.add("variables", "Variables must be text values.");
      fields.throwIfAny();
      const sha = await resolveRef(tx, project.id, ref);
      if (sha === null) throw validationOne("ref", "That branch or tag doesn't exist.");
      const outcome = await createPipeline(tx, { project, ref, sha, source: "web", actor: ctx.user, variables: variables ?? {} });
      if (!("id" in outcome)) throw validationOne("ref", outcome.reason);
      return seqReply(tx, project.id, 201, { id: outcome.id });
    }),
  );

  router.get("/api/projects/:id/pipelines", async (ctx) => {
    const { project, access } = await projectScope(db, ctx.user, intParam(ctx, "id"));
    requireAction(access, "pipeline.read");
    const ref = ctx.query.get("ref");
    const rows = await db.q<PipelineRow>(
      "SELECT * FROM ci_pipelines WHERE project_id = $1 AND ($2::text IS NULL OR ref = $2) ORDER BY id DESC LIMIT 200",
      [project.id, ref],
    );
    const items: Record<string, unknown>[] = [];
    for (const row of rows) items.push(pipelineListItem(row, await pipelineCoverage(db, row.id)));
    return json(200, { pipelines: items });
  });

  router.get("/api/pipelines/:id", async (ctx) => {
    const { pipeline, access } = await pipelineScope(db, ctx, intParam(ctx, "id"));
    requireAction(access, "pipeline.read");
    return json(200, await pipelineView(db, pipeline));
  });

  router.post("/api/pipelines/:id/retry", (ctx) =>
    withTx(async (tx) => {
      const { pipeline, project, access } = await pipelineScope(tx, ctx, intParam(ctx, "id"));
      requireAction(access, "job.run");
      await tx.lockProject(project.id);
      await retryPipeline(contextFor(tx, project, ctx), pipeline.id);
      return seqReply(tx, project.id, 200);
    }),
  );

  router.post("/api/pipelines/:id/cancel", (ctx) =>
    withTx(async (tx) => {
      const { pipeline, project, access } = await pipelineScope(tx, ctx, intParam(ctx, "id"));
      requireAction(access, "job.run");
      await tx.lockProject(project.id);
      const current = await loadPipeline(tx, pipeline.id);
      if (current === undefined || isFinished(current.status)) throw conflict("pipeline_finished", "This pipeline has already finished.");
      await cancelPipelineJobs(contextFor(tx, project, ctx), pipeline.id, null);
      return seqReply(tx, project.id, 200);
    }),
  );

  router.post("/api/projects/:id/ci/lint", async (ctx) => {
    const { project, access } = await projectScope(db, ctx.user, intParam(ctx, "id"));
    requireAction(access, "pipeline.read");
    const body = bodyOf(ctx.body);
    const fields = new FieldErrors();
    if (typeof body["content"] !== "string") fields.add("content", "Add the pipeline config to check.");
    const variables = stringMap(body["variables"]);
    if (variables === null) fields.add("variables", "Variables must be text values.");
    const changed = body["changed_files"];
    if (changed !== undefined && (!Array.isArray(changed) || !changed.every((item): item is string => typeof item === "string"))) {
      fields.add("changed_files", "Changed files must be a list of paths.");
    }
    fields.throwIfAny();
    const changedFiles = Array.isArray(changed) ? changed.filter((item): item is string => typeof item === "string") : null;
    const ref = typeof body["ref"] === "string" && body["ref"] !== "" ? body["ref"] : null;
    return json(200, await lintConfig(db, project, { content: String(body["content"]), ref, variables: variables ?? {}, changedFiles }));
  });
}

function registerJobRoutes(router: Router): void {
  router.get("/api/jobs/:id", async (ctx) => {
    const { job, pipeline, access } = await jobScope(db, ctx, intParam(ctx, "id"));
    requireAction(access, "pipeline.read");
    return json(200, await jobDetail(db, job, pipeline));
  });

  router.get("/api/jobs/:id/log", async (ctx) => {
    const { job, access } = await jobScope(db, ctx, intParam(ctx, "id"));
    requireAction(access, "pipeline.read");
    return json(200, { lines: await logLines(db, job.id) });
  });

  router.get("/api/jobs/:id/log/stream", async (ctx) => {
    const { job, access } = await jobScope(db, ctx, intParam(ctx, "id"));
    requireAction(access, "pipeline.read");
    return streamJobLog(ctx, job.id);
  });

  router.post("/api/jobs/:id/play", (ctx) =>
    withTx(async (tx) => {
      const { job: found, project, access } = await jobScope(tx, ctx, intParam(ctx, "id"));
      requireAction(access, "job.run");
      await tx.lockProject(project.id);
      const job = (await loadJob(tx, found.id)) ?? found;
      if (job.status !== "manual") throw conflict("not_manual", "This job isn't waiting to be played.");
      const gated = await tx.maybe("SELECT 1 FROM ci_deployments WHERE job_id = $1 AND status = 'awaiting_approval'", [job.id]);
      if (gated !== undefined) throw conflict("awaiting_approval", "This deployment is waiting for approval.");
      const variables = stringMap(bodyOf(ctx.body)["variables"]);
      if (variables === null) throw validationOne("variables", "Variables must be text values.");
      const played = await enqueueJob(contextFor(tx, project, ctx), job, variables);
      return seqReply(tx, project.id, 200, { id: played.id, status: played.status });
    }),
  );

  router.post("/api/jobs/:id/retry", (ctx) =>
    withTx(async (tx) => {
      const { job: found, project, access } = await jobScope(tx, ctx, intParam(ctx, "id"));
      requireAction(access, "job.run");
      await tx.lockProject(project.id);
      const job = (await loadJob(tx, found.id)) ?? found;
      if (!isFinished(job.status) || job.retried) throw conflict("not_finished", "Only a finished job can be retried.");
      const next = await retryJob(contextFor(tx, project, ctx), job);
      return seqReply(tx, project.id, 201, { id: next.id });
    }),
  );

  router.post("/api/jobs/:id/cancel", (ctx) =>
    withTx(async (tx) => {
      const { job: found, project, access } = await jobScope(tx, ctx, intParam(ctx, "id"));
      requireAction(access, "job.run");
      await tx.lockProject(project.id);
      const job = (await loadJob(tx, found.id)) ?? found;
      if (isFinished(job.status)) throw conflict("job_finished", "This job has already finished.");
      const ci = contextFor(tx, project, ctx);
      ci.noRetry.add(job.pipeline_id);
      await cancelJob(ci, job, null);
      await refreshPipeline(ci, job.pipeline_id);
      return seqReply(tx, project.id, 200);
    }),
  );

  router.get("/api/jobs/:id/artifacts/*path", async (ctx): Promise<RawReply> => {
    const { job, access } = await jobScope(db, ctx, intParam(ctx, "id"));
    requireAction(access, "pipeline.read");
    const path = ctx.params["path"] ?? "";
    const row = await db.maybe<{ expired: boolean; expires_at: number | null }>("SELECT expired, expires_at FROM ci_artifacts WHERE job_id = $1 AND path = $2", [job.id, path]);
    if (row === undefined || isExpired(row)) throw notFound();
    try {
      const body = await storage.get(artifactObject(job.id, path));
      if (body === null) throw notFound();
      return { status: 200, raw: body, contentType: "application/octet-stream" };
    } catch (error) {
      if (error instanceof StorageUnavailable) throw storageUnavailable();
      throw error;
    }
  });

  router.post("/api/jobs/:id/artifacts/keep", (ctx) =>
    withTx(async (tx) => {
      const { job, project, access } = await jobScope(tx, ctx, intParam(ctx, "id"));
      requireAction(access, "job.run");
      await tx.lockProject(project.id);
      const kept = await tx.q("UPDATE ci_artifacts SET expires_at = NULL WHERE job_id = $1 AND NOT expired RETURNING path", [job.id]);
      if (kept.length > 0) {
        const current = (await loadJob(tx, job.id)) ?? job;
        await tx.emit(project.id, "job", { pipeline_id: current.pipeline_id, job_id: current.id, name: current.name, status: current.status });
        announceJobChange(contextFor(tx, project, ctx), current.id);
      }
      return seqReply(tx, project.id, 200);
    }),
  );
}

const FINDING_STATES = ["detected", "confirmed", "dismissed", "resolved"] as const;
type FindingState = (typeof FINDING_STATES)[number];

const MOVES: Readonly<Record<FindingState, readonly FindingState[]>> = {
  detected: ["confirmed", "dismissed", "resolved"],
  confirmed: ["dismissed", "resolved"],
  dismissed: ["detected"],
  resolved: [],
};

function isFindingState(value: unknown): value is FindingState {
  return isOneOf(FINDING_STATES, value);
}

interface FindingRow {
  readonly id: number;
  readonly mr_id: number;
  readonly report_id: string;
  readonly severity: string;
  readonly title: string;
  readonly path: string;
  readonly line: number;
  readonly state: FindingState;
  readonly reason: string | null;
}

function registerEnvironmentRoutes(router: Router): void {
  router.get("/api/projects/:id/environments", async (ctx) => {
    const { project, access } = await projectScope(db, ctx.user, intParam(ctx, "id"));
    requireAction(access, "environment.read");
    const rows = await db.q<EnvironmentRow>("SELECT * FROM ci_environments WHERE project_id = $1 ORDER BY name", [project.id]);
    const views = [];
    for (const row of rows) views.push(await environmentView(db, row));
    return json(200, { environments: views });
  });

  router.get("/api/projects/:id/environments/:eid", async (ctx) => {
    const { project, access } = await projectScope(db, ctx.user, intParam(ctx, "id"));
    requireAction(access, "environment.read");
    const env = await loadEnvironment(db, intParam(ctx, "eid"));
    if (env === undefined || env.project_id !== project.id) throw notFound();
    return json(200, await environmentView(db, env));
  });

  router.post(
    "/api/projects/:id/deployments/:did/approvals",
    (ctx) =>
      withTx(async (tx) => {
        const { project, access } = await projectScope(tx, ctx.user, intParam(ctx, "id"));
        requireAction(access, "environment.read");
        await tx.lockProject(project.id);
        const found = await loadDeployment(tx, intParam(ctx, "did"));
        if (found === undefined || found.project_id !== project.id) throw notFound();
        const ci = contextFor(tx, project, ctx);
        const decision = { user: ctx.user, access, deployment: found };
        await assertMayDecide(ci, decision);
        const status = bodyOf(ctx.body)["status"];
        if (status !== "approved" && status !== "rejected") throw validationOne("status", "Choose approved or rejected.");
        const decided = await recordDecision(ci, decision, status);
        return seqReply(tx, project.id, 200, { ...(await deploymentView(tx, decided)) });
      }),
    { idempotent: true },
  );

  router.post("/api/environments/:id/stop", (ctx) =>
    withTx(async (tx) => {
      const { env: found, project, access } = await environmentScope(tx, ctx, intParam(ctx, "id"));
      requireAction(access, "environment.manage");
      await tx.lockProject(project.id);
      const env = (await loadEnvironment(tx, found.id)) ?? found;
      if (env.state !== "available") throw conflict("not_available", "This environment isn't available to stop.");
      await stopEnvironment(contextFor(tx, project, ctx), env);
      return seqReply(tx, project.id, 200, { state: (await loadEnvironment(tx, env.id))?.state ?? env.state });
    }),
  );

  router.post("/api/environments/:id/keep", (ctx) =>
    withTx(async (tx) => {
      const { env, project, access } = await environmentScope(tx, ctx, intParam(ctx, "id"));
      requireAction(access, "environment.manage");
      await tx.lockProject(project.id);
      await tx.q("UPDATE ci_environments SET auto_stop_at = NULL, kept = true WHERE id = $1", [env.id]);
      await tx.emit(project.id, "environment", { environment_id: env.id });
      return seqReply(tx, project.id, 200);
    }),
  );

  router.post("/api/environments/:id/rollback", (ctx) =>
    withTx(async (tx) => {
      const { env, project, access } = await environmentScope(tx, ctx, intParam(ctx, "id"));
      requireAction(access, "environment.manage");
      await tx.lockProject(project.id);
      const target = bodyOf(ctx.body)["deployment"];
      if (typeof target !== "number" || !Number.isInteger(target) || target < 1) throw validationOne("deployment", "Choose a deployment number to roll back to.");
      const result = await rollbackDeployment(contextFor(tx, project, ctx), env, target);
      return seqReply(tx, project.id, 201, { number: result.number });
    }),
  );

  router.get("/api/projects/:id/metrics", async (ctx) => {
    const { project, access } = await projectScope(db, ctx.user, intParam(ctx, "id"));
    requireAction(access, "metrics.read");
    const zone = ctx.query.get("zone") ?? ctx.user.time_zone;
    const days = Number(ctx.query.get("days") ?? "7");
    const fields = new FieldErrors();
    if (!isTimeZone(zone)) fields.add("zone", `Unknown time zone ${zone}.`);
    if (![7, 30, 90].includes(days)) fields.add("days", "Choose 7, 30 or 90 days.");
    fields.throwIfAny();
    return json(200, await projectMetrics(db, project.id, zone, days));
  });

  router.patch("/api/projects/:id/findings/:fid", (ctx) =>
    withTx(async (tx) => {
      const { project, access } = await projectScope(tx, ctx.user, intParam(ctx, "id"));
      const findingId = intParam(ctx, "fid");
      const exists = await tx.maybe<FindingRow>("SELECT * FROM ci_findings WHERE id = $1 AND project_id = $2", [findingId, project.id]);
      if (exists === undefined) throw notFound();
      requireAction(access, "finding.dismiss");
      await tx.lockProject(project.id);
      const finding = await tx.one<FindingRow>("SELECT * FROM ci_findings WHERE id = $1", [findingId]);
      const body = bodyOf(ctx.body);
      const next = body["state"];
      if (!isFindingState(next)) throw validationOne("state", "Choose detected, confirmed, dismissed or resolved.");
      if (!MOVES[finding.state].includes(next)) {
        throw conflict("illegal_transition", `A finding can't go from ${finding.state} to ${next}.`);
      }
      const given = typeof body["reason"] === "string" ? body["reason"] : null;
      if (next === "dismissed" && (given === null || given.trim().length < 10)) {
        throw validation({ reason: "Give a reason of at least 10 characters." });
      }
      const reason = next === "dismissed" ? given : null;
      await tx.q("UPDATE ci_findings SET state = $2, reason = $3 WHERE id = $1", [finding.id, next, reason]);
      const request = await tx.one<{ iid: number }>("SELECT iid FROM merge_requests WHERE id = $1", [finding.mr_id]);
      await audit(tx, {
        projectId: project.id, actor: ctx.user.username, action: "finding.state", target: `${project.path}!${request.iid}:${finding.report_id}`,
        before: { state: finding.state }, after: { state: next, reason },
      });
      await tx.emit(project.id, "approvals", { iid: request.iid });
      await refreshChecks(tx, project, finding.mr_id);
      return seqReply(tx, project.id, 200, {
        id: finding.id, report_id: finding.report_id, severity: finding.severity, title: finding.title, path: finding.path,
        line: finding.line, state: next, reason,
      });
    }),
  );
}

export function registerCiHttp(router: Router): void {
  registerPipelineRoutes(router);
  registerJobRoutes(router);
  registerEnvironmentRoutes(router);
}
